import { randomUUID } from "node:crypto";
import postgres from "postgres";

export const liveSafetyHoldEligibleStates = ["monitoring_pending", "monitoring"] as const;

export interface LiveSafetyProviderAction {
  id: string;
  roomId: string;
  providerStreamId: string;
  leaseToken: string;
  attemptCount: number;
}

export interface LiveSafetyHealthCheck {
  id: string;
  roomId: string;
  providerStreamId: string;
  leaseToken: string;
}

export interface LiveSafetyRepository {
  claimHealthChecks(input: { now: Date; limit: number }): Promise<LiveSafetyHealthCheck[]>;
  completeHealthCheck(input: {
    id: string;
    leaseToken: string;
    observedAt: Date;
    healthy: boolean;
  }): Promise<void>;
  holdDueSessions(input: {
    now: Date;
    limit: number;
    excludeSessionIds?: string[];
  }): Promise<number>;
  claimProviderActions(input: { now: Date; limit: number }): Promise<LiveSafetyProviderAction[]>;
  completeProviderAction(input: { id: string; leaseToken: string; now: Date }): Promise<void>;
  retryProviderAction(input: {
    id: string;
    leaseToken: string;
    now: Date;
    retryAt: Date;
    failureCode: string;
    deadLetter: boolean;
  }): Promise<void>;
  close?(): Promise<void>;
}

export interface LiveSafetyProvider {
  checkHealth(input: { providerStreamId: string; observedAt: Date }): Promise<{ healthy: boolean }>;
  suspend(input: { providerStreamId: string }): Promise<void>;
}

export interface ProcessLiveSafetyResult {
  healthChecked: number;
  healthConfirmed: number;
  healthFailed: number;
  held: number;
  claimed: number;
  completed: number;
  retried: number;
  deadLettered: number;
}

export async function processLiveSafety(input: {
  repository: LiveSafetyRepository;
  provider: LiveSafetyProvider;
  now?: Date;
  limit?: number;
}): Promise<ProcessLiveSafetyResult> {
  const now = input.now ?? new Date();
  const limit = input.limit ?? 25;
  const healthChecks = await input.repository.claimHealthChecks({ now, limit });
  let healthConfirmed = 0;
  let healthFailed = 0;
  const confirmedSessionIds: string[] = [];
  for (const check of healthChecks) {
    const observedAt = input.now ?? new Date();
    let healthy = false;
    try {
      healthy = (await input.provider.checkHealth({
        providerStreamId: check.providerStreamId,
        observedAt
      })).healthy;
    } catch {
      // Provider uncertainty is deliberately fail-closed at the existing session authority.
    }
    await input.repository.completeHealthCheck({
      id: check.id,
      leaseToken: check.leaseToken,
      observedAt,
      healthy
    });
    if (healthy) {
      healthConfirmed += 1;
      confirmedSessionIds.push(check.id);
    } else {
      healthFailed += 1;
    }
  }
  const holdAt = input.now ?? new Date();
  const held = await input.repository.holdDueSessions({
    now: holdAt,
    limit,
    excludeSessionIds: confirmedSessionIds
  });
  const actions = await input.repository.claimProviderActions({ now: holdAt, limit });
  let completed = 0;
  let retried = 0;
  let deadLettered = 0;

  for (const action of actions) {
    try {
      await input.provider.suspend({ providerStreamId: action.providerStreamId });
      await input.repository.completeProviderAction({
        id: action.id,
        leaseToken: action.leaseToken,
        now: holdAt
      });
      completed += 1;
    } catch (error) {
      const deadLetter = action.attemptCount >= 10;
      const delaySeconds = Math.min(3600, 2 ** Math.min(action.attemptCount, 10) * 15);
      await input.repository.retryProviderAction({
        id: action.id,
        leaseToken: action.leaseToken,
        now: holdAt,
        retryAt: new Date(holdAt.getTime() + delaySeconds * 1000),
        failureCode: error instanceof Error ? error.name.slice(0, 120) : "provider_failure",
        deadLetter
      });
      if (deadLetter) deadLettered += 1;
      else retried += 1;
    }
  }

  return {
    healthChecked: healthChecks.length,
    healthConfirmed,
    healthFailed,
    held,
    claimed: actions.length,
    completed,
    retried,
    deadLettered
  };
}

