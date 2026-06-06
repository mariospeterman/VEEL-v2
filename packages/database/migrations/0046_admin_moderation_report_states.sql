-- Align report review states with the admin moderation contract.
update reports
set state = 'rejected'
where state = 'dismissed';

alter table reports
  drop constraint if exists reports_state_check;

alter table reports
  add constraint reports_state_check
  check (state in ('submitted', 'queued', 'reviewing', 'resolved', 'escalated', 'rejected'));
