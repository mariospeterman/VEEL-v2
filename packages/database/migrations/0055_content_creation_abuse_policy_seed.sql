-- Seed admin-tunable content creation abuse policy defaults.
-- This is a software safety policy only. It cannot create payment truth, access
-- truth, reporting truth, bookkeeping truth, custody, or social priority.

insert into feature_flags (
  key,
  value,
  category,
  policy_boundary,
  state
)
values (
  'safety.content_creation_abuse_policy',
  '{
    "dailyContentDraftQuota": 20,
    "dailyMediaUploadQuota": 30,
    "rollingWindowHours": 24,
    "notes": "Backend-enforced draft/upload quota policy. Does not affect moderation priority, ranking, access, payments, Mutuals, recommendations, or message priority."
  }'::jsonb,
  'safety',
  'software_policy_only_no_payment_access_or_social_priority',
  'active'
)
on conflict (key) do nothing;
