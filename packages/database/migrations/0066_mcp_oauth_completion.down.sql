drop policy if exists oauth_access_tokens_select_actor_or_staff on oauth_access_tokens;
drop policy if exists oauth_authorization_codes_select_actor_or_staff on oauth_authorization_codes;
drop policy if exists oauth_authorization_requests_select_approver_or_staff on oauth_authorization_requests;
drop policy if exists oauth_clients_select_staff on oauth_clients;

drop table if exists oauth_access_tokens;
drop table if exists oauth_authorization_codes;
drop table if exists oauth_authorization_requests;

alter table mcp_connections
  drop constraint if exists mcp_connections_auth_mode_token_shape_check;

drop index if exists mcp_connections_oauth_client_idx;

alter table mcp_connections
  drop column if exists oauth_client_id,
  drop column if exists auth_mode,
  alter column token_hash set not null,
  alter column token_hint set not null;

drop table if exists oauth_clients;
