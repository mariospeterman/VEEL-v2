-- Bind moderation-appeal replay keys to the normalized request that created them.
-- Existing pre-migration rows remain readable; every new API write stores a SHA-256 request hash.

alter table media_moderation_appeals
  add column request_hash text,
  add constraint media_moderation_appeals_request_hash_check check (
    request_hash is null or request_hash ~ '^[0-9a-f]{64}$'
  );

comment on column media_moderation_appeals.request_hash is
  'SHA-256 of the content id and normalized appeal reason used to reject changed-input replay keys.';
