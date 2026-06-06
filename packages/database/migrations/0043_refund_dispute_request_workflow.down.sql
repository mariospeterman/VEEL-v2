drop policy if exists refunds_and_disputes_select_self_or_staff on refunds_and_disputes;

revoke select on table refunds_and_disputes from authenticated;

drop index if exists refunds_and_disputes_state_created_idx;
drop index if exists refunds_and_disputes_entitlement_idx;
drop index if exists refunds_and_disputes_payment_idx;
drop index if exists refunds_and_disputes_reporter_created_idx;

drop table if exists refunds_and_disputes;
