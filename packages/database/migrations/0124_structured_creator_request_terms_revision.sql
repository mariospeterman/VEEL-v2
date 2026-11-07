alter table public.structured_creator_requests
  add column terms_revision integer not null default 1;

alter table public.structured_creator_requests
  add constraint structured_creator_requests_terms_revision_positive
  check (terms_revision > 0);

comment on column public.structured_creator_requests.terms_revision is
  'Monotonic exact-terms revision. Accept and counteroffer commands must bind to the current value.';
