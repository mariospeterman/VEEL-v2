do $$
begin
  if exists (
    select 1 from mcp_tool_calls where tool_version is not null
  ) then
    raise exception
      '0127 rollback refused because persisted MCP tool-version audit facts would be erased';
  end if;
end
$$;

drop index if exists reports_open_state_idx;
drop index if exists feature_flags_updated_key_idx;

alter table mcp_tool_calls
  drop constraint if exists mcp_tool_calls_tool_version_check,
  drop column if exists tool_version;
