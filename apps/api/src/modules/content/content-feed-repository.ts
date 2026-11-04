import type postgres from "postgres";
import { accessStateForRule, toContentItem } from "./content-repository-mappers.js";
import type { FeedRow } from "./content-repository-rows.js";
import type { ContentRepository } from "./types.js";
import {
  decodeFeedCursor,
  encodeFeedCursor,
  InvalidFeedCursorError,
  StaleFeedCursorError
} from "./content-feed-cursor.js";

export const FEED_RANKING_CANDIDATE_LIMIT = 512;
const FEED_RANKING_SESSION_CLEANUP_LIMIT = 64;

interface FeedRankingSessionRow {
  id: string;
  as_of: Date;
}

interface FeedPageRow extends FeedRow {
  session_position: number;
}

export function createContentFeedRepositoryMethods(
  sql: postgres.Sql
): Pick<ContentRepository, "listHomeFeed"> {
  return {
    async listHomeFeed(input) {
      const decodedCursor = input.cursor ? decodeFeedCursor(input.cursor) : null;
      if (
        decodedCursor &&
        (decodedCursor.mode !== input.mode || decodedCursor.surface !== input.surface)
      ) {
        throw new InvalidFeedCursorError();
      }
      return sql.begin("isolation level repeatable read", async (transaction) => {
        const session = decodedCursor
          ? await findFeedRankingSession(transaction, input, decodedCursor.sessionId)
          : await createFeedRankingSession(transaction, input);

        if (!session) throw new StaleFeedCursorError();

        const rows = await transaction<FeedPageRow[]>`
        with active_session as (
          select
            session.id,
            session.viewer_user_id as viewer_id,
            session.mode,
            session.surface,
            session.as_of,
            session.ranked_content_ids
          from feed_ranking_sessions session
          join users viewer on viewer.id = session.viewer_user_id
          where session.id = ${session.id}
            and viewer.supabase_user_id = ${input.supabaseUserId}
            and session.mode = ${input.mode}
            and session.surface = ${input.surface}
            and session.expires_at > now()
        ),
        session_items as materialized (
          select
            ranked.content_item_id,
            ranked.position::integer as session_position,
            active_session.viewer_id,
            active_session.mode,
            active_session.surface
          from active_session
          cross join lateral unnest(active_session.ranked_content_ids)
            with ordinality as ranked(content_item_id, position)
          where ranked.position > ${decodedCursor?.position ?? 0}
        ),
        current_eligible as materialized (
          select authorized.content_item_id
          from active_session
          cross join lateral private.eligible_content(active_session.viewer_id, null) authorized
        ),
        page_ids as (
          select
            session_items.content_item_id as id,
            session_items.session_position,
            session_items.viewer_id
          from session_items
          join content_items content on content.id = session_items.content_item_id
          join current_eligible eligible on eligible.content_item_id = content.id
          left join user_follows current_follow
            on current_follow.follower_user_id = session_items.viewer_id
            and current_follow.followed_user_id = content.creator_user_id
          where (
            (
              session_items.surface = 'moments'
              and content.distribution_mode = 'moment'
              and content.expires_at > now()
            ) or (
              session_items.surface = 'home'
              and content.distribution_mode = 'post'
            ) or (
              session_items.surface = 'bits'
              and content.distribution_mode = 'post'
              and content.media_type in ('bit', 'clip')
            )
          )
            and (
              session_items.mode <> 'following'
              or current_follow.state = 'active'
            )
          order by session_items.session_position
          limit ${input.limit + 1}
        )
        select
          ci.id,
          ci.media_type,
          ci.distribution_mode,
          ci.expires_at,
          ci.scheduled_for,
          ci.caption,
          ci.body_text,
          ci.asset_revision,
          ci.nsfw_label,
          ci.created_at,
          page_ids.session_position,
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
          poll_projection.poll,
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
          on save.content_item_id = ci.id and save.user_id = viewer.id and save.state = 'active'
        left join content_engagement_counters counter on counter.content_item_id = ci.id
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
        left join lateral (
          select jsonb_build_object(
            'question', poll.question,
            'options', coalesce((
              select jsonb_agg(
                jsonb_build_object(
                  'id', option.id,
                  'position', option.position,
                  'text', option.option_text,
                  'voteCount', option.vote_count
                )
                order by option.position
              )
              from content_poll_options option
              where option.content_item_id = poll.content_item_id
            ), '[]'::jsonb),
            'state', poll.state,
            'totalVoteCount', coalesce((
              select sum(option.vote_count)
              from content_poll_options option
              where option.content_item_id = poll.content_item_id
            ), 0),
            'closesAt', poll.closes_at,
            'viewerOptionId', viewer_vote.option_id
          ) as poll
          from content_polls poll
          left join content_poll_votes viewer_vote
            on viewer_vote.content_item_id = poll.content_item_id
            and viewer_vote.voter_user_id = viewer.id
          where poll.content_item_id = ci.id
        ) poll_projection on true
        order by page_ids.session_position
      `;

      const pageRows = rows.slice(0, input.limit);
      const lastRow = pageRows.at(-1);
      return {
        items: pageRows.map((row) => toContentItem(row, row.poster_url, accessStateForRule(row))),
        nextCursor: rows.length > input.limit && lastRow
          ? encodeFeedCursor({
              mode: input.mode,
              surface: input.surface,
              sessionId: session.id,
              position: lastRow.session_position
            })
          : null,
        mode: input.mode,
        surface: input.surface,
        rankingVersion: "deterministic_v1",
        generatedAt: session.as_of.toISOString()
      };
      });
    }
  };
}

