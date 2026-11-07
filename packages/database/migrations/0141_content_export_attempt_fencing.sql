-- Fence content-export provider writes with immutable per-attempt object keys.
--
-- A database lease can prevent a stale worker from publishing state, but it
-- cannot stop an already-started external PUT. Each lease therefore owns a
-- distinct private object. Only the lease winner may publish its object key on
-- content_export_jobs; every other started object remains explicit cleanup
-- evidence. Provider deletion is intentionally not automated here.

alter table content_export_jobs
  add column archive_attempt_sequence bigint not null default 0
  check (archive_attempt_sequence >= 0);

create table content_export_archive_attempts (
  id uuid primary key,
  job_id uuid not null references content_export_jobs(id) on delete restrict,
  attempt_sequence bigint not null check (attempt_sequence > 0),
  attempt_count integer not null check (attempt_count between 1 and 8),
  lease_token uuid not null unique,
  object_key text not null unique check (
    object_key ~ '^exports/[0-9a-f-]{36}/[0-9a-f-]{36}\.tar$'
  ),
  state text not null default 'allocated' check (state in (
    'allocated', 'uploading', 'uploaded', 'published',
    'cleanup_required', 'cleanup_confirmed', 'abandoned'
  )),
  upload_started_at timestamptz,
  upload_completed_at timestamptz,
  published_at timestamptz,
  cleanup_confirmed_at timestamptz,
  archive_byte_size bigint check (archive_byte_size is null or archive_byte_size > 0),
  archive_sha256 text check (archive_sha256 is null or archive_sha256 ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  unique (job_id, attempt_sequence),
  check (
    (
      state = 'allocated'
      and upload_started_at is null
      and upload_completed_at is null
      and published_at is null
      and cleanup_confirmed_at is null
      and archive_byte_size is null
      and archive_sha256 is null
    )
    or (
      state = 'uploading'
      and upload_started_at is not null
      and upload_completed_at is null
      and published_at is null
      and cleanup_confirmed_at is null
      and archive_byte_size is null
      and archive_sha256 is null
    )
    or (
      state = 'uploaded'
      and upload_started_at is not null
      and upload_completed_at is not null
      and published_at is null
      and cleanup_confirmed_at is null
      and archive_byte_size is not null
      and archive_sha256 is not null
    )
    or (
      state = 'published'
      and upload_started_at is not null
      and upload_completed_at is not null
      and published_at is not null
      and cleanup_confirmed_at is null
      and archive_byte_size is not null
      and archive_sha256 is not null
    )
    or (
      state = 'cleanup_required'
      and upload_started_at is not null
      and published_at is null
      and cleanup_confirmed_at is null
      and ((upload_completed_at is null and archive_byte_size is null and archive_sha256 is null)
        or (upload_completed_at is not null and archive_byte_size is not null and archive_sha256 is not null))
    )
    or (
      state = 'cleanup_confirmed'
      and upload_started_at is not null
      and published_at is null
      and cleanup_confirmed_at is not null
      and ((upload_completed_at is null and archive_byte_size is null and archive_sha256 is null)
        or (upload_completed_at is not null and archive_byte_size is not null and archive_sha256 is not null))
    )
    or (
      state = 'abandoned'
      and upload_started_at is null
      and upload_completed_at is null
      and published_at is null
      and cleanup_confirmed_at is null
      and archive_byte_size is null
      and archive_sha256 is null
    )
  )
);

create index content_export_archive_attempts_job_idx
  on content_export_archive_attempts (job_id, created_at, id);

create index content_export_archive_attempts_cleanup_idx
  on content_export_archive_attempts (created_at, id)
  where state = 'cleanup_required';

create index content_export_archive_attempts_job_cleanup_idx
  on content_export_archive_attempts (job_id, created_at, id)
  where state = 'cleanup_required';

alter table content_export_archive_attempts enable row level security;

revoke all on table content_export_archive_attempts
from public, anon, authenticated;

comment on table content_export_archive_attempts is
  'Server-only immutable provider-object identity per export lease. Only a published attempt may become the job download pointer; provider deletion remains an explicit operator-confirmed action.';
comment on column content_export_archive_attempts.object_key is
  'Private per-attempt Bunny Storage key. A stale attempt can finish only at its own key and cannot overwrite a newer published archive.';
comment on column content_export_archive_attempts.attempt_sequence is
  'Monotonic job-lifetime archive-attempt identity. Unlike attempt_count, it never resets when an owner retries a dead-lettered export.';
comment on column content_export_archive_attempts.state is
  'cleanup_required records a possible or confirmed non-winning external object. Migration 0141 does not call provider deletion.';

-- Preserve already-linked archives, any in-flight lease, and every legacy
-- non-winning object for which a provider PUT may have started. In 0139 the
-- job row was the only durable place holding that object key. Retaining the
-- key here before a later retry can publish a different winner prevents the
-- old cleanup evidence from being overwritten.
insert into content_export_archive_attempts (
  id,
  job_id,
  attempt_sequence,
  attempt_count,
  lease_token,
  object_key,
  state,
  upload_started_at,
  upload_completed_at,
  published_at,
  archive_byte_size,
  archive_sha256,
  created_at,
  updated_at
)
select
  gen_random_uuid(),
  job.id,
  greatest(job.attempt_count, 1)::bigint,
  greatest(job.attempt_count, 1),
  coalesce(job.lease_token, gen_random_uuid()),
  job.archive_object_key,
  case
    when job.state in ('ready', 'expired') then 'published'
    when job.state = 'processing' and job.archive_upload_started_at is not null then 'uploading'
    when job.state = 'processing' then 'allocated'
    else 'cleanup_required'
  end,
  job.archive_upload_started_at,
  case when job.state in ('ready', 'expired') then job.archive_ready_at else null end,
  case when job.state in ('ready', 'expired') then job.archive_ready_at else null end,
  case when job.state in ('ready', 'expired') then job.archive_byte_size else null end,
  case when job.state in ('ready', 'expired') then job.archive_sha256 else null end,
  job.created_at,
  clock_timestamp()
from content_export_jobs job
where job.state in ('processing', 'ready', 'expired')
   or (
     job.state in ('queued', 'retry', 'cancelled', 'dead_letter')
     and job.cleanup_state = 'manual_confirmation_required'
     and job.archive_upload_started_at is not null
   );

update content_export_jobs job
set archive_attempt_sequence = attempts.latest_attempt_sequence
from (
  select job_id, max(attempt_sequence) as latest_attempt_sequence
  from content_export_archive_attempts
  group by job_id
) attempts
where job.id = attempts.job_id;
