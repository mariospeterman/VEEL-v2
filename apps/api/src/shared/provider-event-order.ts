import type { PostgresTransaction } from "./postgres.js";

type ProviderEventSubject =
  | { kind: "media_asset"; providerAssetId: string }
  | { kind: "livepeer_stream"; providerStreamId: string };

export async function isLatestProviderEventForSubject(
  transaction: PostgresTransaction,
  input: {
    provider: "bunny" | "livepeer";
    providerEventId: string;
    subject: ProviderEventSubject;
    subjectObservedAt?: Date | null;
  }
): Promise<boolean> {
  const rows = input.subject.kind === "media_asset"
    ? await transaction<{ is_latest: boolean }[]>`
        select not exists (
          select 1
          from provider_events newer
          where newer.provider = current_event.provider
            and newer.delivery_sequence > current_event.delivery_sequence
            and newer.replay_payload ->> 'kind' = 'media_asset'
            and newer.replay_payload ->> 'providerAssetId' = ${input.subject.providerAssetId}
        ) as is_latest
        from provider_events current_event
        where current_event.provider = ${input.provider}
          and current_event.provider_event_id = ${input.providerEventId}
          and (
            ${!input.subjectObservedAt}
            or current_event.received_at >= ${input.subjectObservedAt ?? new Date(0)}
          )
        limit 1
      `
    : await transaction<{ is_latest: boolean }[]>`
        select not exists (
          select 1
          from provider_events newer
          where newer.provider = current_event.provider
            and newer.delivery_sequence > current_event.delivery_sequence
            and newer.replay_payload ->> 'kind' = 'livepeer_stream'
            and newer.replay_payload ->> 'providerStreamId' = ${input.subject.providerStreamId}
        ) as is_latest
        from provider_events current_event
        where current_event.provider = ${input.provider}
          and current_event.provider_event_id = ${input.providerEventId}
          and (
            ${!input.subjectObservedAt}
            or current_event.received_at >= ${input.subjectObservedAt ?? new Date(0)}
          )
        limit 1
      `;

  return rows[0]?.is_latest === true;
}
