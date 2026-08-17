-- Record the newest provider observation applied to a live room so recovery
-- cannot overwrite a later direct Livepeer sync with an older delivery.

alter table live_rooms
  add column provider_checked_at timestamptz;

-- Existing provider state has already been applied through direct sync,
-- webhook handling, provider attachment, or an operator control. The room's
-- latest mutation time is a conservative recovery freshness cutoff; older
-- recovery evidence must not overwrite it after this migration.
update live_rooms
set provider_checked_at = updated_at
where provider_stream_id is not null;

comment on column live_rooms.provider_checked_at is
  'Time the latest direct Livepeer status read completed for this room.';
