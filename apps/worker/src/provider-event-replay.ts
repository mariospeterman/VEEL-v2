import postgres from "postgres";

export type ProviderEventReplayOutcome =
  | { state: "replayed" }
  | { state: "failed"; failureCode: string };

export interface QueuedProviderEventReplay {
  replayRequestId: string;
  providerEventId: string;
  provider: string;
  eventType: string;
}

export interface ProviderEventReplayRepository {
  leaseQueuedReplayRequests(input: { now: Date; limit: number }): Promise<QueuedProviderEventReplay[]>;
  recordReplayOutcome(input: {
    replayRequestId: string;
    providerEventId: string;
    outcome: ProviderEventReplayOutcome;
  }): Promise<void>;
  close?(): Promise<void>;
}

export interface ProviderEventReplayAdapter {
  replay(input: QueuedProviderEventReplay): Promise<ProviderEventReplayOutcome>;
}

export interface ProcessProviderEventReplaysResult {
  leased: number;
  replayed: number;
  failed: number;
}

export async function processProviderEventReplays(input: {
  repository: ProviderEventReplayRepository;
  adapter: ProviderEventReplayAdapter;
  now?: Date;
  limit?: number;
}): Promise<ProcessProviderEventReplaysResult> {
  const now = input.now ?? new Date();
  const limit = input.limit ?? 25;
  const requests = await input.repository.leaseQueuedReplayRequests({ now, limit });
  const result: ProcessProviderEventReplaysResult = {
    leased: requests.length,
    replayed: 0,
    failed: 0
  };

  for (const request of requests) {
    const outcome = await input.adapter.replay(request).catch((error: unknown): ProviderEventReplayOutcome => ({
      state: "failed",
      failureCode: providerReplayFailureCode(error)
    }));
    await input.repository.recordReplayOutcome({
      replayRequestId: request.replayRequestId,
      providerEventId: request.providerEventId,
      outcome
    });

    if (outcome.state === "replayed") result.replayed += 1;
    else result.failed += 1;
  }

  return result;
}

function providerReplayFailureCode(error: unknown): string {
  if (error instanceof Error && error.message) {
    return `provider_event_replay_exception:${error.message.slice(0, 80)}`;
  }

  return "provider_event_replay_exception";
}

export function createUnconfiguredProviderEventReplayAdapter(): ProviderEventReplayAdapter {
  return {
    async replay() {
      return {
        state: "failed",
        failureCode: "provider_event_replay_adapter_not_configured"
      };
    }
  };
}

export function createPostgresProviderEventReplayRepository(
  databaseUrl?: string
): ProviderEventReplayRepository {
  if (!databaseUrl) {
    return {
      async leaseQueuedReplayRequests() {
        return [];
      },
      async recordReplayOutcome() {
        return;
      }
    };
  }

  const sql = postgres(databaseUrl, {
    max: 3,
    idle_timeout: 20,
    prepare: false
  });

  return {
    async leaseQueuedReplayRequests(input) {
      return sql.begin(async (transaction) => {
        const rows = await transaction<QueuedProviderEventReplayRow[]>`
          update provider_event_replay_requests perr
          set
            state = 'processing',
            leased_at = ${input.now},
            attempt_count = perr.attempt_count + 1,
            updated_at = now()
          from (
            select id
            from provider_event_replay_requests
            where state = 'queued'
            order by created_at asc
            limit ${input.limit}
            for update skip locked
          ) due,
          provider_events pe
          where perr.id = due.id
            and pe.id = perr.provider_event_id
          returning
            perr.id as replay_request_id,
            pe.id as provider_event_id,
            pe.provider,
            pe.event_type
        `;

        return rows.map((row) => ({
          replayRequestId: row.replay_request_id,
          providerEventId: row.provider_event_id,
          provider: row.provider,
          eventType: row.event_type
        }));
      });
    },

    async recordReplayOutcome(input) {
      if (input.outcome.state === "replayed") {
        await sql.begin(async (transaction) => {
          await transaction`
            update provider_event_replay_requests
            set
              state = 'replayed',
              processed_at = now(),
              failure_code = null,
              updated_at = now()
            where id = ${input.replayRequestId}
          `;
          await transaction`
            update provider_events
            set
              normalized_state = 'replayed',
              processed_at = coalesce(processed_at, now())
            where id = ${input.providerEventId}
          `;
        });
        return;
      }

      await sql`
        update provider_event_replay_requests
        set
          state = 'failed',
          processed_at = now(),
          failure_code = ${input.outcome.failureCode},
          updated_at = now()
        where id = ${input.replayRequestId}
      `;
    },

    async close() {
      await sql.end();
    }
  };
}

interface QueuedProviderEventReplayRow {
  replay_request_id: string;
  provider_event_id: string;
  provider: string;
  event_type: string;
}
