import { randomUUID } from "node:crypto";
import type postgres from "postgres";
import { withPostgresTransaction } from "../../shared/postgres.js";
import { providerEventReplayDecision } from "../../shared/provider-event-order.js";
import type { ContentItem, ContentRepository } from "./types.js";

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
type JsonObject = { [key: string]: JsonValue };

type ContentMediaRepositoryMethods = Required<Pick<
  ContentRepository,
  | "createMediaAsset"
  | "findMediaAssetByProviderAsset"
  | "findOwnedContentForUpload"
  | "findOwnedMediaAssetForSync"
  | "recordMediaProviderWebhook"
  | "updateMediaAssetFromWebhook"
  | "updateMediaAssetPlayback"
>>;

export function createContentMediaRepositoryMethods(
  sql: postgres.Sql
): ContentMediaRepositoryMethods {
  return {
    async createMediaAsset(input) {
      const rows = await withPostgresTransaction(sql, async (transaction) => {
        const mediaRows = await transaction<{ id: string }[]>`
          with inserted as (
            insert into media_assets (
              id,
              content_item_id,
              provider,
              provider_asset_id,
              provider_state
            )
            values (
              ${randomUUID()},
              ${input.contentId},
              ${input.provider},
              ${input.providerAssetId},
              ${input.providerState}
            )
            on conflict (provider, provider_asset_id) do nothing
            returning id
          )
          select id from inserted
          union all
          select id
          from media_assets
          where provider = ${input.provider}
            and provider_asset_id = ${input.providerAssetId}
          limit 1
        `;
        const mediaAsset = mediaRows[0];

        if (mediaAsset) {
          await transaction`
            insert into media_moderation_jobs (
              media_safety_case_id,
              media_asset_id,
              stage,
              state,
              idempotency_key
            )
            select
              msc.id,
              ${mediaAsset.id},
              'provider_scan_reconciliation',
              'queued',
              ${`media-safety:asset:${mediaAsset.id}:provider-scan-v1`}
            from media_safety_cases msc
            where msc.content_item_id = ${input.contentId}
              and msc.state <> 'superseded'
            on conflict (idempotency_key) do nothing
          `;

          await transaction`
            update media_safety_cases
            set
              state = 'preprocessing',
              reason_code = 'awaiting_provider_scan_reconciliation',
              provider_release_allowed = false,
              updated_at = now()
            where content_item_id = ${input.contentId}
              and state in ('quarantined', 'preprocessing')
          `;
        }

        return mediaRows;
      });

      return rows[0] ? { id: rows[0].id } : undefined;
    },
    async findMediaAssetByProviderAsset(input) {
      const rows = await sql<{ id: string }[]>`
        select id
        from media_assets
        where provider = ${input.provider}
          and provider_asset_id = ${input.providerAssetId}
        limit 1
      `;

      return rows[0] ?? null;
    },
    async findOwnedContentForUpload(input) {
      const rows = await sql<{
        id: string;
        media_type: ContentItem["mediaType"];
        caption: string | null;
        nsfw_label: NonNullable<ContentItem["nsfwLabel"]>;
      }[]>`
        select
          ci.id,
          ci.media_type,
          ci.caption,
          ci.nsfw_label
        from content_items ci
        join users u on u.id = ci.creator_user_id
        where ci.id = ${input.contentId}
          and u.supabase_user_id = ${input.supabaseUserId}
          and ci.state in ('draft', 'processing')
        limit 1
      `;

      const row = rows[0];

      return row
        ? {
            id: row.id,
            mediaType: row.media_type,
            caption: row.caption,
            nsfwLabel: row.nsfw_label
          }
        : null;
    },
    async findOwnedMediaAssetForSync(input) {
      const rows = await sql<
        { id: string; content_item_id: string; provider: "bunny"; provider_asset_id: string }[]
      >`
        select
          ma.id,
          ma.content_item_id,
          ma.provider,
          ma.provider_asset_id
        from media_assets ma
        join content_items ci on ci.id = ma.content_item_id
        join users u on u.id = ci.creator_user_id
        where ma.id = ${input.mediaAssetId}
          and ma.provider = 'bunny'
          and u.supabase_user_id = ${input.supabaseUserId}
        limit 1
      `;
      const row = rows[0];

      return row
        ? {
            id: row.id,
            contentId: row.content_item_id,
            provider: row.provider,
            providerAssetId: row.provider_asset_id
          }
        : null;
    },
    async updateMediaAssetPlayback(input) {
      await withPostgresTransaction(sql, async (transaction) => {
        const updatedAssets = await transaction<{ id: string }[]>`
          update media_assets
          set
            provider_state = ${input.providerState},
            provider_playable = ${input.providerPlayable},
            playback_url = ${input.playbackUrl ?? null},
            poster_url = coalesce(${input.posterUrl ?? null}, poster_url),
            duration_ms = coalesce(${input.durationMs ?? null}, duration_ms),
            ready_at = case when ${input.providerPlayable} then coalesce(ready_at, now()) else ready_at end,
            provider_checked_at = ${input.providerObservedAt}
          where id = ${input.mediaAssetId}
            and (provider_checked_at is null or provider_checked_at <= ${input.providerObservedAt})
            and not exists (
              select 1
              from provider_events newer
              where newer.provider = 'bunny'
                and newer.received_at > ${input.providerObservedAt}
                and newer.normalized_state is distinct from 'ignored_stale'
                and newer.replay_payload ->> 'kind' = 'media_asset'
                and newer.replay_payload ->> 'providerAssetId' = media_assets.provider_asset_id
            )
          returning id
        `;

        if (updatedAssets.length === 0) return;

        await transaction`
          update content_items ci
          set
            state = case when ${input.providerPlayable} then 'ready' else state end,
            updated_at = now()
          from media_assets ma
          where ma.content_item_id = ci.id
            and ma.id = ${input.mediaAssetId}
        `;
      });
    },
    async recordMediaProviderWebhook(input) {
      const insertedReceipts = await sql<{ id: string }[]>`
        insert into provider_webhook_receipts (
          id,
          provider,
          webhook_type,
          signature_hash,
          idempotency_key
        )
        values (
          ${randomUUID()},
          ${input.provider},
          'media-status',
          ${input.signatureHash ?? null},
          ${input.providerEventId}
        )
        on conflict (provider, webhook_type, idempotency_key) do nothing
        returning id
      `;

      if (insertedReceipts.length === 0) {
        return false;
      }

      await sql`
        insert into provider_events (
          id,
          provider,
          provider_event_id,
          event_type,
          normalized_state,
          replay_payload
        )
        values (
          ${randomUUID()},
          ${input.provider},
          ${input.providerEventId},
          ${input.eventType},
          ${input.normalizedState},
          ${sql.json(toJsonObject(input.replayPayload ?? {}))}
        )
        on conflict (provider, provider_event_id) do nothing
      `;

      return true;
    },
    async updateMediaAssetFromWebhook(input) {
      const rows = await withPostgresTransaction(sql, async (transaction) => {
        const currentRows = await transaction<{ id: string; provider_checked_at: Date | null }[]>`
          select id, provider_checked_at
          from media_assets
          where provider = ${input.provider}
            and provider_asset_id = ${input.providerAssetId}
          limit 1
          for update
        `;
        const current = currentRows[0];

        if (!current) {
          return [] as { id: string }[];
        }

        const replayDecision = await providerEventReplayDecision(
          transaction,
          {
            provider: input.provider,
            providerEventId: input.providerEventId,
            subject: { kind: "media_asset", providerAssetId: input.providerAssetId },
            subjectObservedAt: current.provider_checked_at
          }
        );

        if (replayDecision === "already_applied") {
          return [{ id: current.id }];
        }

        if (replayDecision === "stale") {
          await transaction`
            update provider_events
            set normalized_state = 'ignored_stale', processed_at = now()
            where provider = ${input.provider}
              and provider_event_id = ${input.providerEventId}
          `;
          return [{ id: current.id }];
        }

        const updated = await transaction<{ id: string }[]>`
          update media_assets
          set
            provider_state = ${input.providerState},
            provider_playable = ${input.providerPlayable},
            ready_at = case when ${input.providerPlayable} then coalesce(ready_at, now()) else ready_at end
          where id = ${current.id}
          returning id
        `;

        await transaction`
          update content_items ci
          set
            state = case when ${input.providerPlayable} then 'ready' else state end,
            updated_at = now()
          from media_assets ma
          where ma.content_item_id = ci.id
            and ma.provider = ${input.provider}
            and ma.provider_asset_id = ${input.providerAssetId}
        `;

        await transaction`
          update provider_events
          set
            normalized_state = ${input.providerState},
            processed_at = now()
          where provider = ${input.provider}
            and provider_event_id = ${input.providerEventId}
        `;

        return updated;
      });

      return rows.length > 0;
    }
  };
}

function toJsonObject(value: Record<string, unknown>): JsonObject {
  return JSON.parse(JSON.stringify(value)) as JsonObject;
}
