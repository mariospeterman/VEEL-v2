do $$
begin
  if to_regclass('public.mcp_private_draft_origins') is not null
     and exists (select 1 from mcp_private_draft_origins limit 1) then
    raise exception '0114 rollback requires retained MCP private-draft origin records to be migrated before downgrade';
  end if;
end
$$;

drop policy if exists mcp_private_draft_origins_select_self_or_staff
  on mcp_private_draft_origins;
drop table if exists mcp_private_draft_origins;
