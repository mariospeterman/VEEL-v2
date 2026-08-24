drop trigger if exists content_items_sync_publication_job on content_items;
drop function if exists private.sync_content_publication_job();
drop table if exists content_publication_jobs;

drop function if exists private.eligible_content(uuid, text);
alter function private.eligible_content_access_base(uuid, text)
  rename to eligible_content;

alter table content_items
  drop constraint if exists content_items_publish_state_check;

update content_items
set publish_state = case when publish_state = 'scheduled' then 'submitted_for_review' else publish_state end;

alter table content_items
  add constraint content_items_publish_state_check
    check (publish_state in ('draft', 'submitted_for_review', 'published', 'blocked', 'unpublished'));

drop index if exists content_items_scheduled_publication_idx;
drop index if exists content_items_active_moments_idx;

alter table content_items
  drop constraint if exists content_items_schedule_future_of_creation_check,
  drop constraint if exists content_items_expiry_after_publication_check,
  drop constraint if exists content_items_moment_shape_check,
  drop constraint if exists content_items_distribution_mode_check,
  drop column if exists scheduled_for,
  drop column if exists expires_at,
  drop column if exists distribution_mode;
