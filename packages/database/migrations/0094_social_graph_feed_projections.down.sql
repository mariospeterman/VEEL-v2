drop policy if exists feed_impression_receipts_select_self_or_staff on feed_impression_receipts;
drop policy if exists viewer_content_impressions_select_self_or_staff on viewer_content_impressions;
drop policy if exists content_engagement_counters_select_authenticated on content_engagement_counters;
drop policy if exists user_social_counts_select_authenticated on user_social_counts;
drop policy if exists follow_action_receipts_select_actor_or_staff on follow_action_receipts;
drop policy if exists user_follows_select_participant_or_staff on user_follows;

revoke select on table feed_impression_receipts from authenticated;
revoke select on table viewer_content_impressions from authenticated;
revoke select on table content_engagement_counters from authenticated;
revoke select on table user_social_counts from authenticated;
revoke select on table follow_action_receipts from authenticated;
revoke select on table user_follows from authenticated;

drop trigger if exists share_records_refresh_counter on share_records;
drop trigger if exists comments_refresh_counter on comments;
drop trigger if exists content_reactions_refresh_counter on content_reactions;
drop trigger if exists blocks_remove_follow_edges on blocks;
drop trigger if exists user_follows_apply_counts on user_follows;
drop trigger if exists content_items_ensure_engagement_projection on content_items;
drop trigger if exists users_ensure_social_projection on users;

drop function if exists private.refresh_content_engagement_counter();
drop function if exists private.remove_blocked_follow_edges();
drop function if exists private.apply_follow_count_delta();
drop function if exists private.ensure_content_engagement_projection();
drop function if exists private.ensure_user_social_projection();

drop index if exists content_items_feed_compound_idx;
drop index if exists feed_impression_receipts_expiry_idx;
drop index if exists feed_impression_receipts_content_fk_idx;
drop index if exists viewer_content_impressions_content_fk_idx;
drop index if exists viewer_content_impressions_user_recent_idx;
drop index if exists follow_action_receipts_target_user_fk_idx;
drop index if exists user_follows_followed_user_fk_idx;
drop index if exists user_follows_follower_active_idx;
drop index if exists user_follows_followed_active_idx;

drop table if exists feed_impression_receipts;
drop table if exists viewer_content_impressions;
drop table if exists content_engagement_counters;
drop table if exists user_social_counts;
drop table if exists follow_action_receipts;
drop table if exists user_follows;

alter extension pgcrypto set schema public;
