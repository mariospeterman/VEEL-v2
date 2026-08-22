import type postgres from "postgres";
import { toCreatorProfile } from "./profile-repository-mappers.js";
import type { CreatorContentRow, CreatorProfileRow } from "./profile-repository-rows.js";
import type { ProfileRepository } from "./types.js";

export function createProfileCreatorRepositoryMethods(
  sql: postgres.Sql
): Pick<ProfileRepository, "findCreatorProfileByHandle"> {
  return {
    async findCreatorProfileByHandle(handle, viewerUserId = null) {
      const viewerRows = viewerUserId
        ? await sql<{ id: string }[]>`
            select id from users where supabase_user_id = ${viewerUserId} limit 1
          `
        : [];
      const appViewerUserId = viewerRows[0]?.id ?? null;
      const rows = await sql<CreatorProfileRow[]>`
        select
          u.id,
          p.handle,
          p.display_name,
          p.avatar_url,
          p.bio,
          p.profile_links,
          p.location_label,
          coalesce(cms.support_enabled, true) as support_enabled,
          coalesce(cms.content_unlocks_enabled, true) as content_unlocks_enabled,
          coalesce(cms.live_passes_enabled, true) as live_passes_enabled,
          coalesce(cms.paid_messages_enabled, true) as paid_messages_enabled,
          coalesce(cms.subscriptions_enabled, false) as subscriptions_enabled,
          membership.id as membership_plan_id,
          membership.label as membership_label,
          membership.description as membership_description,
          membership.benefits as membership_benefits,
          membership.amount_minor as membership_amount_minor,
          membership.amount_atomic as membership_amount_atomic,
          membership.provider_state as membership_provider_state,
          membership.token_mint as membership_token_mint,
          membership.token_program as membership_token_program,
          membership.program_id as membership_program_id,
          membership.merchant_wallet as membership_merchant_wallet,
          coalesce(social.follower_count, 0) as follower_count,
          coalesce(social.following_count, 0) as following_count,
          (
            select count(*)
            from private.eligible_content(${appViewerUserId}, null) eligible
            join content_items ci on ci.id = eligible.content_item_id
            where ci.creator_user_id = u.id
          ) as content_count,
          (
            select count(*)
            from live_rooms lr
            where lr.creator_user_id = u.id
              and lr.state <> 'deleted'
          ) as live_room_count,
          (
            select count(distinct pi.id)
            from payment_intents pi
            left join content_items ci on ci.id = pi.target_id
            left join live_rooms lr on lr.id = pi.target_id
            where pi.state = 'confirmed'
              and (
                pi.target_id = u.id
                or ci.creator_user_id = u.id
                or lr.creator_user_id = u.id
              )
          ) as confirmed_payment_count
        from profiles p
        join users u on u.id = p.user_id
        left join creator_monetisation_settings cms on cms.user_id = u.id
        left join lateral (
          select sp.*
          from subscription_plans sp
          where sp.creator_user_id = u.id and sp.scope = 'creator'
          order by sp.updated_at desc
          limit 1
        ) membership on true
        left join user_social_counts social on social.user_id = u.id
        where lower(p.handle) = lower(${handle})
          and p.visibility = 'public'
          and u.state = 'active'
        limit 1
      `;
      const row = rows[0];

      if (!row) {
        return null;
      }

      const recentContent = await sql<CreatorContentRow[]>`
        select
          ci.id,
          ci.media_type,
          ci.caption,
          ci.body_text,
          ci.asset_revision,
          ci.nsfw_label,
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
          coalesce(${appViewerUserId}::uuid = ci.creator_user_id, false) as viewer_is_creator,
          u.id as creator_id,
          p.handle,
          p.display_name,
          p.avatar_url
        from content_items ci
        join private.eligible_content(${appViewerUserId}, null) eligible
          on eligible.content_item_id = ci.id
        join users u on u.id = ci.creator_user_id
        join profiles p on p.user_id = u.id
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
          where user_id = ${appViewerUserId}
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
            and viewer_vote.voter_user_id = ${appViewerUserId}
          where poll.content_item_id = ci.id
        ) poll_projection on true
        where ci.creator_user_id = ${row.id}
        order by ci.created_at desc
        limit 12
      `;

      return toCreatorProfile(row, recentContent);
    }
  };
}
