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
      return sql.begin("isolation level repeatable read read only", async (transaction) => {
        const asOf = decodedCursor?.asOf ?? new Date().toISOString();
        const rankingStates = await transaction<{ revision: string }[]>`
          with ranking_inputs as (
            ${eligibleFeedSql(transaction, input, asOf)}
          )
          select md5(coalesce(string_agg(
            concat_ws(
              ':',
              id::text,
              creator_user_id::text,
              like_count::text,
              comment_count::text,
              share_count::text,
              viewer_following_creator::text,
              seen_before::text
            ),
            '|' order by id
          ), '')) as revision
          from ranking_inputs
        `;
        const rankingRevision = rankingStates[0]?.revision;
        if (!rankingRevision) throw new InvalidFeedCursorError();
        if (decodedCursor && decodedCursor.rankingRevision !== rankingRevision) {
          throw new StaleFeedCursorError();
        }

        const rows = await transaction<FeedRow[]>`
        with eligible as (
          ${eligibleFeedSql(transaction, input, asOf)}
        ),
        scored as (
          select
            eligible.*,
            (
              case when viewer_following_creator then 260 else 0 end
              + greatest(
                  0,
                  168 - floor(extract(epoch from (${asOf}::timestamptz - created_at)) / 3600)::integer
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
        page_ids as (
          select *
          from ranked
          where (
            ${decodedCursor?.score ?? null}::integer is null
            or (ranking_score, created_at, id) < (
              ${decodedCursor?.score ?? null}::integer,
              ${decodedCursor?.createdAt ?? null}::timestamptz,
              ${decodedCursor?.id ?? null}::uuid
            )
          )
          order by ranking_score desc, created_at desc, id desc
          limit ${input.limit + 1}
        )
        select
          ci.id,
          ci.media_type,
          ci.caption,
          ci.body_text,
          ci.asset_revision,
          ci.nsfw_label,
          ci.created_at,
          page_ids.ranking_score,
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
          page_ids.like_count,
          page_ids.comment_count,
          page_ids.share_count,
          page_ids.viewer_following_creator
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
        left join lateral (
          select poster_url, playback_url, provider, provider_state, provider_playable
          from media_assets
          where id = ci.release_media_asset_id
            and content_item_id = ci.id
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
          select jsonb_agg(
            jsonb_build_object(
              'id', asset.id,
              'kind', asset.asset_kind,
              'position', asset.position,
              'provider', asset.provider,
              'providerState', asset.provider_state,
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
              'visibleLabelState', asset.visible_label_state
            )
            order by asset.position
          ) as media_assets
          from media_assets asset
          where asset.content_item_id = ci.id
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
        order by page_ids.ranking_score desc, ci.created_at desc, ci.id desc
      `;

      const pageRows = rows.slice(0, input.limit);
      const lastRow = pageRows.at(-1);
      return {
        items: pageRows.map((row) => toContentItem(row, row.poster_url, accessStateForRule(row))),
        nextCursor: rows.length > input.limit && lastRow
          ? encodeFeedCursor({
              mode: input.mode,
              surface: input.surface,
              asOf,
              rankingRevision,
              score: lastRow.ranking_score,
              createdAt: lastRow.created_at.toISOString(),
              id: lastRow.id
            })
          : null,
        mode: input.mode,
        surface: input.surface,
        rankingVersion: "deterministic_v1",
        generatedAt: asOf
      };
      });
    }
  };
}

function eligibleFeedSql(
  sql: postgres.TransactionSql,
  input: Parameters<ContentRepository["listHomeFeed"]>[0],
  asOf: string
) {
  return sql`
    with viewer as (
      select id
      from users
      where supabase_user_id = ${input.supabaseUserId}
      limit 1
    )
    select
      ci.id,
      ci.creator_user_id,
      ci.created_at,
      coalesce(counter.like_count, 0) as like_count,
      coalesce(counter.comment_count, 0) as comment_count,
      coalesce(counter.share_count, 0) as share_count,
      coalesce(follow.state = 'active', false) as viewer_following_creator,
      (impression.content_item_id is not null) as seen_before,
      viewer.id as viewer_id
    from content_items ci
    join viewer on true
    join private.eligible_content(viewer.id, null) eligible
      on eligible.content_item_id = ci.id
    left join content_engagement_counters counter on counter.content_item_id = ci.id
    left join user_follows follow
      on follow.follower_user_id = viewer.id
      and follow.followed_user_id = ci.creator_user_id
    left join viewer_content_impressions impression
      on impression.user_id = viewer.id
      and impression.content_item_id = ci.id
      and impression.first_seen_at <= ${asOf}::timestamptz
    where ci.creator_user_id <> viewer.id
      and ci.created_at <= ${asOf}::timestamptz
      and (${input.surface} = 'home' or ci.media_type in ('bit', 'clip'))
      and (${input.mode} <> 'following' or follow.state = 'active')
  `;
}
