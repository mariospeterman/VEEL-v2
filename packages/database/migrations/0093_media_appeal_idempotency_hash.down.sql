alter table media_moderation_appeals
  drop constraint if exists media_moderation_appeals_request_hash_check,
  drop column if exists request_hash;
