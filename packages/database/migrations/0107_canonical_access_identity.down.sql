alter table users
  drop constraint if exists users_legacy_supabase_id_canonical_check;
