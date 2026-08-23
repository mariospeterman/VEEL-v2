drop index if exists analytics_reconciliation_projection_date_idx;
drop index if exists analytics_projection_jobs_lease_idx;
drop index if exists analytics_organization_creator_org_date_idx;
drop index if exists analytics_creator_product_creator_date_idx;
drop index if exists analytics_creator_content_creator_date_idx;
drop index if exists analytics_creator_daily_creator_date_idx;

drop table if exists analytics_privacy_suppression_daily;
drop table if exists analytics_reconciliation_runs;
drop table if exists analytics_projection_watermarks;
drop table if exists analytics_projection_jobs;
drop table if exists analytics_organization_creator_daily;
drop table if exists analytics_creator_product_daily;
drop table if exists analytics_creator_content_daily;
drop table if exists analytics_creator_daily;

alter table worker_queue_recovery_requests
  drop constraint if exists worker_queue_recovery_requests_queue_name_check;
alter table worker_queue_recovery_requests
  add constraint worker_queue_recovery_requests_queue_name_check
  check (queue_name in (
    'subscription_collections',
    'notification_deliveries',
    'payment_confirmation_emails',
    'provider_event_replays'
  ));
