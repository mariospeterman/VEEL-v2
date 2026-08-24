-- Moments and scheduled publication remain distribution modes of canonical content_items.

alter table content_items
  add column distribution_mode text not null default 'post',
  add column expires_at timestamptz,
  add column scheduled_for timestamptz;

alter table content_items
  add constraint content_items_distribution_mode_check
    check (distribution_mode in ('post', 'moment')),
  add constraint content_items_moment_shape_check
    check (
      distribution_mode <> 'moment'
      or (
        media_type in ('bit', 'clip', 'image', 'vod', 'carousel')
        and (publish_state <> 'published' or expires_at is not null)
      )
    ),
  add constraint content_items_expiry_after_publication_check
    check (expires_at is null or expires_at > coalesce(published_at, created_at)),
  add constraint content_items_schedule_future_of_creation_check
    check (scheduled_for is null or scheduled_for > created_at);

alter table content_items
  drop constraint if exists content_items_publish_state_check;

alter table content_items
  add constraint content_items_publish_state_check
    check (publish_state in ('draft', 'submitted_for_review', 'scheduled', 'published', 'blocked', 'unpublished'));

create index content_items_active_moments_idx
  on content_items (created_at desc, id desc)
  where distribution_mode = 'moment' and publish_state = 'published';

create index content_items_scheduled_publication_idx
  on content_items (scheduled_for, id)
  where publish_state = 'scheduled';

create table content_publication_jobs (
  content_item_id uuid primary key references content_items(id) on delete cascade,
  creator_user_id uuid not null references users(id),
  scheduled_for timestamptz not null,
  state text not null default 'queued'
    check (state in ('queued', 'leased', 'retry', 'completed', 'dead_letter', 'cancelled')),
  attempt_count integer not null default 0 check (attempt_count between 0 and 8),
  next_attempt_at timestamptz not null,
  lease_token uuid,
  leased_until timestamptz,
  last_error_code text,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((state = 'leased') = (lease_token is not null and leased_until is not null))
);

create index content_publication_jobs_due_idx
  on content_publication_jobs (next_attempt_at, scheduled_for, content_item_id)
  where state in ('queued', 'retry', 'leased');

alter table content_publication_jobs enable row level security;
revoke all on table content_publication_jobs from public, anon, authenticated;

create or replace function private.sync_content_publication_job()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
begin
  if new.publish_state = 'scheduled' and new.scheduled_for is not null then
    insert into content_publication_jobs (
      content_item_id,
      creator_user_id,
      scheduled_for,
      state,
      next_attempt_at
    ) values (
      new.id,
      new.creator_user_id,
      new.scheduled_for,
      'queued',
      new.scheduled_for
    )
    on conflict (content_item_id) do update set
      scheduled_for = excluded.scheduled_for,
      state = 'queued',
      attempt_count = 0,
      next_attempt_at = excluded.scheduled_for,
      lease_token = null,
      leased_until = null,
      last_error_code = null,
      completed_at = null,
      updated_at = now();
  elsif old.publish_state = 'scheduled' then
    update content_publication_jobs
    set
      state = case when new.publish_state = 'published' then 'completed' else 'cancelled' end,
      lease_token = null,
      leased_until = null,
      completed_at = case when new.publish_state = 'published' then now() else completed_at end,
      updated_at = now()
    where content_item_id = new.id
      and state not in ('completed', 'dead_letter', 'cancelled');
  end if;
  return new;
end;
$$;

revoke all on function private.sync_content_publication_job() from public, anon, authenticated;

create trigger content_items_sync_publication_job
after update of publish_state, scheduled_for on content_items
for each row execute function private.sync_content_publication_job();

alter function private.eligible_content(uuid, text)
  rename to eligible_content_access_base;

create function private.eligible_content(
  p_viewer_user_id uuid,
  p_content_preference text default null
)
returns table (content_item_id uuid)
language sql
stable
security invoker
set search_path = public, private
as $$
  select eligible.content_item_id
  from private.eligible_content_access_base(p_viewer_user_id, p_content_preference) eligible
  join content_items content on content.id = eligible.content_item_id
  where (content.scheduled_for is null or content.scheduled_for <= now())
    and (content.distribution_mode <> 'moment' or content.expires_at > now());
$$;

revoke all on function private.eligible_content(uuid, text)
  from public, anon, authenticated;

comment on function private.eligible_content(uuid, text) is
  'Canonical content eligibility plus scheduled-release and Moment public-visibility boundaries.';

comment on table content_publication_jobs is
  'Bounded scheduled-publication lease queue. It rechecks canonical release evidence and never bypasses moderation, rights, age, access, or provider readiness.';