export function createPostgresLiveSafetyRepository(databaseUrl?: string): LiveSafetyRepository {
  if (!databaseUrl) return createUnavailableLiveSafetyRepository();
  const sql = postgres(databaseUrl, { max: 4, idle_timeout: 20, connect_timeout: 10 });

  return {
    async claimHealthChecks(input) {
      const leaseToken = randomUUID();
      const rows = await sql<{
        id: string;
        room_id: string;
        provider_stream_id: string;
      }[]>`
        with candidates as (
          select session.id
          from live_safety_sessions session
          join live_rooms room on room.id = session.room_id
          where session.state in ('target_connected', 'monitoring')
            and session.next_check_at <= ${input.now}
            and (session.lease_expires_at is null or session.lease_expires_at <= ${input.now})
            and room.state = 'live'
            and room.provider_stream_id is not null
          order by session.next_check_at, session.created_at
          limit ${input.limit}
          for update of session skip locked
        )
        update live_safety_sessions session
        set lease_token = ${leaseToken}, lease_expires_at = ${input.now} + interval '2 minutes',
            updated_at = ${input.now}
        from candidates, live_rooms room
        where session.id = candidates.id and room.id = session.room_id
        returning session.id, session.room_id, room.provider_stream_id
      `;
      return rows.map((row) => ({
        id: row.id,
        roomId: row.room_id,
        providerStreamId: row.provider_stream_id,
        leaseToken
      }));
    },
    async completeHealthCheck(input) {
      if (input.healthy) {
        await sql`
          update live_safety_sessions
          set state = 'monitoring', last_heartbeat_at = ${input.observedAt},
              heartbeat_expires_at = ${input.observedAt} + interval '90 seconds',
              next_check_at = ${input.observedAt} + interval '30 seconds',
              lease_token = null, lease_expires_at = null, updated_at = ${input.observedAt}
          where id = ${input.id}
            and lease_token = ${input.leaseToken}
            and state in ('target_connected', 'monitoring')
        `;
        return;
      }
      await sql`
        update live_safety_sessions
        set state = 'monitoring',
            heartbeat_expires_at = case
              when last_heartbeat_at is null then null
              else ${input.observedAt}
            end,
            next_check_at = ${input.observedAt}, lease_token = null,
            lease_expires_at = null, updated_at = ${input.observedAt}
        where id = ${input.id}
          and lease_token = ${input.leaseToken}
          and state in ('target_connected', 'monitoring')
      `;
    },
    async holdDueSessions(input) {
      return sql.begin(async (transaction) => {
        const due = await transaction<{ session_id: string; room_id: string; reason_code: string }[]>`
          select
            session.id as session_id,
            room.id as room_id,
            case
              when session.state = 'monitoring' then 'live_monitoring_heartbeat_expired'
              else 'live_monitoring_not_connected'
            end as reason_code
          from live_safety_sessions session
          join live_rooms room on room.id = session.room_id
          where session.state in ${transaction([...liveSafetyHoldEligibleStates])}
            and session.next_check_at <= ${input.now}
            and not (session.id = any(${input.excludeSessionIds ?? []}::uuid[]))
            and (session.lease_expires_at is null or session.lease_expires_at <= ${input.now})
            and room.state = 'live'
            and (
              session.state <> 'monitoring'
              or session.heartbeat_expires_at is null
              or session.heartbeat_expires_at <= ${input.now}
            )
          order by session.next_check_at, session.created_at
          limit ${input.limit}
          for update of session, room skip locked
        `;

        for (const target of due) {
          await transaction`
            update live_safety_sessions
            set state = 'held', hold_reason_code = ${target.reason_code}, held_at = ${input.now},
                last_heartbeat_at = null, heartbeat_expires_at = null, updated_at = ${input.now}
            where id = ${target.session_id}
          `;
          await transaction`
            update media_safety_cases
            set state = 'review_required', reason_code = ${target.reason_code},
                provider_release_allowed = false, decided_at = null, updated_at = ${input.now}
            where live_room_id = ${target.room_id} and state <> 'superseded'
          `;
          await transaction`
            update live_rooms
            set state_before_suspension = 'live', state = 'suspended',
                provider_state = 'suspension_pending', playback_url = null,
                suspended_at = coalesce(suspended_at, ${input.now}),
                suspension_reason = ${target.reason_code}, updated_at = ${input.now}
            where id = ${target.room_id}
          `;
          await transaction`
            insert into live_safety_provider_actions (room_id, action, reason_code)
            values (${target.room_id}, 'suspend', ${target.reason_code})
            on conflict (room_id, action) where state in ('queued', 'processing', 'retry') do nothing
          `;
        }
        return due.length;
      });
    },
    async claimProviderActions(input) {
      const leaseToken = randomUUID();
      const rows = await sql<{
        id: string;
        room_id: string;
        provider_stream_id: string;
        attempt_count: number;
      }[]>`
        with candidates as (
          select action.id
          from live_safety_provider_actions action
          join live_rooms room on room.id = action.room_id
          where action.state in ('queued', 'retry', 'processing')
            and action.next_attempt_at <= ${input.now}
            and (action.lease_expires_at is null or action.lease_expires_at <= ${input.now})
            and room.provider_stream_id is not null
          order by action.next_attempt_at, action.created_at
          limit ${input.limit}
          for update of action skip locked
        )
        update live_safety_provider_actions action
        set state = 'processing', lease_token = ${leaseToken},
            lease_expires_at = ${input.now} + interval '2 minutes',
            attempt_count = attempt_count + 1, updated_at = ${input.now}
        from candidates, live_rooms room
        where action.id = candidates.id and room.id = action.room_id
        returning action.id, action.room_id, room.provider_stream_id, action.attempt_count
      `;
      return rows.map((row) => ({
        id: row.id,
        roomId: row.room_id,
        providerStreamId: row.provider_stream_id,
        leaseToken,
        attemptCount: Number(row.attempt_count)
      }));
    },
    async completeProviderAction(input) {
      await sql`
        update live_safety_provider_actions
        set state = 'completed', completed_at = ${input.now}, lease_token = null,
            lease_expires_at = null, last_failure_code = null, updated_at = ${input.now}
        where id = ${input.id} and lease_token = ${input.leaseToken}
      `;
    },
    async retryProviderAction(input) {
      await sql`
        update live_safety_provider_actions
        set state = ${input.deadLetter ? "dead_letter" : "retry"},
            next_attempt_at = ${input.retryAt}, lease_token = null, lease_expires_at = null,
            last_failure_code = ${input.failureCode}, updated_at = ${input.now}
        where id = ${input.id} and lease_token = ${input.leaseToken}
      `;
    },
    async close() {
      await sql.end({ timeout: 5 });
    }
  };
}

function createUnavailableLiveSafetyRepository(): LiveSafetyRepository {
  const unavailable = async (): Promise<never> => { throw new Error("DATABASE_URL_NOT_CONFIGURED"); };
  return {
    claimHealthChecks: unavailable,
    completeHealthCheck: unavailable,
    holdDueSessions: unavailable,
    claimProviderActions: unavailable,
    completeProviderAction: unavailable,
    retryProviderAction: unavailable
  };
}
