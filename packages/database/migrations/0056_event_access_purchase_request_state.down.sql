-- Roll back Event Access purchase request state vocabulary to the legacy ticket label.

alter table event_access_purchase_requests
  drop constraint if exists event_access_purchase_requests_state_check;

update event_access_purchase_requests
set state = 'ticket_granted'
where state = 'access_pass_granted';

alter table event_access_purchase_requests
  add constraint event_access_purchase_requests_state_check
  check (state in ('pending_payment', 'ticket_granted', 'cancelled'));
