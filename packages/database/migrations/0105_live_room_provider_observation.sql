-- Record the newest provider observation applied to a live room so recovery
-- cannot overwrite a later direct Livepeer sync with an older delivery.

alter table live_rooms
  add column provider_checked_at timestamptz;

comment on column live_rooms.provider_checked_at is
  'Time of the latest Livepeer status observation applied to this room.';
