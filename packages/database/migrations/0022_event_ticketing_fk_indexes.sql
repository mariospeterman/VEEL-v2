-- Cover foreign keys introduced by the event ticketing slice.
-- These indexes protect deletes/updates on referenced rows and event ticket policy joins.

create index ticket_entitlements_ticket_type_id_idx
  on ticket_entitlements (ticket_type_id);

create index ticket_purchase_requests_event_id_idx
  on ticket_purchase_requests (event_id);

create index ticket_purchase_requests_ticket_type_id_idx
  on ticket_purchase_requests (ticket_type_id);

create index ticket_requests_ticket_type_id_idx
  on ticket_requests (ticket_type_id);

create index ticket_requests_reviewed_by_user_id_idx
  on ticket_requests (reviewed_by_user_id)
  where reviewed_by_user_id is not null;
