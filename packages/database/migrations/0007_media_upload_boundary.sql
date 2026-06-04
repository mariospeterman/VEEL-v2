-- Media upload provider boundary indexes.
-- Provider callbacks and reconciliation can use these without storing raw provider payloads.

create index media_assets_provider_state_idx
  on media_assets (provider, provider_state, created_at desc);
