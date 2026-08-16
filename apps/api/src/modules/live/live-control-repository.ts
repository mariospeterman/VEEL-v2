import { randomUUID } from "node:crypto";
import type postgres from "postgres";
import { LiveControlIdempotencyConflictError } from "./live-errors.js";
import { toLiveRoom } from "./live-repository-mappers.js";
import type { LiveRoomRow } from "./live-repository-rows.js";
import { liveRoomSelectSql } from "./live-repository-sql.js";
import type { LiveControlAction, LiveControlReservation, LiveRepository } from "./types.js";

interface ControlRow {
  id: string;
  room_id: string;
  action: LiveControlAction;
  state: LiveControlReservation["state"];
  request_hash: string;
  provider_stream_id: string | null;
}

export function createLiveControlRepositoryMethods(
  sql: postgres.Sql
): Pick<
  LiveRepository,
  | "completeControl"
  | "failControl"
  | "listOwnedRooms"
  | "reserveOwnedControl"
  | "reserveStaffControl"
  | "revealHostConnection"
> {
  return {
    async listOwnedRooms(input) {
      const rows = await sql<LiveRoomRow[]>`
        with target_user as (
          select id from users where supabase_user_id = ${input.supabaseUserId} limit 1
        )
        ${liveRoomSelectSql(sql)}
        where lr.creator_user_id = (select id from target_user)
        order by lr.created_at desc
        limit 20
      `;

      return { items: rows.map(toLiveRoom), nextCursor: null };
    },
    async revealHostConnection(input) {
      return sql.begin(async (transaction) => {
        const existing = await findControlByActorKey(
          transaction,
          input.supabaseUserId,
          input.idempotencyKey
        );
        assertMatchingControl(existing, input.roomId, "host_credentials_revealed", input.requestHash);

        const rooms = await transaction<
          { id: string; actor_user_id: string; host_ingest_url: string | null; host_stream_key: string | null }[]
        >`
          select lr.id, actor.id as actor_user_id, lr.host_ingest_url, lr.host_stream_key
          from users actor
          join live_rooms lr on lr.creator_user_id = actor.id
          where actor.supabase_user_id = ${input.supabaseUserId}
            and actor.state = 'active'
            and lr.id = ${input.roomId}
            and lr.state in ('scheduled', 'waiting', 'live')
          for update of lr
        `;
        const room = rooms[0];
        if (!room?.host_ingest_url || !room.host_stream_key) return null;

        if (!existing) {
          const controlId = randomUUID();
          await transaction`
            insert into live_room_control_actions (
              id, room_id, actor_user_id, action, state, idempotency_key, request_hash,
              attempt_count, completed_at
            )
            values (
              ${controlId}, ${room.id}, ${room.actor_user_id}, 'host_credentials_revealed',
              'completed', ${input.idempotencyKey}, ${input.requestHash}, 1, now()
            )
          `;
          await insertControlAudit(transaction, {
            actorUserId: room.actor_user_id,
            roomId: room.id,
            action: "live_host_credentials_revealed",
            controlId
          });
        }

        return {
          provider: "livepeer" as const,
          ingestUrl: room.host_ingest_url,
          streamKey: room.host_stream_key,
          securityNotice: "never_share_or_store_this_stream_key" as const
        };
      });
    },
    async reserveOwnedControl(input) {
      return sql.begin(async (transaction) => {
        const actorRows = await transaction<{ id: string }[]>`
          select id from users
          where supabase_user_id = ${input.supabaseUserId} and state = 'active'
          limit 1
        `;
        const actor = actorRows[0];
        if (!actor) return null;

        const existing = await findControlByActorKey(
          transaction,
          input.supabaseUserId,
          input.idempotencyKey
        );
        assertMatchingControl(existing, input.roomId, input.action, input.requestHash);
        if (existing?.state === "completed") return toReservation(existing);

        const rooms = await transaction<{ id: string; provider_stream_id: string | null }[]>`
          select id, provider_stream_id
          from live_rooms
          where id = ${input.roomId}
            and creator_user_id = ${actor.id}
          for update
        `;
        const room = rooms[0];
        if (!room?.provider_stream_id) return null;

        const control = existing
          ? await retryControl(transaction, existing.id)
          : await insertControl(transaction, {
              roomId: room.id,
              actorUserId: actor.id,
              action: input.action,
              idempotencyKey: input.idempotencyKey,
              requestHash: input.requestHash,
              reason: null
            });

        await transaction`
          update live_rooms
          set state = 'ended', provider_state = 'termination_pending',
              ended_at = coalesce(ended_at, now()), updated_at = now()
          where id = ${room.id} and state not in ('ended', 'replay_ready')
        `;
        await closeEventAccessWindow(transaction, room.id);

        return { ...toReservation(control), providerStreamId: room.provider_stream_id };
      });
    },
    async reserveStaffControl(input) {
      return sql.begin(async (transaction) => {
        const actorRows = await transaction<{ id: string }[]>`
          select u.id
          from users u
          join staff_memberships sm on sm.user_id = u.id
          where u.supabase_user_id = ${input.supabaseUserId}
            and u.state = 'active'
            and sm.state = 'active'
            and sm.role in ('owner', 'admin', 'trust_safety')
          limit 1
        `;
        const actor = actorRows[0];
        if (!actor) return null;

        const existing = await findControlByActorKey(
          transaction,
          input.supabaseUserId,
          input.idempotencyKey
        );
        assertMatchingControl(existing, input.roomId, input.action, input.requestHash);
        if (existing?.state === "completed") return toReservation(existing);

        const rooms = await transaction<
          { id: string; provider_stream_id: string | null; state: string }[]
        >`
          select id, provider_stream_id, state
          from live_rooms
          where id = ${input.roomId}
          for update
        `;
        const room = rooms[0];
        if (!room?.provider_stream_id) return null;

        const control = existing
          ? await retryControl(transaction, existing.id)
          : await insertControl(transaction, {
              roomId: room.id,
              actorUserId: actor.id,
              action: input.action,
              idempotencyKey: input.idempotencyKey,
              requestHash: input.requestHash,
              reason: input.reason
            });

        if (input.action === "staff_suspended") {
          await transaction`
            update live_rooms
            set
              state_before_suspension = case
                when state in ('scheduled', 'waiting', 'live') then state
                else coalesce(state_before_suspension, 'waiting')
              end,
              state = 'suspended',
              provider_state = 'suspension_pending',
              suspended_at = coalesce(suspended_at, now()),
              suspended_by_user_id = ${actor.id},
              suspension_reason = ${input.reason},
              updated_at = now()
            where id = ${room.id}
          `;
          await transaction`
            update media_safety_cases
            set state = 'review_required', decision_source = 'staff',
                reason_code = 'live_staff_suspended', provider_release_allowed = false,
                reviewed_by_user_id = ${actor.id}, updated_at = now()
            where live_room_id = ${room.id} and state <> 'superseded'
          `;
        }

        return { ...toReservation(control), providerStreamId: room.provider_stream_id };
      });
    },
    async completeControl(input) {
      await sql.begin(async (transaction) => {
        const controls = await transaction<
          { room_id: string; action: LiveControlAction; actor_user_id: string; reason: string | null }[]
        >`
          update live_room_control_actions
          set state = 'completed', provider_failure_kind = null, provider_status_code = null,
              completed_at = coalesce(completed_at, now()), updated_at = now()
          where id = ${input.controlId}
          returning room_id, action, actor_user_id, reason
        `;
        const control = controls[0];
        if (!control) return;

        await transaction`
          update live_rooms
          set
            state = ${input.state},
            provider_state = ${input.providerState},
            starts_at = case when ${input.state} = 'live' then coalesce(starts_at, now()) else starts_at end,
            ended_at = case when ${input.state} = 'ended' then coalesce(ended_at, now()) else ended_at end,
            suspended_at = case when ${input.state} = 'suspended' then coalesce(suspended_at, now()) else null end,
            suspended_by_user_id = case when ${input.state} = 'suspended' then suspended_by_user_id else null end,
            suspension_reason = case when ${input.state} = 'suspended' then suspension_reason else null end,
            state_before_suspension = case when ${input.state} = 'suspended' then state_before_suspension else null end,
            updated_at = now()
          where id = ${control.room_id}
        `;

        if (control.action === "staff_resumed") {
          await transaction`
            update media_safety_cases
            set state = 'approved', decision_source = 'staff', reason_code = 'live_staff_resumed',
                provider_release_allowed = true, reviewed_by_user_id = ${control.actor_user_id},
                decided_at = now(), updated_at = now()
            where live_room_id = ${control.room_id} and state <> 'superseded'
          `;
        }

        await insertControlAudit(transaction, {
          actorUserId: control.actor_user_id,
          roomId: control.room_id,
          action: `live_${control.action}`,
          controlId: input.controlId,
          reason: control.reason
        });
      });
    },
    async failControl(input) {
      await sql`
        update live_room_control_actions
        set state = 'failed', provider_failure_kind = ${input.providerFailureKind},
            provider_status_code = ${input.providerStatusCode}, updated_at = now()
        where id = ${input.controlId}
      `;
    }
  };
}

