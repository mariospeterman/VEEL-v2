-- Allow live room rows to be reserved before Livepeer stream creation.
-- This gives the provider call a durable Veel room id/correlation key and avoids
-- provider resources that cannot be tied back to a database room.

alter table live_rooms
  alter column provider_stream_id drop not null;
