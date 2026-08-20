import { randomUUID } from "node:crypto";
import { hashIdempotencyPayload } from "../../shared/idempotency.js";
import { type PostgresSql, withPostgresTransaction } from "../../shared/postgres.js";
import { ContentModerationAppealConflictError } from "./content-errors.js";
import type { ContentRepository, CreatorMediaPage } from "./types.js";

type OwnerMediaRow = {
  id: string;
  media_type: CreatorMediaPage["items"][number]["mediaType"];
  caption: string | null;
  poster_url: string | null;
  visibility: CreatorMediaPage["items"][number]["visibility"];
  content_state: string;
  publish_state: string;
  review_state: string;
  review_message: string | null;
  has_media: boolean;
  provider_ready: boolean;
  created_at: Date;
  updated_at: Date;
};

export function createContentWorkflowRepositoryMethods(
  sql: PostgresSql
): Pick<ContentRepository, "listOwnedContent" | "createModerationAppeal"> {
  return {
    async listOwnedContent(input) {
      const rows = await sql<OwnerMediaRow[]>`
        select
          ci.id,
          ci.media_type,
          ci.caption,
          media.poster_url,
          ci.visibility,
          ci.state as content_state,
          ci.publish_state,
          coalesce(msc.state, 'quarantined') as review_state,
          msc.decision_message as review_message,
          media.has_media,
          media.provider_ready,
          ci.created_at,
          ci.updated_at
        from content_items ci
        join users u on u.id = ci.creator_user_id
        left join media_safety_cases msc
          on msc.content_item_id = ci.id
          and msc.state <> 'superseded'
        left join lateral (
          select
            bool_or(true) as has_media,
            bool_or(provider_playable is true and ready_at is not null) as provider_ready,
            (array_agg(poster_url order by created_at asc))[1] as poster_url
          from media_assets
          where content_item_id = ci.id
        ) media on true
        where u.supabase_user_id = ${input.supabaseUserId}
          and ci.state <> 'deleted'
          and (${input.cursor ?? null}::timestamptz is null or ci.updated_at < ${input.cursor ?? null}::timestamptz)
        order by ci.updated_at desc, ci.id desc
        limit ${input.limit + 1}
      `;

      const pageRows = rows.slice(0, input.limit);
      return {
        items: pageRows.map((row) => ({
          id: row.id,
          mediaType: row.media_type,
          caption: row.caption,
          posterUrl: row.poster_url,
          visibility: row.visibility,
          publicationState: publicationState(row),
          reviewState: row.review_state,
          reviewMessage: row.review_message,
          createdAt: row.created_at.toISOString(),
          updatedAt: row.updated_at.toISOString()
        })),
        nextCursor:
          rows.length > input.limit && pageRows.length > 0
            ? pageRows[pageRows.length - 1]!.updated_at.toISOString()
            : null
      };
    },

    async createModerationAppeal(input) {
      return withPostgresTransaction(sql, async (transaction) => {
        const rows = await transaction<{
          case_id: string;
          creator_user_id: string;
          case_state: string;
        }[]>`
          select
            msc.id as case_id,
            ci.creator_user_id,
            msc.state as case_state
          from media_safety_cases msc
          join content_items ci on ci.id = msc.content_item_id
          join users u on u.id = ci.creator_user_id
          where ci.id = ${input.contentId}
            and u.supabase_user_id = ${input.supabaseUserId}
            and u.state = 'active'
            and msc.state <> 'superseded'
          for update of msc
        `;
        const current = rows[0];
        if (!current) return null;
        const storedIdempotencyKey = `content-appeal:${current.creator_user_id}:${input.contentId}:${input.idempotencyKey}`;
        const requestHash = hashIdempotencyPayload({
          contentId: input.contentId,
          reason: input.reason.trim()
        });

        const replay = await transaction<{
          id: string;
          state: "submitted" | "reviewing" | "upheld" | "overturned" | "withdrawn";
          reason: string;
          request_hash: string | null;
          created_at: Date;
        }[]>`
          select id, state, reason, request_hash, created_at
          from media_moderation_appeals
          where idempotency_key = ${storedIdempotencyKey}
          limit 1
        `;
        if (replay[0]) {
          const sameRequest = replay[0].request_hash
            ? replay[0].request_hash === requestHash
            : replay[0].reason.trim() === input.reason.trim();
          if (!sameRequest) {
            throw new ContentModerationAppealConflictError("idempotency_conflict");
          }
          return toAppeal(input.contentId, replay[0]);
        }

        if (!['rejected', 'changes_requested'].includes(current.case_state)) {
          throw new ContentModerationAppealConflictError("not_appealable");
        }

        const open = await transaction<{ id: string }[]>`
          select id
          from media_moderation_appeals
          where media_safety_case_id = ${current.case_id}
            and appellant_user_id = ${current.creator_user_id}
            and state in ('submitted', 'reviewing')
          limit 1
        `;
        if (open[0]) {
          throw new ContentModerationAppealConflictError("appeal_already_open");
        }

        const appealId = randomUUID();
        const inserted = await transaction<{
          id: string;
          state: "submitted";
          reason: string;
          created_at: Date;
        }[]>`
          insert into media_moderation_appeals (
            id,
            media_safety_case_id,
            appellant_user_id,
            reason,
            idempotency_key,
            request_hash
          )
          values (
            ${appealId},
            ${current.case_id},
            ${current.creator_user_id},
            ${input.reason},
            ${storedIdempotencyKey},
            ${requestHash}
          )
          returning id, state, reason, created_at
        `;

        await transaction`
          update media_safety_cases
          set
            state = 'appealed',
            reason_code = 'creator_appeal_submitted',
            provider_release_allowed = false,
            updated_at = now()
          where id = ${current.case_id}
        `;

        await transaction`
          insert into audit_events (
            id, actor_user_id, subject_type, subject_id, action, metadata
          )
          values (
            gen_random_uuid(),
            ${current.creator_user_id},
            'content',
            ${input.contentId},
            'content_moderation_appealed',
            ${transaction.json({ appealId, idempotencyKey: input.idempotencyKey })}::jsonb
          )
        `;

        return toAppeal(input.contentId, inserted[0]!);
      });
    }
  };
}

function publicationState(
  row: OwnerMediaRow
): CreatorMediaPage["items"][number]["publicationState"] {
  if (row.publish_state === "published" && row.review_state === "approved") return "published";
  if (row.review_state === "rejected") return "rejected";
  if (row.review_state === "changes_requested") return "changes_requested";
  if (row.review_state === "appealed") return "appeal_pending";
  if (row.publish_state === "blocked" || row.content_state === "blocked") return "blocked";
  if (row.publish_state === "submitted_for_review" || row.review_state === "review_required") {
    return "in_review";
  }
  if (row.has_media && !row.provider_ready) return "processing";
  if (!row.has_media) return "upload_pending";
  return "draft";
}

function toAppeal(
  contentId: string,
  row: { id: string; state: "submitted" | "reviewing" | "upheld" | "overturned" | "withdrawn"; reason: string; created_at: Date }
) {
  return {
    id: row.id,
    contentId,
    state: row.state,
    reason: row.reason,
    createdAt: row.created_at.toISOString()
  };
}
