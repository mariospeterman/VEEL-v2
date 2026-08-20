import type postgres from "postgres";

export function liveRoomSelectSql(sql: postgres.Sql, options: { includeHostSecrets?: boolean } = {}) {
  return sql`
    select
      lr.id,
      lr.title,
      lr.state,
      lr.access_rule,
      lr.creator_user_id,
      p.handle as creator_handle,
      p.display_name as creator_display_name,
      p.avatar_url as creator_avatar_url,
      lr.provider_stream_id,
      lr.provider_playback_id,
      ${options.includeHostSecrets ? sql`lr.host_ingest_url` : sql`null::text`} as host_ingest_url,
      ${options.includeHostSecrets ? sql`lr.host_stream_key` : sql`null::text`} as host_stream_key,
      lr.playback_url,
      lr.preview_seconds,
      lr.event_price_minor,
      lr.currency,
      lr.members_only_chat,
      lr.members_included_in_paid_event,
      lr.replay_window_hours,
      lr.replay_content_item_id,
      live_safety.state as live_safety_state,
      live_safety.provider_release_allowed as live_provider_release_allowed,
      coalesce(replay_release.release_allowed, false) as replay_release_allowed,
      replay_release.playback_url as replay_playback_url,
      replay_release.provider_playback_id as replay_provider_playback_id,
      lr.request_hash,
      exists (
        select 1
        from live_passes lp
        where lp.room_id = lr.id
          and lp.user_id = (select id from target_user)
          and lp.state = 'active'
          and lp.starts_at <= now()
          and (lp.expires_at is null or lp.expires_at > now())
      ) as has_active_pass,
      exists (
        select 1
        from subscriptions s
        where s.subscriber_user_id = (select id from target_user)
          and s.creator_user_id = lr.creator_user_id
          and s.scope = 'creator'
          and s.state in ('active', 'renewal_pending', 'grace_period')
          and s.current_period_starts_at is not null
          and s.current_period_starts_at <= now()
          and s.current_period_ends_at is not null
          and s.current_period_ends_at > now()
      ) as has_active_membership,
      lr.creator_user_id = (select id from target_user) as is_creator
    from live_rooms lr
    join users creator on creator.id = lr.creator_user_id
    join profiles p on p.user_id = creator.id
    left join lateral (
      select msc.state, msc.provider_release_allowed
      from media_safety_cases msc
      where msc.live_room_id = lr.id
        and msc.state <> 'superseded'
      limit 1
    ) live_safety on true
    left join lateral (
      select
        (
          ci.state = 'ready'
          and ci.publish_state = 'published'
          and ci.moderation_state = 'approved'
          and msc.state = 'approved'
          and msc.provider_release_allowed is true
          and ma.provider_playable is true
          and ma.ready_at is not null
        ) as release_allowed,
        lra.playback_url,
        lra.provider_playback_id
      from content_items ci
      join media_safety_cases msc
        on msc.content_item_id = ci.id
        and msc.state <> 'superseded'
      join live_replay_assets lra on lra.content_item_id = ci.id
      join media_assets ma
        on ma.content_item_id = ci.id
        and ma.provider = 'livepeer'
        and ma.provider_asset_id = lra.provider_asset_id
      where ci.id = lr.replay_content_item_id
      order by lra.created_at desc
      limit 1
    ) replay_release on true
  `;
}
