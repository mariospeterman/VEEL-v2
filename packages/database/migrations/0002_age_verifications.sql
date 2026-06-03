-- Age-gate foundation for the first auth/session vertical slice.
-- Provider webhook/session details are added by provider-specific slices.

create type age_state as enum (
  'not_required',
  'required',
  'pending',
  'verified',
  'failed'
);

create table age_verifications (
  id uuid primary key,
  user_id uuid not null references users(id),
  provider text not null,
  provider_reference text not null,
  state age_state not null,
  jurisdiction text,
  rule text,
  verified_at timestamptz,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  unique (provider, provider_reference)
);

create index age_verifications_user_created_at_idx on age_verifications (user_id, created_at desc);
create index age_verifications_state_idx on age_verifications (state);
