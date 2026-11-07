alter table public.oauth_access_tokens
  drop constraint if exists oauth_access_tokens_code_id_unique;