async function findControlByActorKey(
  transaction: postgres.TransactionSql,
  supabaseUserId: string,
  idempotencyKey: string
): Promise<ControlRow | null> {
  const rows = await transaction<ControlRow[]>`
    select lrca.id, lrca.room_id, lrca.action, lrca.state, lrca.request_hash,
           lr.provider_stream_id
    from users actor
    join live_room_control_actions lrca on lrca.actor_user_id = actor.id
    join live_rooms lr on lr.id = lrca.room_id
    where actor.supabase_user_id = ${supabaseUserId}
      and lrca.idempotency_key = ${idempotencyKey}
    limit 1
    for update of lrca
  `;
  return rows[0] ?? null;
}

function assertMatchingControl(
  existing: ControlRow | null,
  roomId: string,
  action: LiveControlAction,
  requestHash: string
): void {
  if (
    existing &&
    (existing.room_id !== roomId || existing.action !== action || existing.request_hash !== requestHash)
  ) {
    throw new LiveControlIdempotencyConflictError();
  }
}

function toReservation(row: ControlRow): LiveControlReservation {
  if (!row.provider_stream_id) {
    return {
      id: row.id,
      roomId: row.room_id,
      action: row.action,
      state: row.state,
      providerStreamId: ""
    };
  }
  return {
    id: row.id,
    roomId: row.room_id,
    action: row.action,
    state: row.state,
    providerStreamId: row.provider_stream_id
  };
}

