drop index if exists provider_events_replay_payload_gin_idx;

alter table provider_events
  drop column if exists replay_payload;
