drop policy if exists ticket_requests_select_self_creator_or_staff on ticket_requests;
drop policy if exists ticket_entitlements_select_self_creator_or_staff on ticket_entitlements;
drop policy if exists ticket_purchase_requests_select_self_creator_or_staff on ticket_purchase_requests;
drop policy if exists ticket_types_select_public_owner_holder_or_staff on ticket_types;
drop policy if exists events_select_public_owner_or_staff on events;

drop index if exists ticket_requests_requester_idx;
drop index if exists ticket_entitlements_event_idx;
drop index if exists ticket_entitlements_holder_idx;
drop index if exists ticket_purchase_requests_buyer_idx;
drop index if exists ticket_types_event_state_idx;
drop index if exists events_state_starts_at_idx;
drop index if exists events_creator_created_at_idx;

drop table if exists ticket_requests;
drop table if exists ticket_entitlements;
drop table if exists ticket_purchase_requests;
drop table if exists ticket_types;
drop table if exists events;
