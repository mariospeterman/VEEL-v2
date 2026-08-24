import { randomUUID } from "node:crypto";
import type { PostgresSql } from "../../shared/postgres.js";
import { withPostgresTransaction } from "../../shared/postgres.js";
import { McpMediaCapabilityConflictError } from "./content-errors.js";
import type {
  ContentRepository,
  McpMediaMimeType,
  MediaAssetMutationResult,
  PrivateMediaReadiness
} from "./types.js";

type CapabilityRow = {
  id: string;
  connection_id: string;
  actor_user_id: string;
  content_item_id: string;
  reserved_media_asset_id: string;
  token_hash: string;
  media_kind: "image" | "video";
  mime_type: McpMediaMimeType;
  origin_classification: "ai_assisted" | "ai_generated" | "materially_ai_manipulated";
  source_kind: "generated" | "edited" | "composited" | "unknown";
  source_lineage_reference: string | null;
  workflow_provider_reference: string | null;
  c2pa_reference: string | null;
  state: "pending" | "provisioning" | "consumed" | "revoked";
  lease_token: string | null;
  leased_until: Date | null;
  expires_at: Date;
  actor_supabase_user_id: string;
  media_type: string;
  visibility: string;
  nsfw_label: string;
  content_state: string;
  publish_state: string;
};

type AssetMutationRow = {
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
  provenance_human_review_state: NonNullable<MediaAssetMutationResult["asset"]["provenanceReviewState"]>;
  machine_readable_marking_state: NonNullable<MediaAssetMutationResult["asset"]["machineReadableMarkingState"]>;
};

type McpMediaRepositoryMethods = Required<Pick<
  ContentRepository,
  | "issueMcpMediaUploadCapability"
  | "claimMcpMediaUploadCapability"
  | "completeMcpMediaUploadCapability"
  | "releaseMcpMediaUploadCapability"
  | "scheduleMcpMediaProviderCleanup"
  | "findOwnedPrivateMediaReadiness"
  | "reviewOwnedMediaAssetProvenance"
>>;

