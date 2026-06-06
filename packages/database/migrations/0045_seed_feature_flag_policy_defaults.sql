-- Seed safe feature-flag defaults for policy-gated launch surfaces.
-- Flags are software policy controls only and cannot create payment truth,
-- access truth, reporting truth, bookkeeping truth, custody, or social priority.

insert into feature_flags (
  key,
  value,
  category,
  policy_boundary,
  state
)
values (
  'compliance.carf_exports',
  '{"enabled": false, "reason": "Counsel/tax review required before CARF reporting exports"}'::jsonb,
  'compliance',
  'software_policy_only_no_payment_access_or_social_priority',
  'paused'
)
on conflict (key) do nothing;
