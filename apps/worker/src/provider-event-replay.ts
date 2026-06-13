import postgres from "postgres";

export type ProviderEventReplayOutcome =
  | { state: "replayed" }
  | { state: "failed"; failureCode: string };

export interface QueuedProviderEventReplay {
  replayRequestId: string;
  providerEventId: string;
  provider: string;
  eventType: string;
  replayPayload: unknown;
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

export interface ProviderSpecificReplayHandlers {
  helius?: (input: HeliusReplayEvent) => Promise<ProviderEventReplayOutcome>;
  bunny?: (input: BunnyReplayEvent) => Promise<ProviderEventReplayOutcome>;
  livepeer?: (input: LivepeerReplayEvent) => Promise<ProviderEventReplayOutcome>;
}

export interface HeliusReplayEvent extends QueuedProviderEventReplay {
  provider: "helius" | "solana_indexer";
  replayPayload: {
    kind: "solana_payment";
    signature: string;
    referenceAddresses: string[];
  };
}

export interface BunnyReplayEvent extends QueuedProviderEventReplay {
  provider: "bunny";
  replayPayload: {
    kind: "media_asset";
    providerAssetId: string;
    providerState: string;
    providerPlayable: boolean;
  };
}

export interface LivepeerReplayEvent extends QueuedProviderEventReplay {
  provider: "livepeer";
  replayPayload: {
    kind: "livepeer_stream";
    providerStreamId: string;
    providerPlaybackId: string | null;
    providerState: string;
    roomState: "waiting" | "live" | "ended" | "replay_ready";
    playbackUrl: string | null;
  };
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

export function createProviderSpecificReplayAdapter(
  handlers: ProviderSpecificReplayHandlers
): ProviderEventReplayAdapter {
  return {
    async replay(input) {
      if (input.provider === "helius" || input.provider === "solana_indexer") {
        const event = toHeliusReplayEvent(input);
        if (!event) return missingReplayPayload(input);
        return handlers.helius
          ? handlers.helius(event)
          : missingReplayHandler(input);
      }

      if (input.provider === "bunny") {
        const event = toBunnyReplayEvent(input);
        if (!event) return missingReplayPayload(input);
        return handlers.bunny
          ? handlers.bunny(event)
          : missingReplayHandler(input);
      }

      if (input.provider === "livepeer") {
        const event = toLivepeerReplayEvent(input);
        if (!event) return missingReplayPayload(input);
        return handlers.livepeer
          ? handlers.livepeer(event)
          : missingReplayHandler(input);
      }

      return {
        state: "failed",
        failureCode: `provider_event_replay_provider_unsupported:${input.provider}`
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
            pe.event_type,
            pe.replay_payload
        `;

        return rows.map((row) => ({
          replayRequestId: row.replay_request_id,
          providerEventId: row.provider_event_id,
          provider: row.provider,
          eventType: row.event_type,
          replayPayload: row.replay_payload
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
  replay_payload: unknown;
}

function missingReplayPayload(input: QueuedProviderEventReplay): ProviderEventReplayOutcome {
  return {
    state: "failed",
    failureCode: `provider_event_replay_payload_missing:${input.provider}`
  };
}

function missingReplayHandler(input: QueuedProviderEventReplay): ProviderEventReplayOutcome {
  return {
    state: "failed",
    failureCode: `provider_event_replay_handler_not_configured:${input.provider}`
  };
}

function objectPayload(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function booleanValue(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function stringArrayValue(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const values = value.filter((entry): entry is string => typeof entry === "string" && entry.length > 0);
  return values.length === value.length && values.length > 0 ? values : null;
}

function nullableStringValue(value: unknown): string | null {
  return value === null || value === undefined ? null : stringValue(value);
}

function toHeliusReplayEvent(input: QueuedProviderEventReplay): HeliusReplayEvent | null {
  const payload = objectPayload(input.replayPayload);
  const signature = stringValue(payload?.signature);
  const referenceAddresses = stringArrayValue(payload?.referenceAddresses);
  if (
    (input.provider !== "helius" && input.provider !== "solana_indexer") ||
    payload?.kind !== "solana_payment" ||
    !signature ||
    !referenceAddresses
  ) {
    return null;
  }

  return {
    ...input,
    provider: input.provider,
    replayPayload: {
      kind: "solana_payment",
      signature,
      referenceAddresses
    }
  };
}

function toBunnyReplayEvent(input: QueuedProviderEventReplay): BunnyReplayEvent | null {
  const payload = objectPayload(input.replayPayload);
  const providerAssetId = stringValue(payload?.providerAssetId);
  const providerState = stringValue(payload?.providerState);
  const providerPlayable = booleanValue(payload?.providerPlayable);
  if (payload?.kind !== "media_asset" || !providerAssetId || !providerState || providerPlayable === null) {
    return null;
  }

  return {
    ...input,
    provider: "bunny",
    replayPayload: {
      kind: "media_asset",
      providerAssetId,
      providerState,
      providerPlayable
    }
  };
}

function toLivepeerReplayEvent(input: QueuedProviderEventReplay): LivepeerReplayEvent | null {
  const payload = objectPayload(input.replayPayload);
  const providerStreamId = stringValue(payload?.providerStreamId);
  const providerState = stringValue(payload?.providerState);
  const roomState = stringValue(payload?.roomState);
  if (
    payload?.kind !== "livepeer_stream" ||
    !providerStreamId ||
    !providerState ||
    !isLivepeerRoomState(roomState)
  ) {
    return null;
  }

  return {
    ...input,
    provider: "livepeer",
    replayPayload: {
      kind: "livepeer_stream",
      providerStreamId,
      providerPlaybackId: nullableStringValue(payload.providerPlaybackId),
      providerState,
      roomState,
      playbackUrl: nullableStringValue(payload.playbackUrl)
    }
  };
}

function isLivepeerRoomState(value: string | null): value is LivepeerReplayEvent["replayPayload"]["roomState"] {
  return value === "waiting" || value === "live" || value === "ended" || value === "replay_ready";
}
