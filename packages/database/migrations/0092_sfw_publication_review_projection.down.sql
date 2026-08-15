drop index if exists content_items_owner_publication_idx;

alter table media_moderation_appeals
  drop constraint if exists media_moderation_appeals_idempotency_key_unique,
  drop column if exists idempotency_key;

update media_safety_cases
set state = 'review_required'
where state = 'changes_requested';

alter table media_safety_cases
  drop constraint if exists media_safety_cases_decision_message_check,
  drop constraint if exists media_safety_cases_state_check,
  drop column if exists decision_message;

alter table media_safety_cases
  add constraint media_safety_cases_state_check check (state in (
    'quarantined',
    'preprocessing',
    'hash_checking',
    'classification',
    'review_required',
    'approved',
    'rejected',
    'held_for_reporting',
    'appealed',
    'superseded'
  ));
