-- Convergence 04: bind wallet authentication to an immutable login or onboarding purpose.
-- Existing unconsumed challenges predate purpose-bound signed messages and are intentionally
-- invalidated by the application message check after this migration.

alter table wallet_auth_challenges
  add column purpose text;

update wallet_auth_challenges
set purpose = 'onboarding'
where purpose is null;

alter table wallet_auth_challenges
  alter column purpose set not null,
  add constraint wallet_auth_challenges_purpose_check
    check (purpose in ('login', 'onboarding'));

create index wallet_auth_challenges_purpose_address_created_idx
  on wallet_auth_challenges (purpose, chain, address, created_at desc);
