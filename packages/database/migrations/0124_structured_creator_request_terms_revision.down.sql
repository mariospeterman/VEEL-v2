alter table public.structured_creator_requests
  drop constraint if exists structured_creator_requests_terms_revision_positive;

alter table public.structured_creator_requests
  drop column if exists terms_revision;
