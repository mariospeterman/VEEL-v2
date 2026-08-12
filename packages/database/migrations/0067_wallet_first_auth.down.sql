drop policy if exists wallet_auth_sessions_staff_select on wallet_auth_sessions;
drop policy if exists wallet_auth_challenges_staff_select on wallet_auth_challenges;

revoke select on table wallet_auth_sessions from authenticated;
revoke select on table wallet_auth_challenges from authenticated;

alter table wallet_auth_sessions disable row level security;
alter table wallet_auth_challenges disable row level security;

drop index if exists wallet_auth_sessions_expires_at_idx;
drop index if exists wallet_auth_sessions_user_created_idx;
drop table if exists wallet_auth_sessions;

drop index if exists wallet_auth_challenges_expires_at_idx;
drop index if exists wallet_auth_challenges_address_created_idx;
drop index if exists wallet_auth_challenges_nonce_hash_unique;
drop table if exists wallet_auth_challenges;