async function insertControl(
  transaction: postgres.TransactionSql,
  input: {
    roomId: string;
    actorUserId: string;
    action: LiveControlAction;
    idempotencyKey: string;
    requestHash: string;
    reason: string | null;
  }
): Promise<ControlRow> {
  const rows = await transaction<ControlRow[]>`
    insert into live_room_control_actions (
      id, room_id, actor_user_id, action, state, idempotency_key, request_hash, reason, attempt_count
    )
    values (
      ${randomUUID()}, ${input.roomId}, ${input.actorUserId}, ${input.action}, 'pending',
      ${input.idempotencyKey}, ${input.requestHash}, ${input.reason}, 1
    )
    returning id, room_id, action, state, request_hash, null::text as provider_stream_id
  `;
  return rows[0] as ControlRow;
}

async function retryControl(
  transaction: postgres.TransactionSql,
  controlId: string
): Promise<ControlRow> {
  const rows = await transaction<ControlRow[]>`
    update live_room_control_actions
    set state = 'pending', attempt_count = attempt_count + 1,
        provider_failure_kind = null, provider_status_code = null, updated_at = now()
    where id = ${controlId}
    returning id, room_id, action, state, request_hash, null::text as provider_stream_id
  `;
  return rows[0] as ControlRow;
}

async function insertControlAudit(
  transaction: postgres.TransactionSql,
  input: {
    actorUserId: string;
    roomId: string;
    action: string;
    controlId: string;
    reason?: string | null;
  }
): Promise<void> {
  await transaction`
    insert into audit_events (id, actor_user_id, subject_type, subject_id, action, metadata)
    values (
      ${randomUUID()}, ${input.actorUserId}, 'live_room', ${input.roomId}, ${input.action},
      ${transaction.json({ controlId: input.controlId, reason: input.reason ?? null })}
    )
  `;
}

async function closeEventAccessWindow(
  transaction: postgres.TransactionSql,
  roomId: string
): Promise<void> {
  await transaction`
    with access_window as (
      select id, ended_at + make_interval(hours => replay_window_hours) as expires_at
      from live_rooms
      where id = ${roomId} and access_rule = 'paid_event' and ended_at is not null
    ),
    updated_passes as (
      update live_passes lp
      set expires_at = aw.expires_at
      from access_window aw
      where lp.room_id = aw.id and lp.state = 'active'
      returning lp.payment_intent_id, lp.expires_at
    )
    update entitlements e
    set ends_at = up.expires_at
    from updated_passes up
    where e.payment_intent_id = up.payment_intent_id and e.product_type = 'live_pass'
  `;
}
