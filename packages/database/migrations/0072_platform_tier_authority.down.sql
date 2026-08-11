drop policy if exists platform_usage_windows_select_self_or_staff on platform_usage_windows;
drop policy if exists platform_tier_policies_select_active_or_staff on platform_tier_policies;
drop index if exists subscription_plans_one_active_creator_offer_idx;
drop table if exists platform_usage_windows;
drop table if exists platform_tier_policies;

delete from tier_waivers where tier_key = 'veel_ultra';

alter table tier_waivers
  drop constraint if exists tier_waivers_tier_key_check;

alter table tier_waivers
  add constraint tier_waivers_tier_key_check
    check (tier_key in ('free_verified', 'veel_plus', 'veel_studio', 'enterprise'));

delete from subscription_plans where id = 'platform_ultra_monthly';

update subscription_plans
set
  amount_minor = 15000000,
  amount_atomic = 15000000,
  updated_at = now()
where id = 'platform_plus_monthly';
