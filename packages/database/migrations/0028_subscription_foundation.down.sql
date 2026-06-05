drop policy if exists subscription_events_select_self_creator_or_staff on subscription_events;
drop policy if exists subscription_collections_select_self_creator_or_staff on subscription_collections;
drop policy if exists subscription_authorization_intents_select_self_creator_or_staff on subscription_authorization_intents;
drop policy if exists subscriptions_select_self_creator_or_staff on subscriptions;
drop policy if exists subscription_plans_select_active_or_staff on subscription_plans;

revoke select on table subscription_events from authenticated;
revoke select on table subscription_collections from authenticated;
revoke select on table subscription_authorization_intents from authenticated;
revoke select on table subscriptions from authenticated;
revoke select on table subscription_plans from authenticated;

drop index if exists subscription_events_actor_user_id_idx;
drop index if exists subscription_events_subscription_created_at_idx;
drop index if exists subscription_collections_subscription_idx;
drop index if exists subscription_collections_due_idx;
drop index if exists subscription_authorization_intents_subscription_idx;
drop index if exists subscriptions_next_collection_idx;
drop index if exists subscriptions_creator_state_idx;
drop index if exists subscriptions_subscriber_created_at_idx;
drop index if exists subscription_plans_creator_idx;
drop index if exists subscriptions_one_open_creator_plan_idx;
drop index if exists subscriptions_one_open_platform_plan_idx;

drop table if exists subscription_events;
drop table if exists subscription_collections;
drop table if exists subscription_authorization_intents;
drop table if exists subscriptions;
drop table if exists subscription_plans;
