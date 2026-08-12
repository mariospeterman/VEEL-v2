-- MCP OAuth completion for production remote connectors.
-- Authorization codes and bearer tokens are stored as hashes only.

create table oauth_clients (
  id uuid primary key,
  client_id text not null unique,
  client_name text not null,
  client_type text not null
    check (client_type in ('claude', 'claude_code', 'cursor', 'openai', 'custom', 'internal')),
  client_mode text not null default 'public'
    check (client_mode in ('public', 'confidential')),
  client_credential_hash text,
  allowed_redirect_uris text[] not null,
  allowed_scopes text[] not null,
  status text not null default 'active'
    check (status in ('active', 'disabled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_used_at timestamptz,
  check (array_length(allowed_redirect_uris, 1) is not null),
  check (array_length(allowed_scopes, 1) is not null),
  check (
    allowed_scopes <@ array[
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

alter table mcp_connections
  add column auth_mode text not null default 'scoped_token'
    check (auth_mode in ('scoped_token', 'oauth')),
  add column oauth_client_id uuid references oauth_clients(id),
  alter column token_hash drop not null,
  alter column token_hint drop not null;

alter table mcp_connections
  add constraint mcp_connections_auth_mode_token_shape_check
  check (
    (auth_mode = 'scoped_token' and token_hash is not null and token_hint is not null and oauth_client_id is null)
    or
    (auth_mode = 'oauth' and token_hash is null and token_hint is null and oauth_client_id is not null)
  );

create table oauth_authorization_requests (
  id uuid primary key,
  oauth_client_id uuid not null references oauth_clients(id),
  redirect_uri text not null,
  code_challenge text not null,
  code_challenge_method text not null check (code_challenge_method = 'S256'),
  state text,
  resource text not null,
  audience text not null,
  role_type text not null check (role_type in ('creator', 'admin')),
  requested_scopes text[] not null,
  approved_scopes text[],
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'denied', 'expired', 'exchanged')),
  expires_at timestamptz not null,
  approved_by_user_id uuid references users(id),
  approved_at timestamptz,
  denied_by_user_id uuid references users(id),
  denied_at timestamptz,
  created_at timestamptz not null default now(),
  check (expires_at > created_at),
  check (array_length(requested_scopes, 1) is not null)
);

create table oauth_authorization_codes (
  id uuid primary key,
  code_hash text not null unique,
  authorization_request_id uuid not null references oauth_authorization_requests(id),
  oauth_client_id uuid not null references oauth_clients(id),
  actor_user_id uuid not null references users(id),
  connection_id uuid not null references mcp_connections(id),
  role_type text not null check (role_type in ('creator', 'admin')),
  redirect_uri text not null,
  code_challenge text not null,
  code_challenge_method text not null check (code_challenge_method = 'S256'),
  resource text not null,
  audience text not null,
  scopes text[] not null,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now(),
  check (expires_at > created_at),
  check (array_length(scopes, 1) is not null)
);

create table oauth_access_tokens (
  id uuid primary key,
  token_hash text not null unique,
  code_id uuid not null references oauth_authorization_codes(id),
  oauth_client_id uuid not null references oauth_clients(id),
  actor_user_id uuid not null references users(id),
  connection_id uuid not null references mcp_connections(id),
  role_type text not null check (role_type in ('creator', 'admin')),
  resource text not null,
  audience text not null,
  scopes text[] not null,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  check (expires_at > created_at),
  check (array_length(scopes, 1) is not null)
);

create index oauth_clients_status_idx
  on oauth_clients (status, created_at desc);

create index oauth_authorization_requests_status_expires_at_idx
  on oauth_authorization_requests (status, expires_at);

create index oauth_authorization_requests_client_created_at_idx
  on oauth_authorization_requests (oauth_client_id, created_at desc);

create index oauth_authorization_codes_client_expires_at_idx
  on oauth_authorization_codes (oauth_client_id, expires_at);

create index oauth_authorization_codes_connection_idx
  on oauth_authorization_codes (connection_id);

create index oauth_access_tokens_connection_idx
  on oauth_access_tokens (connection_id);

create index oauth_access_tokens_actor_created_at_idx
  on oauth_access_tokens (actor_user_id, created_at desc);

create index oauth_access_tokens_client_expires_at_idx
  on oauth_access_tokens (oauth_client_id, expires_at);

create index mcp_connections_oauth_client_idx
  on mcp_connections (oauth_client_id, created_at desc);

alter table oauth_clients enable row level security;
alter table oauth_authorization_requests enable row level security;
alter table oauth_authorization_codes enable row level security;
alter table oauth_access_tokens enable row level security;

grant select on table oauth_clients to authenticated;
grant select on table oauth_authorization_requests to authenticated;
grant select on table oauth_authorization_codes to authenticated;
grant select on table oauth_access_tokens to authenticated;

create policy oauth_clients_select_staff
  on oauth_clients for select to authenticated
  using ((select private.is_staff_member()));

create policy oauth_authorization_requests_select_approver_or_staff
  on oauth_authorization_requests for select to authenticated
  using (approved_by_user_id = (select private.current_app_user_id()) or (select private.is_staff_member()));

create policy oauth_authorization_codes_select_actor_or_staff
  on oauth_authorization_codes for select to authenticated
  using (actor_user_id = (select private.current_app_user_id()) or (select private.is_staff_member()));

create policy oauth_access_tokens_select_actor_or_staff
  on oauth_access_tokens for select to authenticated
  using (actor_user_id = (select private.current_app_user_id()) or (select private.is_staff_member()));
