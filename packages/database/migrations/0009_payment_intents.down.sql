drop index if exists payment_settlement_attempts_intent_checked_at_idx;
drop index if exists payment_intents_state_expires_at_idx;
drop index if exists payment_intents_user_created_at_idx;
drop table if exists payment_settlement_attempts;
drop table if exists payment_intents;
