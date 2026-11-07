import type postgres from "postgres";
import { cursorTimestamp } from "../../shared/database-timestamp.js";
import { bindCursorScope } from "../../shared/keyset-pagination.js";
import { accessStateForRule, toContentItem } from "./content-repository-mappers.js";
import type { FeedRow } from "./content-repository-rows.js";
import type { ContentRepository } from "./types.js";
import {
  decodeFeedCursor,
  encodeFeedCursor
} from "./content-feed-cursor.js";

interface FeedPageRow extends FeedRow {
  published_at: Date;
}

interface FeedCandidateRow {
  id: string;
  published_at: Date;
}

const MIN_FEED_CANDIDATE_BATCH = 128;
const MAX_FEED_CANDIDATE_BATCH = 512;

export function createContentFeedRepositoryMethods(
  sql: postgres.Sql
): Pick<ContentRepository, "listHomeFeed"> {
  return {
    async listHomeFeed(input) {
      const cursorScope = bindCursorScope("content:feed", {
        actor: input.supabaseUserId,
        mode: input.mode,
        order: "published_at:desc,id:desc",
        surface: input.surface
      });
      const cursor = input.cursor ? decodeFeedCursor(input.cursor, cursorScope) : null;

      const candidateBatchSize = Math.max(
        MIN_FEED_CANDIDATE_BATCH,
        Math.min(MAX_FEED_CANDIDATE_BATCH, input.limit * 4)
      );
      const transactionResult = await sql.begin(
        "isolation level repeatable read read only",
        async (transaction) => {
          // Keep the lifecycle/surface predicates literal in the final SQL so PostgreSQL can prove
          // the matching partial chronological index even after a prepared statement adopts a
          // generic plan. Eligibility remains canonical and is applied to only this bounded batch.
          const surfaceFilter = input.surface === "moments"
            ? transaction`
                content.distribution_mode = 'moment'
                and content.media_type not in ('text', 'poll')
                and content.expires_at > now()
              `
            : input.surface === "bits"
              ? transaction`
                  content.distribution_mode = 'post'
                  and content.media_type in ('bit', 'clip')
                `
              : transaction`
                  content.distribution_mode = 'post'
                  and content.media_type not in ('text', 'poll')
                `;
          const followingFilter = input.mode === "following"
            ? transaction`
                exists (
                  select 1
                  from user_follows current_follow
                  where current_follow.follower_user_id = viewer.id
                    and current_follow.followed_user_id = content.creator_user_id
                    and current_follow.state = 'active'
                )
              `
            : transaction`true`;
          const candidateBounds = cursor === null
            ? transaction``
            : transaction`
                and (content.published_at, content.id) <= (
                  ${cursor.upper.publishedAt}::timestamptz,
                  ${cursor.upper.id}::uuid
                )
                and (content.published_at, content.id) < (
                  ${cursor.after.publishedAt}::timestamptz,
                  ${cursor.after.id}::uuid
                )
              `;

          const candidates = await transaction<FeedCandidateRow[]>`
            with viewer as materialized (
              select id
              from users
              where supabase_user_id = ${input.supabaseUserId}
                and state = 'active'
              limit 1
            )
            select content.id, content.published_at
            from content_items content
            join viewer on true
            where content.creator_user_id <> viewer.id
              and content.state = 'ready'
              and content.publish_state = 'published'
              and content.moderation_state = 'approved'
              and content.published_at is not null
              and content.published_at <= now()
              and (${surfaceFilter})
              and (${followingFilter})
              ${candidateBounds}
            order by content.published_at desc, content.id desc
            limit ${candidateBatchSize}
          `;

          if (candidates.length === 0) {
            return { candidates, rows: [] as FeedPageRow[] };
          }

          const candidateIds = candidates.map((candidate) => candidate.id);
          const rows = await transaction<FeedPageRow[]>`
            with viewer as materialized (
              select id
              from users
              where supabase_user_id = ${input.supabaseUserId}
                and state = 'active'
              limit 1
            ),
            candidate_ids as materialized (
              select array_agg(candidate.id order by candidate.ordinality) as ids
              from unnest(${candidateIds}::uuid[]) with ordinality as candidate(id, ordinality)
            ),
            page_ids as materialized (
              select
                content.id,
                content.published_at,
                viewer.id as viewer_id
              from candidate_ids
              cross join lateral unnest(candidate_ids.ids) as candidate(content_item_id)
              join content_items content on content.id = candidate.content_item_id
              join viewer on true
              join lateral private.eligible_content(
                viewer.id,
                null,
                candidate_ids.ids
              ) authorized on authorized.content_item_id = content.id
              order by content.published_at desc, content.id desc
              limit ${input.limit + 1}
            )
            select
              ci.id,
              ci.media_type,
              ci.distribution_mode,
              ci.expires_at,
              ci.scheduled_for,
              ci.caption,
              ci.asset_revision,
              ci.nsfw_label,
              ci.created_at,
              page_ids.published_at,
              creator.id as creator_id,
              profile.handle,
              profile.display_name,
              profile.avatar_url,
              media.poster_url,
              media.playback_url,
              media.provider,
              media.provider_state,
              media.provider_playable,
              universal_assets.media_assets,
              access_rule.access_type,
              access_rule.product_type,
              entitlement.id as entitlement_id,
              entitlement.state as entitlement_state,
              entitlement.granted_at as entitlement_granted_at,
              entitlement.ends_at as entitlement_ends_at,
              (reaction.user_id is not null) as liked,
              (save.user_id is not null) as saved,
              coalesce(counter.like_count, 0) as like_count,
              coalesce(counter.comment_count, 0) as comment_count,
              coalesce(counter.share_count, 0) as share_count,
              coalesce(current_follow.state = 'active', false) as viewer_following_creator
            from page_ids
            join content_items ci on ci.id = page_ids.id
            join users creator on creator.id = ci.creator_user_id
            join profiles profile on profile.user_id = creator.id
            join users viewer on viewer.id = page_ids.viewer_id
            left join content_reactions reaction
              on reaction.content_item_id = ci.id
              and reaction.user_id = viewer.id
              and reaction.reaction_key = 'like'
              and reaction.state = 'active'
            left join content_saves save
              on save.content_item_id = ci.id
              and save.user_id = viewer.id
              and save.state = 'active'
            left join content_engagement_counters counter
              on counter.content_item_id = ci.id
            left join user_follows current_follow
              on current_follow.follower_user_id = viewer.id
              and current_follow.followed_user_id = ci.creator_user_id
            left join lateral (
              select poster_url, playback_url, provider, provider_state, provider_playable
              from media_assets
              where id = ci.release_media_asset_id
                and content_item_id = ci.id
                and retired_at is null
              order by created_at asc
              limit 1
            ) media on true
            left join lateral (
              select access_type, product_type
              from content_access_rules
              where content_item_id = ci.id
                and state = 'active'
                and (starts_at is null or starts_at <= now())
                and (ends_at is null or ends_at > now())
              order by created_at desc
              limit 1
            ) access_rule on true
            left join lateral (
              select id, state, granted_at, ends_at
              from entitlements
              where user_id = viewer.id
                and target_type = 'content'
                and target_id = ci.id
                and product_type = 'content_unlock'
                and state = 'active'
                and starts_at <= now()
                and (ends_at is null or ends_at > now())
              order by granted_at desc
              limit 1
            ) entitlement on true
            left join lateral (
              select coalesce(jsonb_agg(
                jsonb_build_object(
                  'id', asset.id,
                  'kind', asset.asset_kind,
                  'position', asset.position,
                  'provider', asset.provider,
                  'providerState', asset.provider_state,
                  'playbackUrl', asset.playback_url,
                  'providerPlayable', asset.provider_playable,
                  'providerAssetId', asset.provider_asset_id,
                  'posterUrl', asset.poster_url,
                  'mimeType', asset.mime_type,
                  'widthPixels', asset.width_pixels,
                  'heightPixels', asset.height_pixels,
                  'durationMs', asset.duration_ms,
                  'altText', asset.alt_text,
                  'requiredForRelease', asset.required_for_release,
                  'isCover', asset.is_cover,
                  'focalPointX', asset.focal_point_x,
                  'focalPointY', asset.focal_point_y,
                  'originClassification', asset.origin_classification,
                  'visibleLabelState', asset.visible_label_state,
                  'provenanceReviewState', asset.provenance_human_review_state,
                  'machineReadableMarkingState', asset.machine_readable_marking_state
                )
                order by asset.position
              ), '[]'::jsonb) as media_assets
              from media_assets asset
              where asset.content_item_id = ci.id
                and asset.retired_at is null
            ) universal_assets on true
            order by page_ids.published_at desc, page_ids.id desc
          `;

          return { candidates, rows };
        }
      ) as { candidates: FeedCandidateRow[]; rows: FeedPageRow[] };

      const { candidates, rows } = transactionResult;
      const pageRows = rows.slice(0, input.limit);
      const firstCandidate = candidates[0];
      const lastCandidate = candidates.at(-1);
      const lastRow = pageRows.at(-1);
      const upper = cursor?.upper ?? (firstCandidate
        ? { publishedAt: firstCandidate.published_at, id: firstCandidate.id }
        : null);
      const hasMoreEligibleRows = rows.length > input.limit;
      const scannedFullBatch = candidates.length === candidateBatchSize;
      const nextAfter = hasMoreEligibleRows
        ? lastRow
        : scannedFullBatch
          ? lastCandidate
          : null;

      return {
        items: pageRows.map((row) => toContentItem(row, row.poster_url, accessStateForRule(row))),
        nextCursor: upper && nextAfter
          ? encodeFeedCursor({
              scope: cursorScope,
              upper,
              after: { publishedAt: nextAfter.published_at, id: nextAfter.id }
            })
          : null,
        mode: input.mode,
        surface: input.surface,
        rankingVersion: "chronological_v1",
        generatedAt: upper ? cursorTimestamp(upper.publishedAt) : new Date().toISOString()
      };
    }
  };
}
