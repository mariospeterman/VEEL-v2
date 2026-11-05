drop trigger if exists content_items_retired_format_write_boundary on content_items;
drop function if exists private.enforce_retired_content_write_boundary();

drop index if exists content_items_moments_chronological_idx;
drop index if exists content_items_bits_chronological_idx;
drop index if exists content_items_home_chronological_idx;

alter table content_items
  drop constraint if exists content_items_published_at_required_check;

alter table viewer_feed_preferences
  drop constraint if exists viewer_feed_preferences_default_feed_mode_check;

update viewer_feed_preferences
set default_feed_mode = 'recommended', updated_at = now()
where default_feed_mode = 'latest';

alter table viewer_feed_preferences
  alter column default_feed_mode set default 'recommended';

alter table viewer_feed_preferences
  add constraint viewer_feed_preferences_default_feed_mode_check
    check (default_feed_mode in ('recommended', 'following'));

comment on column content_items.published_at is null;
comment on table feed_ranking_sessions is
  'Short-lived bounded deterministic feed ranking sessions.';

-- The historical published_at backfill and safety-driven job cancellations are
-- deliberately retained: erasing chronology or reopening scheduled retired
-- formats would be a destructive rollback.
