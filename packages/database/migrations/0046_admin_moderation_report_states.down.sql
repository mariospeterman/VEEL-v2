update reports
set state = 'dismissed'
where state = 'rejected';

update reports
set state = 'reviewing'
where state = 'escalated';

alter table reports
  drop constraint if exists reports_state_check;

alter table reports
  add constraint reports_state_check
  check (state in ('submitted', 'queued', 'reviewing', 'resolved', 'dismissed'));
