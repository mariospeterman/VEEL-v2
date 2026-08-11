-- Separate adult-publisher eligibility from viewing access and retain the
-- policy acceptance that made a provider decision actionable.

alter table verification_sessions
  drop constraint verification_sessions_purpose_check;

alter table verification_records
  drop constraint verification_records_purpose_check;

update verification_sessions
set purpose = 'adult_publisher_eligibility',
    status = case when status = 'approved' then 'needs_review' else status end,
    updated_at = now()
where purpose = 'adult_content_access';

update verification_records
set purpose = 'adult_publisher_eligibility',
    status = case when status = 'valid' then 'invalid' else status end,
    failure_reason_code = case
      when status = 'valid' then 'adult_publisher_policy_acceptance_required'
      else failure_reason_code
    end,
    updated_at = now()
where purpose = 'adult_content_access';

alter table verification_sessions
  add column policy_version text,
  add column terms_accepted_at timestamptz,
  add constraint verification_sessions_adult_terms_check check (
    purpose <> 'adult_publisher_eligibility'
    or status <> 'approved'
    or (policy_version is not null and terms_accepted_at is not null)
  ),
  add constraint verification_sessions_purpose_check check (purpose in (
    'age_access',
    'adult_publisher_eligibility',
    'creator_kyc',
    'payout_kyc',
    'org_kyb',
    'ubo_kyc',
    'enterprise_review'
  ));

alter table verification_records
  add column policy_version text,
  add column terms_accepted_at timestamptz,
  add constraint verification_records_valid_adult_terms_check check (
    purpose <> 'adult_publisher_eligibility'
    or status <> 'valid'
    or (policy_version is not null and terms_accepted_at is not null)
  ),
  add constraint verification_records_purpose_check check (purpose in (
    'age_access',
    'adult_publisher_eligibility',
    'creator_kyc',
    'payout_kyc',
    'org_kyb',
    'ubo_kyc',
    'enterprise_review'
  ));

create index verification_records_reusable_identity_idx
  on verification_records (subject_id, verified_at desc)
  where subject_type = 'user'
    and status = 'valid'
    and purpose in ('creator_kyc', 'adult_publisher_eligibility')
    and assurance_level in ('high', 'documentary');

-- The legacy `sensitive` value mixed non-sexual warnings with sexual rating.
-- Hold ambiguous records for review without forcing adult-publisher
-- verification. A later moderation migration owns independent warnings.
update content_items
set nsfw_label = 'none',
    moderation_state = 'pending',
    updated_at = now()
where nsfw_label = 'sensitive';
