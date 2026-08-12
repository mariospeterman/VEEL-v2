-- Keep age assurance, adult eligibility, KYC, and KYB in one normalized verification domain.
-- Preserve any legacy age decisions written after migration 0069 before retiring application access.
insert into verification_records (
  subject_type,
  subject_id,
  purpose,
  status,
  provider,
  provider_reference,
  method,
  jurisdiction,
  threshold_age,
  result_over_threshold,
  assurance_level,
  verified_at,
  expires_at,
  reusable,
  metadata,
  created_at,
  updated_at
)
select
  'user',
  av.user_id,
  'age_access',
  case
    when av.state = 'verified' and (av.expires_at is null or av.expires_at > now()) then 'valid'
    when av.state = 'verified' then 'expired'
    when av.state = 'pending' then 'pending'
    else 'blocked'
  end,
  case when av.provider in ('sumsub', 'yoti', 'persona', 'veriff') then av.provider else 'internal' end,
  av.provider_reference,
  case
    when av.provider = 'yoti' then 'reusable_age'
    when av.provider = 'persona' then 'doc_scan'
    when av.provider in ('sumsub', 'veriff') then 'gov_id_selfie'
    else 'manual_review'
  end,
  av.jurisdiction,
  18,
  av.state = 'verified',
  case
    when av.provider in ('sumsub', 'veriff') then 'documentary'
    when av.provider = 'yoti' then 'medium'
    else 'low'
  end,
  av.verified_at,
  av.expires_at,
  av.provider = 'yoti',
  jsonb_build_object('source', 'legacy_age_final_backfill', 'rule', av.rule),
  av.created_at,
  now()
from age_verifications av
where not exists (
  select 1
  from verification_records vr
  where vr.subject_type = 'user'
    and vr.subject_id = av.user_id
    and vr.purpose = 'age_access'
    and coalesce(vr.provider_reference, '') = coalesce(av.provider_reference, '')
);

drop policy if exists age_verifications_select_self_or_staff on age_verifications;
revoke all on table age_verifications from anon, authenticated;
comment on table age_verifications is
  'Legacy archive only. verification_records is the sole verification decision authority.';

update viewer_feed_preferences
set nsfw_preference = 'both'
where nsfw_preference = 'recommended';

alter table viewer_feed_preferences
  alter column nsfw_preference set default 'both';

alter table viewer_feed_preferences
  drop constraint viewer_feed_preferences_nsfw_preference_check;

alter table viewer_feed_preferences
  add constraint viewer_feed_preferences_nsfw_preference_check
    check (nsfw_preference in ('both', 'nsfw', 'sfw'));
