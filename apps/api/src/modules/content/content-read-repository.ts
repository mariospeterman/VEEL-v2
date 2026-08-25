import type postgres from "postgres";
import { accessStateForRule, toContentItem, toEntitlement } from "./content-repository-mappers.js";
import type { ContentDetailRow, ContentUnlockOfferRow } from "./content-repository-rows.js";
import type { ContentRepository } from "./types.js";

export function createContentReadRepositoryMethods(
  sql: postgres.Sql
): Pick<ContentRepository, "findContentDetail" | "findContentUnlockOffer"> {
  return {
    async findContentDetail(input) {
      const rows = await sql<ContentDetailRow[]>`
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
          u.id as creator_id,
          p.handle,
          p.display_name,
          p.avatar_url,
          viewer.id = u.id as viewer_is_creator,
          ma.poster_url,
          ma.playback_url,
          ma.provider,
          ma.provider_state,
          ma.provider_playable,
          universal_assets.media_assets,
          poll_projection.poll,
          car.access_type,
          car.product_type,
          eg.id as entitlement_id,
          eg.state as entitlement_state,
          eg.granted_at as entitlement_granted_at,
          eg.ends_at as entitlement_ends_at,
          exists (
            select 1
            from content_reactions cr
            where cr.content_item_id = ci.id
              and cr.user_id = viewer.id
              and cr.reaction_key = 'like'
              and cr.state = 'active'
          ) as liked,
          exists (
            select 1
            from content_saves cs
            where cs.content_item_id = ci.id
              and cs.user_id = viewer.id
              and cs.state = 'active'
          ) as saved,
          (
            select count(*)
            from content_reactions cr
            where cr.content_item_id = ci.id
              and cr.reaction_key = 'like'
              and cr.state = 'active'
          ) as like_count,
          (
            select count(*)
            from comments c
            where c.content_item_id = ci.id
              and c.moderation_state = 'visible'
          ) as comment_count,
          (
            select count(*)
            from share_records sr
            where sr.target_type = 'content'
              and sr.target_id = ci.id
              and sr.state = 'created'
          ) as share_count
        from content_items ci
        join users u on u.id = ci.creator_user_id
        join profiles p on p.user_id = u.id
        join users viewer on viewer.supabase_user_id = ${input.supabaseUserId}
        left join lateral (
          select poster_url, playback_url, provider, provider_state, provider_playable
          from media_assets
          where content_item_id = ci.id
            and retired_at is null
            and (ci.release_media_asset_id is null or id = ci.release_media_asset_id)
          order by (id = ci.release_media_asset_id) desc, created_at asc
          limit 1
        ) ma on true
        left join lateral (
          select access_type, product_type
          from content_access_rules
          where content_item_id = ci.id
            and state = 'active'
            and (starts_at is null or starts_at <= now())
            and (ends_at is null or ends_at > now())
          order by created_at desc
          limit 1
        ) car on true
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
        ) eg on true
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
        where ci.id = ${input.contentId}
          and (
            exists (
              select 1
              from private.eligible_content(viewer.id, null) eligible
              where eligible.content_item_id = ci.id
            )
            or u.supabase_user_id = ${input.supabaseUserId}
          )
        limit 1
      `;

      const row = rows[0];

      return row ? toContentItem(row, row.poster_url, accessStateForRule(row)) : null;
    },
    async findContentUnlockOffer(input) {
      const rows = await sql<ContentUnlockOfferRow[]>`
        select
          ci.id as content_id,
          car.price_minor,
          car.currency,
          eg.id as entitlement_id,
          eg.state as entitlement_state,
          eg.granted_at as entitlement_granted_at,
          eg.ends_at as entitlement_ends_at,
          creator.supabase_user_id = ${input.supabaseUserId} as is_creator
        from content_items ci
        join users creator on creator.id = ci.creator_user_id
        join users viewer on viewer.supabase_user_id = ${input.supabaseUserId}
        join lateral (
          select price_minor, currency
          from content_access_rules
          where content_item_id = ci.id
            and state = 'active'
            and product_type = 'content_unlock'
            and access_type in ('locked', 'paid')
            and price_minor is not null
            and currency = 'SOL'
            and (starts_at is null or starts_at <= now())
            and (ends_at is null or ends_at > now())
          order by created_at desc
          limit 1
        ) car on true
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
        ) eg on true
        where ci.id = ${input.contentId}
          and exists (
            select 1
            from private.eligible_content(viewer.id, null) eligible
            where eligible.content_item_id = ci.id
          )
        limit 1
      `;

      const row = rows[0];

      if (!row) {
        return null;
      }

      const entitlement = toEntitlement(row);

      return {
        contentId: row.content_id,
        alreadyUnlocked: row.is_creator || Boolean(row.entitlement_id),
        priceMinor: Number(row.price_minor),
        currency: row.currency,
        ...(entitlement ? { entitlement } : {})
      };
    }
  };
}
