import type { PostgresTransaction } from "./postgres.js";

type ProviderEventSubject =
  | { kind: "media_asset"; providerAssetId: string }
  | { kind: "livepeer_stream"; providerStreamId: string };

export type ProviderEventReplayDecision = "apply" | "already_applied" | "stale";

export async function providerEventReplayDecision(
  transaction: PostgresTransaction,
  input: {
    provider: "bunny" | "livepeer";
    providerEventId: string;
    subject: ProviderEventSubject;
    subjectObservedAt?: Date | null;
  }
): Promise<ProviderEventReplayDecision> {
  const rows = input.subject.kind === "media_asset"
    ? await transaction<{ is_latest: boolean; processed_at: Date | null }[]>`
        select
          current_event.processed_at,
          (
            (${!input.subjectObservedAt} or current_event.received_at >= ${input.subjectObservedAt ?? new Date(0)})
            and not exists (
              select 1
              from provider_events newer
              where newer.provider = current_event.provider
                and newer.delivery_sequence > current_event.delivery_sequence
                and newer.normalized_state is distinct from 'ignored_stale'
                and newer.replay_payload ->> 'kind' = 'media_asset'
                and newer.replay_payload ->> 'providerAssetId' = ${input.subject.providerAssetId}
            )
          ) as is_latest
        from provider_events current_event
        where current_event.provider = ${input.provider}
          and current_event.provider_event_id = ${input.providerEventId}
        limit 1
      `
    : await transaction<{ is_latest: boolean; processed_at: Date | null }[]>`
        select
          current_event.processed_at,
          (
            (${!input.subjectObservedAt} or current_event.received_at >= ${input.subjectObservedAt ?? new Date(0)})
            and not exists (
              select 1
              from provider_events newer
              where newer.provider = current_event.provider
                and newer.delivery_sequence > current_event.delivery_sequence
                and newer.normalized_state is distinct from 'ignored_stale'
                and newer.replay_payload ->> 'kind' = 'livepeer_stream'
                and newer.replay_payload ->> 'providerStreamId' = ${input.subject.providerStreamId}
            )
          ) as is_latest
        from provider_events current_event
        where current_event.provider = ${input.provider}
          and current_event.provider_event_id = ${input.providerEventId}
        limit 1
      `;

  const event = rows[0];
  if (!event) return "stale";
  if (event.processed_at) return "already_applied";
  return event.is_latest ? "apply" : "stale";
}
