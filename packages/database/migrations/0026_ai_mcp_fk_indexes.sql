-- Cover AI/MCP composite foreign keys flagged by Supabase performance advisor.

create index ai_tool_calls_session_actor_scope_idx
  on ai_tool_calls (session_id, actor_user_id, scope);
