drop index if exists referral_commissions_referrer_created_at_idx;
drop index if exists referral_attributions_referred_created_at_idx;
drop index if exists referral_tokens_target_idx;
drop index if exists referral_tokens_creator_created_at_idx;
alter table payment_intents drop column if exists referral_token_id;
drop table if exists referral_commissions;
drop table if exists referral_attributions;
drop table if exists referral_tokens;
