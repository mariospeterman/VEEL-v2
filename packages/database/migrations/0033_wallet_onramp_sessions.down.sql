drop policy if exists wallet_onramp_sessions_select_self_or_staff on wallet_onramp_sessions;
drop index if exists wallet_onramp_sessions_wallet_created_idx;
drop index if exists wallet_onramp_sessions_user_created_idx;
drop table if exists wallet_onramp_sessions;
drop type if exists wallet_onramp_session_state;
