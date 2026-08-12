create index content_safety_declarations_uploader_idx
  on content_safety_declarations (uploader_user_id);

create index performer_subjects_linked_user_lookup_idx
  on performer_subjects (linked_user_id)
  where linked_user_id is not null;

create index performer_consents_performer_idx
  on performer_consents (performer_subject_id);

create index performer_consents_recorded_by_idx
  on performer_consents (recorded_by_user_id);

create index media_safety_cases_reviewed_by_idx
  on media_safety_cases (reviewed_by_user_id)
  where reviewed_by_user_id is not null;

create index media_moderation_jobs_case_idx
  on media_moderation_jobs (media_safety_case_id);

create index media_moderation_jobs_asset_idx
  on media_moderation_jobs (media_asset_id)
  where media_asset_id is not null;

create index media_moderation_jobs_live_room_idx
  on media_moderation_jobs (live_room_id)
  where live_room_id is not null;

create index media_moderation_appeals_appellant_idx
  on media_moderation_appeals (appellant_user_id);

create index media_moderation_appeals_reviewed_by_idx
  on media_moderation_appeals (reviewed_by_user_id)
  where reviewed_by_user_id is not null;
