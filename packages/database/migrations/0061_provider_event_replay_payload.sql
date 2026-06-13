-- Sanitized provider replay payloads.
-- These are normalized replay facts only, not raw provider webhook bodies.

alter table provider_events
  add column replay_payload jsonb not null default '{}'::jsonb;

create index provider_events_replay_payload_gin_idx
  on provider_events using gin (replay_payload);
