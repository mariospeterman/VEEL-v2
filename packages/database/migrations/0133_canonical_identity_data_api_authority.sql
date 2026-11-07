-- Canonical identity links, opaque application sessions, and recovery intents
-- are Fastify-owned records. Any active staff membership previously satisfied
-- their broad RLS policies, bypassing permission-scoped API authorization.

revoke all privileges on table
  user_provider_identities,
  app_sessions,
  recovery_link_intents
from public, anon, authenticated;

drop policy if exists user_provider_identities_staff_select on user_provider_identities;
drop policy if exists app_sessions_staff_select on app_sessions;
drop policy if exists recovery_link_intents_staff_select on recovery_link_intents;

-- This trigger-only SECURITY DEFINER routine accepts caller-controlled topics
-- and payload identifiers. It must not be directly callable by browser roles.
revoke execute on function private.emit_realtime_invalidation(text, text, text, uuid)
  from public, anon, authenticated;

-- Preserve the reviewed RLS and Realtime entry points.
grant execute on function private.current_app_user_id() to authenticated;
grant execute on function private.is_staff_member() to authenticated;
grant execute on function private.has_protected_app_access() to authenticated;
grant execute on function private.is_current_conversation_member(uuid) to authenticated;
grant execute on function private.realtime_topic_can_receive(text, text) to authenticated;
grant execute on function private.realtime_topic_can_send(text, text) to authenticated;

-- Keep future objects in the same two affected classes private by default for
-- the migration role. PostgreSQL's built-in function EXECUTE default is global,
-- so a schema-scoped default revoke cannot override it. Later exposure requires
-- an explicit reviewed grant.
alter default privileges in schema public
  revoke all privileges on tables from public, anon, authenticated;
alter default privileges
  revoke execute on functions from public, anon, authenticated;
