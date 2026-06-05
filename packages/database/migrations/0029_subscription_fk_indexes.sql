-- Cover subscription foreign keys reported by Supabase performance advisors.

create index subscriptions_plan_id_idx
  on subscriptions (plan_id);

create index subscription_events_authorization_intent_id_idx
  on subscription_events (authorization_intent_id)
  where authorization_intent_id is not null;

create index subscription_events_collection_id_idx
  on subscription_events (collection_id)
  where collection_id is not null;
