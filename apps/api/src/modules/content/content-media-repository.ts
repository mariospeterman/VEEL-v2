import { randomUUID } from "node:crypto";
import type postgres from "postgres";
import type { ContentItem, ContentRepository } from "./types.js";

type ContentMediaRepositoryMethods = Pick<
  ContentRepository,
  | "createMediaAsset"
  | "findOwnedContentForUpload"
  | "findOwnedMediaAssetForSync"
  | "recordMediaProviderWebhook"
  | "updateMediaAssetFromWebhook"
  | "updateMediaAssetPlayback"
>;

export function createContentMediaRepositoryMethods(
  sql: postgres.Sql
): ContentMediaRepositoryMethods {
  return {
    async createMediaAsset(input) {
      await sql`
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
      `;
    },
    async findOwnedContentForUpload(input) {
      const rows = await sql<{ id: string; media_type: ContentItem["mediaType"]; caption: string | null }[]>`
        select
          ci.id,
          ci.media_type,
          ci.caption
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
            caption: row.caption
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
      await sql.begin(async (transaction) => {
        await transaction`
          update media_assets
          set
            provider_state = ${input.providerState},
            provider_playable = ${input.providerPlayable},
            playback_url = ${input.playbackUrl ?? null},
            poster_url = coalesce(${input.posterUrl ?? null}, poster_url),
            duration_ms = coalesce(${input.durationMs ?? null}, duration_ms),
            ready_at = case when ${input.providerPlayable} then coalesce(ready_at, now()) else ready_at end,
            provider_checked_at = now()
          where id = ${input.mediaAssetId}
        `;
        await transaction`
          update content_items ci
          set
            state = case when ${input.providerPlayable} then 'ready' else state end,
            moderation_state = case when ${input.providerPlayable} then 'approved' else moderation_state end,
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
          normalized_state
        )
        values (
          ${randomUUID()},
          ${input.provider},
          ${input.providerEventId},
          ${input.eventType},
          ${input.normalizedState}
        )
        on conflict (provider, provider_event_id) do nothing
      `;

      return true;
    },
    async updateMediaAssetFromWebhook(input) {
      const rows = await sql.begin(async (transaction) => {
        const updated = await transaction<{ id: string }[]>`
          update media_assets
          set
            provider_state = ${input.providerState},
            provider_playable = ${input.providerPlayable},
            ready_at = case when ${input.providerPlayable} then coalesce(ready_at, now()) else ready_at end,
            provider_checked_at = now()
          where provider = ${input.provider}
            and provider_asset_id = ${input.providerAssetId}
          returning id
        `;

        await transaction`
          update content_items ci
          set
            state = case when ${input.providerPlayable} then 'ready' else state end,
            moderation_state = case when ${input.providerPlayable} then 'approved' else moderation_state end,
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
