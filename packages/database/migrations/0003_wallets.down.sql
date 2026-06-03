drop index if exists wallets_user_primary_idx;
drop index if exists wallets_user_id_idx;
drop index if exists wallets_one_primary_per_user_idx;
drop index if exists wallets_provider_reference_unique;
drop table if exists wallets;
drop type if exists wallet_provider;
drop type if exists wallet_chain;
