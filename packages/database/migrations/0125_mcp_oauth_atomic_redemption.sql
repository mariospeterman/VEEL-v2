do $$
begin
  if exists (
    select 1
    from public.oauth_access_tokens
    group by code_id
    having count(*) > 1
  ) then
    raise exception '0125 cannot add one-token-per-code authority while duplicate OAuth code redemptions exist';
  end if;
end
$$;

alter table public.oauth_access_tokens
  add constraint oauth_access_tokens_code_id_unique unique (code_id);

comment on constraint oauth_access_tokens_code_id_unique on public.oauth_access_tokens is
  'Defense in depth for single-use OAuth authorization-code redemption.';
