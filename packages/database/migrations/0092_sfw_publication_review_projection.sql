-- Product-facing SFW publication review projection. The canonical decision remains
-- media_safety_cases; this migration only adds a safe uploader-facing message,
-- replay-safe appeal key, and owner-list performance index.

alter table media_safety_cases
  drop constraint media_safety_cases_state_check;

alter table media_safety_cases
  add column decision_message text,
  add constraint media_safety_cases_state_check check (state in (
    'quarantined',
    'preprocessing',
    'hash_checking',
    'classification',
    'review_required',
    'changes_requested',
    'approved',
    'rejected',
    'held_for_reporting',
    'appealed',
    'superseded'
  )),
  add constraint media_safety_cases_decision_message_check check (
    decision_message is null or char_length(decision_message) between 3 and 500
  );

alter table media_moderation_appeals
  add column idempotency_key text,
  add constraint media_moderation_appeals_idempotency_key_unique unique (idempotency_key);

create index content_items_owner_publication_idx
  on content_items (creator_user_id, updated_at desc);

comment on column media_safety_cases.decision_message is
  'Staff-authored, uploader-safe review message. Never contains raw provider payloads or illegal-media evidence.';
comment on column media_moderation_appeals.idempotency_key is
  'Server-scoped replay key for one creator appeal mutation.';
