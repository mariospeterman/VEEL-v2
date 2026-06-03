-- Age provider waterfall support for pending verification sessions.
-- Stores only normalized state and provider references, never raw identity payloads.

create index age_verifications_provider_state_idx
  on age_verifications (provider, state, created_at desc);
