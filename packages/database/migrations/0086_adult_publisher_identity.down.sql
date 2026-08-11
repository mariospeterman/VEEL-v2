drop index if exists verification_records_reusable_identity_idx;

alter table verification_records
  drop constraint if exists verification_records_valid_adult_terms_check,
  drop constraint verification_records_purpose_check;

alter table verification_sessions
  drop constraint if exists verification_sessions_adult_terms_check,
  drop constraint verification_sessions_purpose_check;

update verification_sessions
set purpose = 'adult_content_access',
    updated_at = now()
where purpose = 'adult_publisher_eligibility';

update verification_records
set purpose = 'adult_content_access',
    updated_at = now()
where purpose = 'adult_publisher_eligibility';

alter table verification_sessions
  drop column terms_accepted_at,
  drop column policy_version,
  add constraint verification_sessions_purpose_check check (purpose in (
    'age_access',
    'adult_content_access',
    'creator_kyc',
    'payout_kyc',
    'org_kyb',
    'ubo_kyc',
    'enterprise_review'
  ));

alter table verification_records
  drop column terms_accepted_at,
  drop column policy_version,
  add constraint verification_records_purpose_check check (purpose in (
    'age_access',
    'adult_content_access',
    'creator_kyc',
    'payout_kyc',
    'org_kyb',
    'ubo_kyc',
    'enterprise_review'
  ));
