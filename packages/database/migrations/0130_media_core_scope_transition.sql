-- Retire new text/poll publication and move the primary media feed to a
-- publication-time keyset. Historical content and vote records remain intact.

update viewer_feed_preferences
set default_feed_mode = 'latest', updated_at = now()
where default_feed_mode = 'recommended';

alter table viewer_feed_preferences
  alter column default_feed_mode set default 'latest';

alter table viewer_feed_preferences
  drop constraint if exists viewer_feed_preferences_default_feed_mode_check;

alter table viewer_feed_preferences
  add constraint viewer_feed_preferences_default_feed_mode_check
    check (default_feed_mode in ('latest', 'following'));

-- Old published rows predate the explicit publication clock. Preserve the best
-- available immutable server chronology instead of sorting them by engagement.
update content_items
set published_at = coalesce(publish_requested_at, created_at)
where publish_state = 'published'
  and published_at is null;

alter table content_items
  add constraint content_items_published_at_required_check
    check (publish_state <> 'published' or published_at is not null)
    not valid;

alter table content_items
  validate constraint content_items_published_at_required_check;

-- A scheduled retired format must never be released by an already queued job.
-- The existing publication-job trigger records the corresponding cancellation.
update content_items
set publish_state = 'unpublished', updated_at = now()
where media_type in ('text', 'poll')
  and publish_state = 'scheduled';

update content_publication_jobs job
set
  state = 'cancelled',
  lease_token = null,
  leased_until = null,
  last_error_code = 'content_format_retired',
  updated_at = now()
from content_items content
where content.id = job.content_item_id
  and content.media_type in ('text', 'poll')
  and job.state not in ('completed', 'dead_letter', 'cancelled');

create or replace function private.enforce_retired_content_write_boundary()
returns trigger
language plpgsql
security invoker
set search_path = public, private
as $$
begin
  if tg_op = 'UPDATE'
    and old.media_type in ('text', 'poll')
    and old.media_type is distinct from new.media_type then
    raise exception using
      errcode = '23514',
      message = 'historical retired content cannot be converted';
  end if;

  if new.media_type in ('text', 'poll') then
    if tg_op = 'INSERT' then
      raise exception using
        errcode = '23514',
        message = 'retired content formats cannot be created';
    end if;

    if old.media_type is distinct from new.media_type then
      raise exception using
        errcode = '23514',
        message = 'content cannot be converted to a retired format';
    end if;

    if new.publish_state in ('scheduled', 'published')
      and old.publish_state is distinct from new.publish_state then
      raise exception using
        errcode = '23514',
        message = 'retired content formats cannot be republished';
    end if;
  end if;

  return new;
end;
$$;

revoke all on function private.enforce_retired_content_write_boundary()
  from public, anon, authenticated;

create trigger content_items_retired_format_write_boundary
before insert or update of media_type, publish_state on content_items
for each row execute function private.enforce_retired_content_write_boundary();

create index content_items_home_chronological_idx
  on content_items (published_at desc, id desc)
  where state = 'ready'
    and publish_state = 'published'
    and moderation_state = 'approved'
    and distribution_mode = 'post'
    and media_type not in ('text', 'poll');

create index content_items_bits_chronological_idx
  on content_items (published_at desc, id desc)
  where state = 'ready'
    and publish_state = 'published'
    and moderation_state = 'approved'
    and distribution_mode = 'post'
    and media_type in ('bit', 'clip');

create index content_items_moments_chronological_idx
  on content_items (published_at desc, id desc)
  where state = 'ready'
    and publish_state = 'published'
    and moderation_state = 'approved'
    and distribution_mode = 'moment'
    and media_type not in ('text', 'poll');

comment on column content_items.published_at is
  'Canonical first-publication time. It is assigned once on release, retained across unpublish, and reused on an authorized republish.';

comment on table feed_ranking_sessions is
  'Obsolete short-lived v2 ranking snapshots retained only for rolling compatibility. The chronological v3 feed does not write this table.';
