drop policy if exists ai_tool_calls_select_self_or_staff on ai_tool_calls;
drop policy if exists ai_sessions_select_self_or_staff on ai_sessions;

revoke select on table ai_tool_calls from authenticated;
revoke select on table ai_sessions from authenticated;

drop index if exists ai_tool_calls_tool_state_created_at_idx;
drop index if exists ai_tool_calls_actor_created_at_idx;
drop index if exists ai_tool_calls_session_created_at_idx;
drop index if exists ai_sessions_state_expires_at_idx;
drop index if exists ai_sessions_actor_created_at_idx;

drop table if exists ai_tool_calls;
drop table if exists ai_sessions;
