import { createHash, randomUUID } from "node:crypto";
import type postgres from "postgres";
import { withPostgresTransaction } from "../../shared/postgres.js";
import { ContentImageUploadConflictError } from "./content-errors.js";
import {
  captureProviderObservationCutoff,
  providerEventReplayDecision
} from "../../shared/provider-event-order.js";
import type { ContentItem, ContentRepository } from "./types.js";
import type { MediaAssetMutationResult } from "./types.js";

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
type JsonObject = { [key: string]: JsonValue };

type ContentMediaRepositoryMethods = Required<Pick<
  ContentRepository,
  | "captureProviderObservationCutoff"
  | "completeImageAssetUpload"
  | "createMediaAsset"
  | "findMediaAssetByProviderAsset"
  | "findOwnedContentForUpload"
  | "findOwnedMediaAssetForSync"
  | "recordMediaProviderWebhook"
  | "reserveImageAssetUpload"
  | "updateMediaAssetFromWebhook"
  | "updateMediaAssetPlayback"
  | "updateOwnedMediaAsset"
>>;

export function createContentMediaRepositoryMethods(
  sql: postgres.Sql
): ContentMediaRepositoryMethods {
  return {
    async captureProviderObservationCutoff() {
      return captureProviderObservationCutoff(sql);
    },
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
    async reserveImageAssetUpload(input) {
      return withPostgresTransaction(sql, async (transaction) => {
        const actorRows = await transaction<{ id: string }[]>`
          select id from users where supabase_user_id = ${input.supabaseUserId} limit 1
        `;
        const actor = actorRows[0];
        if (!actor) throw new ContentImageUploadConflictError("draft_locked");

        const drafts = await transaction<{ id: string; media_type: string }[]>`
          select id, media_type
          from content_items
          where id = ${input.contentId}
            and creator_user_id = ${actor.id}
            and state <> 'deleted'
            and publish_state in ('draft', 'unpublished')
          for update
        `;
        const draft = drafts[0];
        if (!draft) throw new ContentImageUploadConflictError("draft_locked");
        if (!['image', 'carousel'].includes(draft.media_type)) {
          throw new ContentImageUploadConflictError("format_invalid");
        }

        const receiptKey = `content:image-upload:${actor.id}:${input.idempotencyKey}`;
        await transaction`
          insert into idempotency_keys (key, actor_user_id, scope, request_hash, expires_at)
          values (${receiptKey}, ${actor.id}, 'content.image-upload', ${input.requestHash}, 'infinity'::timestamptz)
          on conflict (key) do nothing
        `;
        const receipts = await transaction<{
          request_hash: string;
          response_body: { mediaAssetId?: string; providerAssetId?: string } | null;
        }[]>`
          select request_hash, response_body
          from idempotency_keys
          where key = ${receiptKey}
          for update
        `;
        const receipt = receipts[0];
        if (!receipt || receipt.request_hash !== input.requestHash) {
          throw new ContentImageUploadConflictError("idempotency_conflict");
        }

        if (receipt.response_body?.mediaAssetId && receipt.response_body.providerAssetId) {
          const existing = await transaction<{ provider_state: string }[]>`
            select provider_state
            from media_assets
            where id = ${receipt.response_body.mediaAssetId}
              and content_item_id = ${input.contentId}
              and provider_asset_id = ${receipt.response_body.providerAssetId}
            limit 1
          `;
          if (!existing[0]) throw new ContentImageUploadConflictError("receipt_invalid");
          return {
            mediaAssetId: receipt.response_body.mediaAssetId,
            providerAssetId: receipt.response_body.providerAssetId,
            completed: existing[0].provider_state === "stored_private"
          };
        }

        await transaction`
          insert into media_assets (
            id,
            content_item_id,
            provider,
            provider_asset_id,
            provider_state,
            provider_playable,
            asset_kind,
            mime_type,
            width_pixels,
            height_pixels,
            checksum_sha256,
            required_for_release
          )
          values (
            ${input.mediaAssetId},
            ${input.contentId},
            'bunny',
            ${input.providerAssetId},
            'uploading_private',
            false,
            'image',
            ${input.mimeType},
            ${input.widthPixels},
            ${input.heightPixels},
            ${input.checksumSha256},
            true
          )
        `;

        await transaction`
          insert into media_moderation_jobs (
            media_safety_case_id,
            media_asset_id,
            stage,
            state,
            idempotency_key
          )
          select
            safety.id,
            ${input.mediaAssetId},
            'provider_scan_reconciliation',
            'queued',
            ${`media-safety:asset:${input.mediaAssetId}:provider-scan-v1`}
          from media_safety_cases safety
          where safety.content_item_id = ${input.contentId}
            and safety.state <> 'superseded'
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

        await transaction`
          update idempotency_keys
          set response_status = 202,
              response_body = ${transaction.json({
                mediaAssetId: input.mediaAssetId,
                providerAssetId: input.providerAssetId
              })}::jsonb
          where key = ${receiptKey}
        `;

        return {
          mediaAssetId: input.mediaAssetId,
          providerAssetId: input.providerAssetId,
          completed: false
        };
      });
    },
    async completeImageAssetUpload(input) {
      const rows = await sql<{ id: string }[]>`
        update media_assets
        set
          provider_state = 'stored_private',
          provider_playable = false,
          provider_checked_at = now()
        where id = ${input.mediaAssetId}
          and provider = 'bunny'
          and provider_asset_id = ${input.providerAssetId}
          and asset_kind = 'image'
          and provider_state in ('uploading_private', 'stored_private')
        returning id
      `;
      if (!rows[0]) throw new ContentImageUploadConflictError("receipt_invalid");
    },
    async updateOwnedMediaAsset(input) {
      return withPostgresTransaction(sql, async (transaction) => {
        const actorRows = await transaction<{ id: string }[]>`
          select id from users where supabase_user_id = ${input.supabaseUserId} limit 1
        `;
        const actor = actorRows[0];
        if (!actor) return null;

        const receiptKey = `content:asset-update:${actor.id}:${input.idempotencyKey}`;
        await transaction`
          insert into idempotency_keys (key, actor_user_id, scope, request_hash, expires_at)
          values (${receiptKey}, ${actor.id}, 'content.asset-update', ${input.requestHash}, 'infinity'::timestamptz)
          on conflict (key) do nothing
        `;
        const receipts = await transaction<{
          request_hash: string;
          response_body: MediaAssetMutationResult | null;
        }[]>`
          select request_hash, response_body
          from idempotency_keys
          where key = ${receiptKey}
          for update
        `;
        const receipt = receipts[0];
        if (!receipt || receipt.request_hash !== input.requestHash) {
          throw new ContentImageUploadConflictError("idempotency_conflict");
        }
        if (receipt.response_body?.asset?.id) return receipt.response_body;

        const draftRows = await transaction<{
          content_item_id: string;
          asset_revision: number;
        }[]>`
          select content.id as content_item_id, content.asset_revision
          from media_assets asset
          join content_items content on content.id = asset.content_item_id
          where asset.id = ${input.mediaAssetId}
            and content.creator_user_id = ${actor.id}
            and content.state <> 'deleted'
            and content.publish_state in ('draft', 'unpublished')
          for update of content, asset
        `;
        const draft = draftRows[0];
        if (!draft) return null;
        if (Number(draft.asset_revision) !== input.expectedCompositionRevision) {
          throw new ContentImageUploadConflictError("draft_locked");
        }

        const assets = await transaction<{
          id: string;
          asset_kind: "image" | "video";
          position: number;
          provider: "bunny" | "livepeer";
          provider_state: string;
          poster_url: string | null;
          mime_type: NonNullable<MediaAssetMutationResult["asset"]["mimeType"]> | null;
          width_pixels: number | null;
          height_pixels: number | null;
          duration_ms: number | null;
          alt_text: string | null;
          required_for_release: boolean;
          is_cover: boolean;
          focal_point_x: number | null;
          focal_point_y: number | null;
          origin_classification: NonNullable<MediaAssetMutationResult["asset"]["originClassification"]>;
          visible_label_state: NonNullable<MediaAssetMutationResult["asset"]["visibleLabelState"]>;
        }[]>`
          update media_assets
          set
            alt_text = case when ${input.altTextProvided} then ${input.altText ?? null} else alt_text end,
            origin_classification = coalesce(
              ${input.originClassification ?? null},
              origin_classification
            )
          where id = ${input.mediaAssetId}
            and content_item_id = ${draft.content_item_id}
          returning id, asset_kind, position, provider, provider_state, poster_url, mime_type,
            width_pixels, height_pixels, duration_ms, alt_text, required_for_release, is_cover,
            focal_point_x::float8 as focal_point_x, focal_point_y::float8 as focal_point_y,
            origin_classification, visible_label_state
        `;
        const asset = assets[0];
        if (!asset) return null;
        const revisions = await transaction<{ asset_revision: number }[]>`
          select asset_revision from content_items where id = ${draft.content_item_id}
        `;
        const result: MediaAssetMutationResult = {
          compositionRevision: Number(revisions[0]?.asset_revision ?? draft.asset_revision + 1),
          asset: {
            id: asset.id,
            kind: asset.asset_kind,
            position: Number(asset.position),
            provider: asset.provider,
            providerState: asset.provider_state,
            posterUrl: asset.poster_url,
            mimeType: asset.mime_type,
            widthPixels: asset.width_pixels,
            heightPixels: asset.height_pixels,
            durationMs: asset.duration_ms,
            altText: asset.alt_text,
            requiredForRelease: asset.required_for_release,
            isCover: asset.is_cover,
            focalPointX: asset.focal_point_x,
            focalPointY: asset.focal_point_y,
            originClassification: asset.origin_classification,
            visibleLabelState: asset.visible_label_state
          }
        };
        await transaction`
          update idempotency_keys
          set response_status = 200,
              response_body = ${transaction.json(JSON.parse(JSON.stringify(result)) as JsonObject)}::jsonb
          where key = ${receiptKey}
        `;
        return result;
      });
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
      const observationEventId = `bunny-observation:${input.mediaAssetId}:${input.providerObservationCutoff.toISOString()}`;
      const observationHash = normalizedMediaEvidenceHash({
        mediaAssetId: input.mediaAssetId,
        providerPlayable: input.providerPlayable,
        providerState: input.providerState,
        observedAt: input.providerObservationCutoff.toISOString()
      });
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
            provider_checked_at = ${input.providerObservationCutoff}
          where id = ${input.mediaAssetId}
            and (provider_checked_at is null or provider_checked_at <= ${input.providerObservationCutoff})
            and not exists (
              select 1
              from provider_events newer
              where newer.provider = 'bunny'
                and newer.received_at > ${input.providerObservationCutoff}
                and newer.normalized_state is distinct from 'ignored_stale'
                and newer.replay_payload ->> 'kind' = 'media_asset'
                and newer.replay_payload ->> 'providerAssetId' = media_assets.provider_asset_id
            )
          returning id
        `;

        if (updatedAssets.length === 0) return;

        if (input.providerPlayable) {
          await transaction`
            insert into provider_media_scan_events (
              media_safety_case_id,
              media_asset_id,
              provider,
              provider_event_id,
              scan_type,
              normalized_signal,
              payload_hash,
              model_or_ruleset_version,
              observed_at
            )
            select
              safety.id,
              asset.id,
              'bunny_stream',
              ${observationEventId},
              'container_integrity',
              'clear',
              ${observationHash},
              'bunny-stream-playability-v1',
              ${input.providerObservationCutoff}
            from media_assets asset
            join media_safety_cases safety
              on safety.content_item_id = asset.content_item_id
              and safety.state <> 'superseded'
            where asset.id = ${input.mediaAssetId}
            on conflict (provider, provider_event_id) do nothing
          `;
        }

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

        if (input.providerPlayable) {
          await transaction`
            insert into provider_media_scan_events (
              media_safety_case_id,
              media_asset_id,
              provider,
              provider_event_id,
              scan_type,
              normalized_signal,
              payload_hash,
              model_or_ruleset_version,
              observed_at
            )
            select
              safety.id,
              asset.id,
              'bunny_stream',
              ${input.providerEventId},
              'container_integrity',
              'clear',
              ${normalizedMediaEvidenceHash({
                provider: input.provider,
                providerAssetId: input.providerAssetId,
                providerEventId: input.providerEventId,
                providerPlayable: input.providerPlayable,
                providerState: input.providerState
              })},
              'bunny-stream-playability-v1',
              now()
            from media_assets asset
            join media_safety_cases safety
              on safety.content_item_id = asset.content_item_id
              and safety.state <> 'superseded'
            where asset.id = ${current.id}
            on conflict (provider, provider_event_id) do nothing
          `;
        }

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

function normalizedMediaEvidenceHash(value: Record<string, unknown>): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
