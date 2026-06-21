-- External MCP connector foundation.
-- Fastify owns token issuance and tool execution; only token hashes are stored.

create table mcp_connections (
  id uuid primary key,
  actor_user_id uuid not null references users(id),
  client_name text not null,
  client_type text not null
    check (client_type in ('claude', 'claude_code', 'cursor', 'openai', 'custom', 'internal')),
  role_type text not null
    check (role_type in ('creator', 'admin')),
  state text not null default 'active'
    check (state in ('active', 'revoked', 'expired')),
  token_hash text not null unique,
  token_hint text not null,
  scopes text[] not null,
  idempotency_key text not null,
  expires_at timestamptz not null,
  last_used_at timestamptz,
  revoked_at timestamptz,
  revoked_by_user_id uuid references users(id),
  created_at timestamptz not null default now(),
  check (expires_at > created_at),
  unique (actor_user_id, idempotency_key),
  check (array_length(scopes, 1) is not null),
  check (
    scopes <@ array[
      'creator.profile.read',
      'creator.profile.draft',
      'creator.metrics.read',
      'creator.drafts.read',
      'creator.drafts.write',
      'creator.events.read',
      'creator.events.draft',
      'creator.media.read',
      'creator.media.label',
      'creator.publish.request',
      'admin.health.read',
      'admin.support.read',
      'admin.support.draft',
      'admin.moderation.read',
      'admin.moderation.draft',
      'admin.payments.read',
      'admin.tasks.create'
    ]::text[]
  )
);

create table mcp_tool_calls (
  id uuid primary key,
  connection_id uuid not null references mcp_connections(id),
  actor_user_id uuid not null references users(id),
  tool_name text not null,
  state text not null
    check (state in ('allowed', 'denied', 'failed')),
  risk_level text not null
    check (risk_level in ('read', 'draft', 'request')),
  required_scopes text[] not null,
  input_summary text not null,
  output_summary text not null,
  input_redacted jsonb not null default '{}'::jsonb,
  output_redacted jsonb not null default '{}'::jsonb,
  denied_reason text,
  created_at timestamptz not null default now(),
  check (array_length(required_scopes, 1) is not null)
);

create index mcp_connections_actor_created_at_idx
  on mcp_connections (actor_user_id, created_at desc);

create index mcp_connections_state_expires_at_idx
  on mcp_connections (state, expires_at);

create index mcp_tool_calls_connection_created_at_idx
  on mcp_tool_calls (connection_id, created_at desc);

create index mcp_tool_calls_actor_created_at_idx
  on mcp_tool_calls (actor_user_id, created_at desc);

create index mcp_tool_calls_tool_state_created_at_idx
  on mcp_tool_calls (tool_name, state, created_at desc);

alter table mcp_connections enable row level security;
alter table mcp_tool_calls enable row level security;

grant select on table mcp_connections to authenticated;
grant select on table mcp_tool_calls to authenticated;

create policy mcp_connections_select_self_or_staff
  on mcp_connections for select to authenticated
  using (actor_user_id = (select private.current_app_user_id()) or (select private.is_staff_member()));

create policy mcp_tool_calls_select_self_or_staff
  on mcp_tool_calls for select to authenticated
  using (actor_user_id = (select private.current_app_user_id()) or (select private.is_staff_member()));
