-- Cover the platform-tier subscription-plan foreign key introduced in 0072.

create index platform_tier_policies_subscription_plan_idx
  on platform_tier_policies (subscription_plan_id);
