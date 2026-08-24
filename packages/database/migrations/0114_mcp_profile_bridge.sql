-- Convergence 07: auditable private-draft origin for the optional MCP profile bridge.
-- This table stores no prompts, model keys, tokens, provider payloads, or private user content.

create table mcp_private_draft_origins (
  id uuid primary key,
  connection_id uuid not null references mcp_connections(id),
  actor_user_id uuid not null references users(id),
  content_item_id uuid not null references content_items(id) on delete cascade,
  tool_name text not null check (tool_name = 'creator_create_private_draft'),
  tool_version text not null check (tool_version ~ '^[0-9]+\.[0-9]+\.[0-9]+$'),
  request_hash text not null check (request_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default now(),
  unique (content_item_id),
  unique (connection_id, request_hash)
);

create index mcp_private_draft_origins_connection_created_idx
  on mcp_private_draft_origins (connection_id, created_at desc);

create index mcp_private_draft_origins_actor_created_idx
  on mcp_private_draft_origins (actor_user_id, created_at desc);

alter table mcp_private_draft_origins enable row level security;

grant select on table mcp_private_draft_origins to authenticated;

create policy mcp_private_draft_origins_select_self_or_staff
  on mcp_private_draft_origins for select to authenticated
  using (
    actor_user_id = (select private.current_app_user_id())
    or (select private.is_staff_member())
  );

comment on table mcp_private_draft_origins is
  'Minimized origin link for private drafts prepared through a scoped MCP connection. Prompts, model keys, tokens, provider payloads, and private content are forbidden.';