export function createContentMcpMediaRepositoryMethods(sql: PostgresSql): McpMediaRepositoryMethods {
  return {
    async issueMcpMediaUploadCapability(input) {
      return withPostgresTransaction(sql, async (transaction) => {
        const existing = await transaction<{
          id: string;
          content_item_id: string;
          reserved_media_asset_id: string;
          media_kind: "image" | "video";
          mime_type: McpMediaMimeType;
          expires_at: Date;
        }[]>`
          select id, content_item_id, reserved_media_asset_id, media_kind, mime_type, expires_at
          from mcp_media_upload_capabilities
          where connection_id = ${input.connectionId}
            and request_hash = ${input.requestHash}
            and actor_user_id = (
              select id from users where supabase_user_id = ${input.supabaseUserId} limit 1
            )
          limit 1
        `;
        if (existing[0]) {
          return {
            id: existing[0].id,
            contentId: existing[0].content_item_id,
            mediaAssetId: existing[0].reserved_media_asset_id,
            mediaKind: existing[0].media_kind,
            mimeType: existing[0].mime_type,
            expiresAt: existing[0].expires_at.toISOString(),
            issued: false
          };
        }

        const drafts = await transaction<{
          actor_user_id: string;
          media_type: string;
        }[]>`
          select
            content.creator_user_id as actor_user_id,
            content.media_type
          from content_items content
          join users actor on actor.id = content.creator_user_id
          join mcp_connections connection
            on connection.id = ${input.connectionId}
           and connection.actor_user_id = actor.id
          where content.id = ${input.contentId}
            and actor.supabase_user_id = ${input.supabaseUserId}
            and actor.state = 'active'
            and connection.state = 'active'
            and content.state <> 'deleted'
            and content.visibility = 'private'
            and content.nsfw_label = 'none'
            and content.publish_state in ('draft', 'unpublished')
          for update of content
        `;
        const draft = drafts[0];
        if (!draft || !acceptsMediaKind(draft.media_type, input.mediaKind)) {
          return null;
        }

        // The content-row lock above serializes issuers for this draft. Re-read the
        // logical request after acquiring it so concurrent exact retries converge on
        // the first committed capability instead of surfacing the unique constraint.
        const concurrentWinner = await transaction<{
          id: string;
          content_item_id: string;
          reserved_media_asset_id: string;
          media_kind: "image" | "video";
          mime_type: McpMediaMimeType;
          expires_at: Date;
        }[]>`
          select id, content_item_id, reserved_media_asset_id, media_kind, mime_type, expires_at
          from mcp_media_upload_capabilities
          where connection_id = ${input.connectionId}
            and request_hash = ${input.requestHash}
            and actor_user_id = ${draft.actor_user_id}
          limit 1
        `;
        if (concurrentWinner[0]) {
          return {
            id: concurrentWinner[0].id,
            contentId: concurrentWinner[0].content_item_id,
            mediaAssetId: concurrentWinner[0].reserved_media_asset_id,
            mediaKind: concurrentWinner[0].media_kind,
            mimeType: concurrentWinner[0].mime_type,
            expiresAt: concurrentWinner[0].expires_at.toISOString(),
            issued: false
          };
        }

        const assetCounts = await transaction<{ asset_count: number }[]>`
          select count(*)::integer as asset_count
          from media_assets
          where content_item_id = ${input.contentId}
            and retired_at is null
        `;
        if ((assetCounts[0]?.asset_count ?? 10) >= 10) return null;

        const capabilityId = randomUUID();
        const mediaAssetId = randomUUID();
        await transaction`
          insert into mcp_media_upload_capabilities (
            id, connection_id, actor_user_id, content_item_id, reserved_media_asset_id,
            token_hash, request_hash, media_kind, mime_type, origin_classification,
            source_kind, source_lineage_reference, workflow_provider_reference, c2pa_reference,
            expires_at
          ) values (
            ${capabilityId}, ${input.connectionId}, ${draft.actor_user_id}, ${input.contentId},
            ${mediaAssetId}, ${input.tokenHash}, ${input.requestHash}, ${input.mediaKind},
            ${input.mimeType}, ${input.originClassification}, ${input.sourceKind},
            ${input.sourceLineageReference ?? null}, ${input.workflowProviderReference ?? null},
            ${input.c2paReference ?? null}, ${input.expiresAt}
          )
        `;
        await transaction`
          insert into audit_events (
            id, actor_user_id, subject_type, subject_id, action, idempotency_key, metadata
          ) values (
            gen_random_uuid(), ${draft.actor_user_id}, 'content', ${input.contentId},
            'mcp_media_capability_issued', ${capabilityId},
            ${transaction.json({
              capabilityId,
              connectionId: input.connectionId,
              mediaKind: input.mediaKind,
              mimeType: input.mimeType
            })}::jsonb
          )
        `;

        return {
          id: capabilityId,
          contentId: input.contentId,
          mediaAssetId,
          mediaKind: input.mediaKind,
          mimeType: input.mimeType,
          expiresAt: input.expiresAt.toISOString(),
          issued: true
        };
      });
    },

    async claimMcpMediaUploadCapability(input) {
      let capabilityFound = false;
      try {
        return await withPostgresTransaction(sql, async (transaction) => {
        const rows = await transaction<Array<CapabilityRow & {
          expired: boolean;
          lease_active: boolean;
          connection_state: string;
          actor_state: string;
          age_eligible: boolean;
        }>>`
          select
            capability.id, capability.connection_id, capability.actor_user_id,
            capability.content_item_id, capability.reserved_media_asset_id,
            capability.token_hash, capability.media_kind, capability.mime_type,
            capability.origin_classification, capability.source_kind,
            capability.source_lineage_reference, capability.workflow_provider_reference,
            capability.c2pa_reference, capability.state, capability.lease_token,
            capability.leased_until,
            capability.expires_at, capability.expires_at <= now() as expired,
            capability.leased_until > now() as lease_active,
            actor.supabase_user_id as actor_supabase_user_id,
            connection.state as connection_state, actor.state as actor_state,
            coalesce((
              select
                verification.status = 'valid'
                and verification.result_over_threshold is true
                and (verification.expires_at is null or verification.expires_at > now())
              from verification_records verification
              where verification.subject_type = 'user'
                and verification.subject_id = actor.id
                and verification.purpose = 'age_access'
              order by verification.created_at desc, verification.id desc
              limit 1
            ), false) as age_eligible,
            content.media_type, content.visibility, content.nsfw_label,
            content.state as content_state, content.publish_state
          from mcp_media_upload_capabilities capability
          join users actor on actor.id = capability.actor_user_id
          join mcp_connections connection on connection.id = capability.connection_id
          join content_items content on content.id = capability.content_item_id
          where capability.id = ${input.capabilityId}
          for update of capability, content
        `;
        const capability = rows[0];
        capabilityFound = Boolean(capability);
        if (!capability) throw new McpMediaCapabilityConflictError("not_found");
        if (
          capability.connection_id !== input.connectionId ||
          capability.actor_supabase_user_id !== input.supabaseUserId ||
          capability.token_hash !== input.tokenHash
        ) {
          throw new McpMediaCapabilityConflictError("mismatch");
        }
        if (
          capability.connection_state !== "active" ||
          capability.actor_state !== "active" ||
          !capability.age_eligible
        ) {
          throw new McpMediaCapabilityConflictError("access_ineligible");
        }
        if (capability.state === "consumed") {
          throw new McpMediaCapabilityConflictError("consumed");
        }
        if (capability.state === "revoked" || capability.expired) {
          throw new McpMediaCapabilityConflictError("expired");
        }
        if (capability.state === "provisioning" && capability.lease_active) {
          throw new McpMediaCapabilityConflictError("busy");
        }
        if (
          (capability.media_kind === "image" && input.declaredMimeType !== capability.mime_type) ||
          (capability.media_kind === "video" && input.declaredMimeType !== null)
        ) {
          throw new McpMediaCapabilityConflictError("mismatch");
        }
        if (
          capability.content_state === "deleted" ||
          capability.visibility !== "private" ||
          capability.nsfw_label !== "none" ||
          !["draft", "unpublished"].includes(capability.publish_state) ||
          !acceptsMediaKind(capability.media_type, capability.media_kind)
        ) {
          throw new McpMediaCapabilityConflictError("draft_locked");
        }

        // Quota reservation is creator-scoped, not draft-scoped. The actor lock
        // makes the count-plus-provisioning transition atomic across all drafts.
        await transaction`select id from users where id = ${capability.actor_user_id} for update`;

        const counts = await transaction<{ asset_count: number; quota_count: number }[]>`
          select
            (
              select (
                select count(*)::integer from media_assets asset
                where asset.content_item_id = ${capability.content_item_id}
                  and asset.retired_at is null
              ) + (
                select count(*)::integer
                from mcp_media_upload_capabilities reservation
                where reservation.content_item_id = ${capability.content_item_id}
                  and reservation.state = 'provisioning'
                  and reservation.id <> ${capability.id}
                  and reservation.expires_at > now()
                  and reservation.leased_until > now()
                  and not exists (
                    select 1 from media_assets reserved_asset
                    where reserved_asset.id = reservation.reserved_media_asset_id
                  )
              )
            ) as asset_count,
            (
              select (
                select count(*)::integer from media_assets asset
                join content_items owned_content on owned_content.id = asset.content_item_id
                where owned_content.creator_user_id = ${capability.actor_user_id}
                  and asset.created_at >= ${input.quotaWindowStart}
              ) + (
                select count(*)::integer
                from mcp_media_upload_capabilities reservation
                where reservation.actor_user_id = ${capability.actor_user_id}
                  and reservation.state = 'provisioning'
                  and reservation.id <> ${capability.id}
                  and reservation.expires_at > now()
                  and reservation.updated_at >= ${input.quotaWindowStart}
                  and not exists (
                    select 1 from media_assets reserved_asset
                    where reserved_asset.id = reservation.reserved_media_asset_id
                  )
              )
            ) as quota_count
        `;
        if ((counts[0]?.asset_count ?? 10) >= 10) {
          throw new McpMediaCapabilityConflictError("draft_locked");
        }
        if ((counts[0]?.quota_count ?? input.dailyMediaUploadQuota) >= input.dailyMediaUploadQuota) {
          throw new McpMediaCapabilityConflictError("quota_exceeded");
        }

        await transaction`
          update mcp_media_upload_capabilities
          set state = 'provisioning', lease_token = ${input.leaseToken},
              leased_until = ${input.leasedUntil}, attempt_count = attempt_count + 1,
              last_failure_code = null, updated_at = now()
          where id = ${capability.id}
        `;

        return {
          id: capability.id,
          contentId: capability.content_item_id,
          mediaAssetId: capability.reserved_media_asset_id,
          mediaKind: capability.media_kind,
          mimeType: capability.mime_type,
          leaseToken: input.leaseToken,
          originClassification: capability.origin_classification,
          sourceKind: capability.source_kind,
          sourceLineageReference: capability.source_lineage_reference,
          workflowProviderReference: capability.workflow_provider_reference,
          c2paReference: capability.c2pa_reference
        };
        });
      } catch (error) {
        if (error instanceof McpMediaCapabilityConflictError) {
          const auditActors = await sql<{ actor_user_id: string }[]>`
            select actor_user_id from mcp_connections where id = ${input.connectionId} limit 1
          `;
          await sql`
            insert into audit_events (
              id, actor_user_id, subject_type, subject_id, action, idempotency_key, metadata
            ) values (
              gen_random_uuid(), ${auditActors[0]?.actor_user_id ?? null}, 'mcp_media_capability',
              ${input.capabilityId}, 'mcp_media_capability_redemption_denied',
              ${`${input.capabilityId}:${input.leaseToken}:denied`},
              ${sql.json({ reason: error.reason, capabilityFound })}::jsonb
            )
          `;
        }
        throw error;
      }
    },

    async completeMcpMediaUploadCapability(input) {
      let capabilityFound = false;
      return withPostgresTransaction(sql, async (transaction) => {
        const capabilities = await transaction<Array<CapabilityRow & {
          expired: boolean;
        }>>`
          select
            capability.id, capability.connection_id, capability.actor_user_id,
            capability.content_item_id, capability.reserved_media_asset_id,
            capability.token_hash, capability.media_kind, capability.mime_type,
            capability.origin_classification, capability.source_kind,
            capability.source_lineage_reference, capability.workflow_provider_reference,
            capability.c2pa_reference, capability.state, capability.lease_token,
            capability.leased_until,
            capability.expires_at, capability.expires_at <= now() as expired,
            actor.supabase_user_id as actor_supabase_user_id,
            content.media_type, content.visibility, content.nsfw_label,
            content.state as content_state, content.publish_state
          from mcp_media_upload_capabilities capability
          join users actor on actor.id = capability.actor_user_id
          join content_items content on content.id = capability.content_item_id
          where capability.id = ${input.capabilityId}
            and capability.connection_id = ${input.connectionId}
            and capability.state = 'provisioning'
            and capability.lease_token = ${input.leaseToken}
          for update of capability, content
        `;
        const capability = capabilities[0];
        capabilityFound = Boolean(capability);
        if (!capability) throw new McpMediaCapabilityConflictError("lease_lost");
        if (capability.expired) throw new McpMediaCapabilityConflictError("expired");
        const assetCounts = await transaction<{ asset_count: number }[]>`
          select count(*)::integer as asset_count
          from media_assets
          where content_item_id = ${capability.content_item_id}
            and retired_at is null
        `;
        if (
          capability.content_state === "deleted" ||
          capability.visibility !== "private" ||
          capability.nsfw_label !== "none" ||
          !["draft", "unpublished"].includes(capability.publish_state) ||
          !acceptsMediaKind(capability.media_type, capability.media_kind) ||
          (assetCounts[0]?.asset_count ?? 10) >= 10
        ) {
          throw new McpMediaCapabilityConflictError("draft_locked");
        }

        await transaction`
          insert into media_assets (
            id, content_item_id, provider, provider_asset_id, provider_state,
            provider_playable, ready_at, provider_checked_at,
            asset_kind, mime_type, width_pixels, height_pixels,
            checksum_sha256, required_for_release, origin_classification, source_kind,
            source_lineage_reference, workflow_provider_reference,
            provenance_human_review_state, visible_label_state,
            machine_readable_marking_state, c2pa_reference
          ) values (
            ${capability.reserved_media_asset_id}, ${capability.content_item_id}, 'bunny',
            ${input.providerAssetId}, ${input.providerState},
            ${capability.media_kind === "image"},
            case when ${capability.media_kind === "image"} then now() else null end, now(),
            ${capability.media_kind},
            ${capability.mime_type}, ${input.widthPixels ?? null}, ${input.heightPixels ?? null},
            ${input.checksumSha256 ?? null}, true, ${capability.origin_classification},
            ${capability.source_kind}, ${capability.source_lineage_reference},
            ${capability.workflow_provider_reference}, 'pending',
            ${visibleLabelFor(capability.origin_classification)},
            ${capability.c2pa_reference ? "pending" : "unavailable"},
            ${capability.c2pa_reference}
          )
        `;
        await transaction`
          insert into media_moderation_jobs (
            media_safety_case_id, media_asset_id, stage, state, idempotency_key
          )
          select safety.id, ${capability.reserved_media_asset_id},
            'provider_scan_reconciliation', 'queued',
            ${`media-safety:asset:${capability.reserved_media_asset_id}:provider-scan-v1`}
          from media_safety_cases safety
          where safety.content_item_id = ${capability.content_item_id}
            and safety.state <> 'superseded'
          on conflict (idempotency_key) do nothing
        `;
        await transaction`
          update media_safety_cases
          set state = 'preprocessing', reason_code = 'awaiting_provider_scan_reconciliation',
              provider_release_allowed = false, updated_at = now()
          where content_item_id = ${capability.content_item_id}
            and state in ('quarantined', 'preprocessing')
        `;
        await transaction`
          update mcp_media_upload_capabilities
          set state = 'consumed', consumed_at = now(), lease_token = null,
              leased_until = null, last_failure_code = null, updated_at = now()
          where id = ${capability.id}
        `;
        await transaction`
          insert into audit_events (
            id, actor_user_id, subject_type, subject_id, action, idempotency_key, metadata
          ) values (
            gen_random_uuid(), ${capability.actor_user_id}, 'media_asset',
            ${capability.reserved_media_asset_id}, 'mcp_media_capability_consumed',
            ${capability.id}, ${transaction.json({
              capabilityId: capability.id,
              connectionId: capability.connection_id,
              contentId: capability.content_item_id,
              mediaKind: capability.media_kind
            })}::jsonb
          )
        `;
        const revisions = await transaction<{ asset_revision: number }[]>`
          select asset_revision from content_items where id = ${capability.content_item_id}
        `;
        return {
          mediaAssetId: capability.reserved_media_asset_id,
          contentId: capability.content_item_id,
          compositionRevision: Number(revisions[0]?.asset_revision ?? 1)
        };
      }).catch(async (error: unknown) => {
        if (error instanceof McpMediaCapabilityConflictError) {
          const auditActors = await sql<{ actor_user_id: string }[]>`
            select actor_user_id from mcp_media_upload_capabilities
            where id = ${input.capabilityId} and connection_id = ${input.connectionId}
            limit 1
          `;
          await sql`
            insert into audit_events (
              id, actor_user_id, subject_type, subject_id, action, idempotency_key, metadata
            ) values (
              gen_random_uuid(), ${auditActors[0]?.actor_user_id ?? null}, 'mcp_media_capability',
              ${input.capabilityId}, 'mcp_media_capability_redemption_denied',
              ${`${input.capabilityId}:${input.leaseToken}:completion-denied`},
              ${sql.json({ reason: error.reason, capabilityFound, stage: "completion" })}::jsonb
            )
            on conflict (actor_user_id, action, idempotency_key)
              where actor_user_id is not null and idempotency_key is not null
            do nothing
          `;
        }
        throw error;
      });
    },

    async releaseMcpMediaUploadCapability(input) {
      await sql`
        update mcp_media_upload_capabilities
        set state = 'pending', lease_token = null, leased_until = null,
            last_failure_code = ${input.failureCode}, updated_at = now()
        where id = ${input.capabilityId}
          and connection_id = ${input.connectionId}
          and state = 'provisioning'
          and lease_token = ${input.leaseToken}
      `;
    },

    async scheduleMcpMediaProviderCleanup(input) {
      await withPostgresTransaction(sql, async (transaction) => {
        const rows = await transaction<CapabilityRow[]>`
          select
            capability.id, capability.connection_id, capability.actor_user_id,
            capability.content_item_id, capability.reserved_media_asset_id,
            capability.token_hash, capability.media_kind, capability.mime_type,
            capability.origin_classification, capability.source_kind,
            capability.source_lineage_reference, capability.workflow_provider_reference,
            capability.c2pa_reference, capability.state, capability.lease_token,
            capability.leased_until,
            capability.expires_at, actor.supabase_user_id as actor_supabase_user_id,
            content.media_type, content.visibility, content.nsfw_label,
            content.state as content_state, content.publish_state
          from mcp_media_upload_capabilities capability
          join users actor on actor.id = capability.actor_user_id
          join content_items content on content.id = capability.content_item_id
          where capability.id = ${input.capabilityId}
            and capability.connection_id = ${input.connectionId}
          for update of capability, content
        `;
        const capability = rows[0];
        if (!capability) throw new McpMediaCapabilityConflictError("not_found");
        const ownsLease = capability.state === "provisioning" && capability.lease_token === input.leaseToken;
        const cleanupAssetId = ownsLease ? capability.reserved_media_asset_id : randomUUID();

        await transaction`
          insert into media_assets (
            id, content_item_id, provider, provider_asset_id, provider_state,
            provider_playable, asset_kind, position, mime_type, required_for_release,
            retired_at, retired_by_user_id, retirement_reason,
            provider_cleanup_state, provider_cleanup_error_code,
            provider_cleanup_attempt_count, provider_cleanup_next_attempt_at,
            origin_classification, source_kind, source_lineage_reference,
            workflow_provider_reference, provenance_human_review_state,
            visible_label_state, machine_readable_marking_state, c2pa_reference
          ) values (
            ${cleanupAssetId}, ${capability.content_item_id}, 'bunny',
            ${input.providerAssetId}, 'compensation_pending', false,
            ${capability.media_kind}, null, ${capability.mime_type}, false,
            now(), ${capability.actor_user_id}, 'mcp_provider_attach_failed',
            'retry', ${input.failureCode}, 1, now(),
            ${capability.origin_classification}, ${capability.source_kind},
            ${capability.source_lineage_reference}, ${capability.workflow_provider_reference},
            'rejected', ${visibleLabelFor(capability.origin_classification)},
            ${capability.c2pa_reference ? "invalid" : "unavailable"}, ${capability.c2pa_reference}
          )
        `;
        await transaction`
          update mcp_media_upload_capabilities
          set state = 'revoked', lease_token = null, leased_until = null,
              last_failure_code = ${input.failureCode}, updated_at = now()
          where id = ${capability.id}
            and state = 'provisioning'
            and lease_token = ${input.leaseToken}
        `;
        await transaction`
          insert into audit_events (
            id, actor_user_id, subject_type, subject_id, action, idempotency_key, metadata
          ) values (
            gen_random_uuid(), ${capability.actor_user_id}, 'media_asset',
            ${cleanupAssetId}, 'mcp_media_provider_cleanup_scheduled',
            ${`${capability.id}:${input.leaseToken}`}, ${transaction.json({
              capabilityId: capability.id,
              connectionId: capability.connection_id,
              contentId: capability.content_item_id,
              failureCode: input.failureCode,
              leaseOwned: ownsLease
            })}::jsonb
          )
        `;
      });
    },

    async findOwnedPrivateMediaReadiness(input) {
      const rows = await sql<{
        content_id: string;
        asset_revision: number;
        media_asset_id: string | null;
        asset_kind: "image" | "video" | null;
        mime_type: McpMediaMimeType | null;
        provider_state: string | null;
        provider_playable: boolean | null;
        ready_at: Date | null;
        safety_state: string;
        provenance_human_review_state: PrivateMediaReadiness["assets"][number]["provenanceReviewState"] | null;
        visible_label_state: PrivateMediaReadiness["assets"][number]["visibleLabelState"] | null;
        machine_readable_marking_state: PrivateMediaReadiness["assets"][number]["machineReadableMarkingState"] | null;
      }[]>`
        select
          content.id as content_id,
          content.asset_revision,
          asset.id as media_asset_id,
          asset.asset_kind,
          asset.mime_type,
          asset.provider_state,
          asset.provider_playable,
          asset.ready_at,
          case
            when coalesce(safety.state, 'quarantined') in (
              'rejected', 'changes_requested', 'held_for_reporting'
            ) then safety.state
            when asset.id is not null
              and safety.state = 'approved'
              and safety.provider_release_allowed is true
              and private.content_safety_automated_asset_evidence_ready(content.id, asset.id)
              and coalesce((
                select
                  scan.provider = 'internal'
                  and scan.normalized_signal = 'clear'
                  and scan.provider_event_id is not null
                  and scan.payload_hash ~ '^[0-9a-f]{64}$'
                  and scan.model_or_ruleset_version is not null
                from provider_media_scan_events scan
                where scan.media_safety_case_id = safety.id
                  and scan.media_asset_id = asset.id
                  and scan.scan_type = 'manual_review'
                  and scan.release_eligible is true
                order by scan.observed_at desc, scan.created_at desc, scan.id desc
                limit 1
              ), false) then 'approved'
            else 'quarantined'
          end as safety_state,
          asset.provenance_human_review_state,
          asset.visible_label_state,
          asset.machine_readable_marking_state
        from content_items content
        join users actor on actor.id = content.creator_user_id
        left join media_safety_cases safety
          on safety.content_item_id = content.id and safety.state <> 'superseded'
        left join media_assets asset
          on asset.content_item_id = content.id and asset.retired_at is null
        where content.id = ${input.contentId}
          and actor.supabase_user_id = ${input.supabaseUserId}
          and actor.state = 'active'
          and content.state <> 'deleted'
          and content.visibility = 'private'
        order by asset.position asc nulls last
      `;
      if (!rows[0]) return null;
      const assets = rows.flatMap((row) => row.media_asset_id && row.asset_kind && row.provenance_human_review_state && row.visible_label_state && row.machine_readable_marking_state
        ? [{
            mediaAssetId: row.media_asset_id,
            kind: row.asset_kind,
            mimeType: row.mime_type,
            providerState: normalizedProviderState(row),
            quarantineState: normalizedQuarantineState(row.safety_state),
            provenanceReviewState: row.provenance_human_review_state,
            visibleLabelState: row.visible_label_state,
            machineReadableMarkingState: row.machine_readable_marking_state
          }]
        : []);
      const blockers = new Set<string>();
      for (const asset of assets) {
        if (asset.providerState !== "ready") blockers.add("media_processing_incomplete");
        if (asset.quarantineState !== "approved") blockers.add("safety_review_incomplete");
        if (asset.provenanceReviewState === "pending") blockers.add("provenance_review_pending");
        if (asset.provenanceReviewState === "rejected") blockers.add("provenance_review_rejected");
      }
      return {
        contentId: rows[0].content_id,
        compositionRevision: Number(rows[0].asset_revision),
        assets,
        blockers: [...blockers]
      };
    },

    async reviewOwnedMediaAssetProvenance(input) {
      return withPostgresTransaction(sql, async (transaction) => {
        const actors = await transaction<{ id: string }[]>`
          select id from users where supabase_user_id = ${input.supabaseUserId} and state = 'active' limit 1
        `;
        const actor = actors[0];
        if (!actor) return null;
        const receiptKey = `content:asset-provenance-review:${actor.id}:${input.idempotencyKey}`;
        await transaction`
          insert into idempotency_keys (key, actor_user_id, scope, request_hash, expires_at)
          values (${receiptKey}, ${actor.id}, 'content.asset-provenance-review', ${input.requestHash}, 'infinity'::timestamptz)
          on conflict (key) do nothing
        `;
        const receipts = await transaction<{
          request_hash: string;
          response_body: MediaAssetMutationResult | null;
        }[]>`
          select request_hash, response_body from idempotency_keys where key = ${receiptKey} for update
        `;
        const receipt = receipts[0];
        if (!receipt || receipt.request_hash !== input.requestHash) {
          throw new McpMediaCapabilityConflictError("idempotency_conflict");
        }
        if (receipt.response_body?.asset?.id) return receipt.response_body;

        const rows = await transaction<(AssetMutationRow & {
          content_item_id: string;
          asset_revision: number;
          provenance_human_review_state: "not_required" | "pending" | "confirmed" | "rejected";
        })[]>`
          select
            asset.id, asset.content_item_id, content.asset_revision,
            asset.asset_kind, asset.position, asset.provider, asset.provider_state,
            asset.poster_url, asset.mime_type, asset.width_pixels, asset.height_pixels,
            asset.duration_ms, asset.alt_text, asset.required_for_release, asset.is_cover,
            asset.focal_point_x::float8 as focal_point_x,
            asset.focal_point_y::float8 as focal_point_y,
            asset.origin_classification, asset.visible_label_state,
            asset.provenance_human_review_state, asset.machine_readable_marking_state
          from media_assets asset
          join content_items content on content.id = asset.content_item_id
          where asset.id = ${input.mediaAssetId}
            and content.creator_user_id = ${actor.id}
            and content.visibility = 'private'
            and content.state <> 'deleted'
            and content.publish_state in ('draft', 'unpublished', 'submitted_for_review')
            and asset.retired_at is null
          for update of content, asset
        `;
        const current = rows[0];
        if (!current) return null;
        if (Number(current.asset_revision) !== input.expectedCompositionRevision) {
          throw new McpMediaCapabilityConflictError("draft_locked");
        }
        if (current.provenance_human_review_state === "not_required") return null;

        let asset = current;
        if (current.provenance_human_review_state !== input.decision) {
          if (current.provenance_human_review_state !== "pending") {
            throw new McpMediaCapabilityConflictError("draft_locked");
          }
          const updated = await transaction<AssetMutationRow[]>`
            update media_assets
            set provenance_human_review_state = ${input.decision}
            where id = ${input.mediaAssetId}
            returning id, asset_kind, position, provider, provider_state, poster_url, mime_type,
              width_pixels, height_pixels, duration_ms, alt_text, required_for_release, is_cover,
              focal_point_x::float8 as focal_point_x, focal_point_y::float8 as focal_point_y,
              origin_classification, visible_label_state, provenance_human_review_state,
              machine_readable_marking_state
          `;
          asset = { ...current, ...updated[0]! };
          await transaction`
            insert into audit_events (
              id, actor_user_id, subject_type, subject_id, action, idempotency_key, metadata
            ) values (
              gen_random_uuid(), ${actor.id}, 'media_asset', ${input.mediaAssetId},
              'media_provenance_reviewed', ${input.idempotencyKey},
              ${transaction.json({
                contentId: current.content_item_id,
                decision: input.decision,
                expectedCompositionRevision: input.expectedCompositionRevision
              })}::jsonb
            )
          `;
        }
        const revisions = await transaction<{ asset_revision: number }[]>`
          select asset_revision from content_items where id = ${current.content_item_id}
        `;
        const result: MediaAssetMutationResult = {
          compositionRevision: Number(revisions[0]?.asset_revision ?? current.asset_revision),
          asset: toAssetMutation(asset)
        };
        await transaction`
          update idempotency_keys
          set response_status = 200,
              response_body = ${transaction.json(JSON.parse(JSON.stringify(result)))}::jsonb
          where key = ${receiptKey}
        `;
        return result;
      });
    }
  };
}

