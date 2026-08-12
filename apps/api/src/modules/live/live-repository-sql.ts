import type postgres from "postgres";

export function liveRoomSelectSql(sql: postgres.Sql) {
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
      lr.host_ingest_url,
      lr.host_stream_key,
      lr.playback_url,
      lr.preview_seconds,
      lr.event_price_minor,
      lr.currency,
      lr.members_only_chat,
      lr.members_included_in_paid_event,
      lr.replay_window_hours,
      lr.replay_content_item_id,
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
          and (s.current_period_ends_at is null or s.current_period_ends_at > now())
      ) as has_active_membership,
      lr.creator_user_id = (select id from target_user) as is_creator
    from live_rooms lr
    join users creator on creator.id = lr.creator_user_id
    join profiles p on p.user_id = creator.id
  `;
}
