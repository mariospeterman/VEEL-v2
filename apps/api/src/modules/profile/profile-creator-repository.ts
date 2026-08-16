import type postgres from "postgres";
import { toCreatorProfile } from "./profile-repository-mappers.js";
import type { CreatorContentRow, CreatorProfileRow } from "./profile-repository-rows.js";
import type { ProfileRepository } from "./types.js";

export function createProfileCreatorRepositoryMethods(
  sql: postgres.Sql
): Pick<ProfileRepository, "findCreatorProfileByHandle"> {
  return {
    async findCreatorProfileByHandle(handle) {
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
            from content_items ci
            where ci.creator_user_id = u.id
              and ci.state = 'ready'
              and ci.visibility = 'public'
              and ci.moderation_state = 'approved'
              and ci.publish_state = 'published'
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
          ci.nsfw_label,
          ma.poster_url,
          u.id as creator_id,
          p.handle,
          p.display_name,
          p.avatar_url
        from content_items ci
        join users u on u.id = ci.creator_user_id
        join profiles p on p.user_id = u.id
        left join lateral (
          select poster_url
          from media_assets
          where content_item_id = ci.id
          order by created_at asc
          limit 1
        ) ma on true
        where ci.creator_user_id = ${row.id}
          and ci.state = 'ready'
          and ci.visibility = 'public'
          and ci.moderation_state = 'approved'
          and ci.publish_state = 'published'
        order by ci.created_at desc
        limit 12
      `;

      return toCreatorProfile(row, recentContent);
    }
  };
}
