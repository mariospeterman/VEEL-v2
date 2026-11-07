-- Export snapshots, item hashes, grants, and lifecycle audit are durable user
-- portability evidence. Refuse a destructive rollback once any exists.

do $$
begin
  if exists (select 1 from content_export_jobs)
    or exists (select 1 from content_export_download_grants)
    or exists (
      select 1 from audit_events
      where action like 'content_export_%'
    ) then
    raise exception using
      errcode = '55000',
      message = '0139 rollback refused because content export evidence exists';
  end if;
end;
$$;

drop trigger if exists data_requests_create_content_export_job on data_requests;
drop function if exists private.create_content_export_job_after_data_request();
drop function if exists private.snapshot_content_export_request(uuid);

drop index if exists content_export_download_grants_expiry_idx;
drop index if exists content_export_job_items_media_hold_idx;
drop index if exists content_export_job_contents_content_idx;
drop index if exists content_export_jobs_expiry_idx;
drop index if exists content_export_jobs_lease_due_idx;
drop index if exists content_export_jobs_requester_active_uidx;

drop table if exists content_export_download_grants;
drop table if exists content_export_job_items;
drop table if exists content_export_job_contents;
drop table if exists content_export_jobs;

alter table data_requests
  add constraint data_requests_state_export_rollback_check
  check (state in ('requested', 'verifying', 'processing', 'completed', 'rejected')) not valid;

alter table data_requests
  validate constraint data_requests_state_export_rollback_check;

alter table data_requests
  drop constraint data_requests_state_check;

alter table data_requests
  add constraint data_requests_state_check
  check (state in ('requested', 'verifying', 'processing', 'completed', 'rejected')) not valid;

alter table data_requests
  validate constraint data_requests_state_check;

alter table data_requests
  drop constraint data_requests_state_export_rollback_check;