async function findFeedRankingSession(
  sql: postgres.TransactionSql,
  input: Parameters<ContentRepository["listHomeFeed"]>[0],
  sessionId: string
): Promise<FeedRankingSessionRow | null> {
  const rows = await sql<FeedRankingSessionRow[]>`
    with viewer as (
      select id
      from users
      where supabase_user_id = ${input.supabaseUserId}
      limit 1
    )
    select session.id, session.as_of
    from feed_ranking_sessions session
    join viewer on viewer.id = session.viewer_user_id
    where session.id = ${sessionId}
      and session.mode = ${input.mode}
      and session.surface = ${input.surface}
      and session.expires_at > now()
    limit 1
  `;
  return rows[0] ?? null;
}

async function createFeedRankingSession(
  sql: postgres.TransactionSql,
  input: Parameters<ContentRepository["listHomeFeed"]>[0]
): Promise<FeedRankingSessionRow | null> {
  await sql`
    delete from feed_ranking_sessions
    where id in (
      select id
      from feed_ranking_sessions
      where expires_at <= now()
      order by expires_at, id
      limit ${FEED_RANKING_SESSION_CLEANUP_LIMIT}
      for update skip locked
    )
  `;

  const rows = await sql<FeedRankingSessionRow[]>`
    with viewer as (
      select id
      from users
      where supabase_user_id = ${input.supabaseUserId}
      limit 1
    ),
    candidate_window as materialized (
      select
        content.id,
        content.creator_user_id,
        content.created_at,
        viewer.id as viewer_id,
        now() as as_of
      from content_items content
      join viewer on true
      where content.state = 'ready'
        and content.publish_state = 'published'
        and content.moderation_state = 'approved'
        and content.creator_user_id <> viewer.id
        and content.created_at <= now()
        and (
          (${input.surface} = 'moments'
            and content.distribution_mode = 'moment'
            and content.expires_at > now())
          or (${input.surface} = 'home' and content.distribution_mode = 'post')
          or (${input.surface} = 'bits'
            and content.distribution_mode = 'post'
            and content.media_type in ('bit', 'clip'))
        )
        and (
          ${input.mode} <> 'following'
          or exists (
            select 1
            from user_follows followed
            where followed.follower_user_id = viewer.id
              and followed.followed_user_id = content.creator_user_id
              and followed.state = 'active'
          )
        )
      order by content.created_at desc, content.id desc
      limit ${FEED_RANKING_CANDIDATE_LIMIT}
    ),
    authorized as materialized (
      select eligible.content_item_id
      from viewer
      cross join lateral private.eligible_content(viewer.id, null) eligible
    ),
    eligible as (
      select
        candidate.id,
        candidate.creator_user_id,
        candidate.created_at,
        candidate.viewer_id,
        candidate.as_of,
        coalesce(counter.like_count, 0) as like_count,
        coalesce(counter.comment_count, 0) as comment_count,
        coalesce(counter.share_count, 0) as share_count,
        coalesce(follow.state = 'active', false) as viewer_following_creator,
        (impression.content_item_id is not null) as seen_before
      from candidate_window candidate
      join authorized on authorized.content_item_id = candidate.id
      left join content_engagement_counters counter on counter.content_item_id = candidate.id
      left join user_follows follow
        on follow.follower_user_id = candidate.viewer_id
        and follow.followed_user_id = candidate.creator_user_id
      left join viewer_content_impressions impression
        on impression.user_id = candidate.viewer_id
        and impression.content_item_id = candidate.id
        and impression.first_seen_at <= candidate.as_of
    ),
    scored as (
      select
        eligible.*,
        (
          case when viewer_following_creator then 260 else 0 end
          + greatest(
              0,
              168 - floor(extract(epoch from (as_of - created_at)) / 3600)::integer
            )
          + least(240::bigint, like_count * 2 + comment_count * 4 + share_count * 3)::integer
          - case when seen_before then 320 else 0 end
          + abs(mod(hashtextextended(id::text || viewer_id::text, 0), 19))::integer
        )::integer as base_score
      from eligible
    ),
    diversified as (
      select
        scored.*,
        row_number() over (
          partition by creator_user_id
          order by base_score desc, created_at desc, id desc
        ) as creator_sequence
      from scored
    ),
    ranked as (
      select
        diversified.*,
        (base_score - least(240, ((creator_sequence - 1) * 80)::integer))::integer as ranking_score
      from diversified
    ),
    snapshot as (
      select coalesce(
        array_agg(id order by ranking_score desc, created_at desc, id desc),
        '{}'::uuid[]
      ) as ranked_content_ids
      from ranked
    )
    insert into feed_ranking_sessions (
      viewer_user_id,
      mode,
      surface,
      as_of,
      ranked_content_ids,
      expires_at
    )
    select
      viewer.id,
      ${input.mode},
      ${input.surface},
      now(),
      snapshot.ranked_content_ids,
      now() + interval '30 minutes'
    from viewer
    cross join snapshot
    returning id, as_of
  `;
  return rows[0] ?? null;
}