function acceptsMediaKind(mediaType: string, mediaKind: "image" | "video"): boolean {
  if (mediaKind === "image") return mediaType === "image" || mediaType === "carousel";
  return ["bit", "clip", "vod", "live_replay", "carousel"].includes(mediaType);
}

function visibleLabelFor(origin: CapabilityRow["origin_classification"]) {
  if (origin === "ai_assisted") return "ai_assisted" as const;
  if (origin === "ai_generated") return "ai_generated" as const;
  return "manipulated" as const;
}

function normalizedProviderState(row: {
  provider_state: string | null;
  provider_playable: boolean | null;
  ready_at: Date | null;
}): "upload_pending" | "processing" | "ready" | "failed" {
  if (row.provider_playable && row.ready_at) return "ready";
  if (row.provider_state && /(failed|error|rejected|deleted)/i.test(row.provider_state)) return "failed";
  if (row.provider_state === "upload_pending" || row.provider_state === "uploading_private") return "upload_pending";
  return "processing";
}

function normalizedQuarantineState(state: string): "pending" | "approved" | "blocked" {
  if (state === "approved") return "approved";
  if (["rejected", "changes_requested", "held_for_reporting", "blocked"].includes(state)) return "blocked";
  return "pending";
}

function toAssetMutation(asset: AssetMutationRow): MediaAssetMutationResult["asset"] {
  return {
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
    visibleLabelState: asset.visible_label_state,
    provenanceReviewState: asset.provenance_human_review_state,
    machineReadableMarkingState: asset.machine_readable_marking_state
  };
}
