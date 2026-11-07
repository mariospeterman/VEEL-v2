-- Keep current admin policy, moderation, verification, and MCP projections complete.
-- MCP tool versions are immutable audit facts; raw inputs, outputs, prompts, and tokens remain excluded.

alter table mcp_tool_calls
  add column tool_version text,
  add constraint mcp_tool_calls_tool_version_check check (
    tool_version is null
    or tool_version ~ '^[0-9]+\.[0-9]+\.[0-9]+$'
  );

create index feature_flags_updated_key_idx
  on feature_flags (updated_at desc, key asc);

create index reports_open_state_idx
  on reports (state)
  where state in ('submitted', 'queued', 'reviewing', 'escalated');

comment on column mcp_tool_calls.tool_version is
  'Executing MCP tool-definition version for minimized operations audit; null identifies historical pre-version rows.';
