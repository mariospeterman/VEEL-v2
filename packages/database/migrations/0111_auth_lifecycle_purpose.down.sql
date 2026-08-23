drop index if exists wallet_auth_challenges_purpose_address_created_idx;

alter table wallet_auth_challenges
  drop constraint if exists wallet_auth_challenges_purpose_check,
  drop column if exists purpose;
