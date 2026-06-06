drop policy if exists content_hashtags_select_visible_content_or_staff on content_hashtags;
drop policy if exists hashtags_select_active_or_staff on hashtags;

revoke select on table content_hashtags from authenticated;
revoke select on table hashtags from authenticated;

drop index if exists content_hashtags_hashtag_content_idx;
drop index if exists hashtags_state_slug_idx;

drop table if exists content_hashtags;
drop table if exists hashtags;
