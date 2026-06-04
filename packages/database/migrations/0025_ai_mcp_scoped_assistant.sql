-- AI/MCP scoped assistant foundation.
-- Fastify owns session/tool-call mutations; Supabase RLS protects direct reads.

create table ai_sessions (
  id uuid primary key,
  actor_user_id uuid not null references users(id),
  scope text not null
    check (scope in ('user_self_service', 'creator_helper', 'admin_ops')),
  state text not null default 'active'
    check (state in ('active', 'expired', 'revoked')),
  allowed_tools text[] not null,
  idempotency_key text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  unique (id, actor_user_id, scope),
  unique (actor_user_id, idempotency_key),
  check (expires_at > created_at),
  check (array_length(allowed_tools, 1) is not null),
  check (
    allowed_tools <@ array[
      'explain_app_state',
      'summarize_own_activity',
      'find_own_purchases',
      'draft_caption',
      'suggest_hashtags',
      'prepare_event_copy',
      'summarize_creator_metrics',
      'payment_lookup',
      'provider_health_summary',
      'moderation_queue_summary',
      'draft_support_reply',
      'prepare_refund_decision',
      'prepare_ban_or_restriction'
    ]::text[]
  )
);

create table ai_tool_calls (
  id uuid primary key,
  session_id uuid not null references ai_sessions(id),
  actor_user_id uuid not null references users(id),
  scope text not null
    check (scope in ('user_self_service', 'creator_helper', 'admin_ops')),
  tool_name text not null
    check (
      tool_name in (
        'explain_app_state',
        'summarize_own_activity',
        'find_own_purchases',
        'draft_caption',
        'suggest_hashtags',
        'prepare_event_copy',
        'summarize_creator_metrics',
        'payment_lookup',
        'provider_health_summary',
        'moderation_queue_summary',
        'draft_support_reply',
        'prepare_refund_decision',
        'prepare_ban_or_restriction'
      )
    ),
  state text not null default 'prepared'
    check (state in ('prepared', 'executed', 'blocked', 'failed')),
  confirmation_state text not null default 'not_required'
    check (confirmation_state in ('not_required', 'required', 'confirmed', 'rejected')),
  subject_type text
    check (subject_type is null or subject_type in ('content', 'event', 'payment', 'provider', 'support_case', 'report', 'user', 'none')),
  subject_id text,
  input_summary text not null,
  output_summary text not null,
  input_redacted jsonb not null default '{}'::jsonb,
  output_redacted jsonb not null default '{}'::jsonb,
  idempotency_key text not null,
  created_at timestamptz not null default now(),
  unique (session_id, idempotency_key),
  foreign key (session_id, actor_user_id, scope)
    references ai_sessions (id, actor_user_id, scope)
);

create index ai_sessions_actor_created_at_idx
  on ai_sessions (actor_user_id, created_at desc);

create index ai_sessions_state_expires_at_idx
  on ai_sessions (state, expires_at);

create index ai_tool_calls_session_created_at_idx
  on ai_tool_calls (session_id, created_at desc);

create index ai_tool_calls_actor_created_at_idx
  on ai_tool_calls (actor_user_id, created_at desc);

create index ai_tool_calls_tool_state_created_at_idx
  on ai_tool_calls (tool_name, state, created_at desc);

alter table ai_sessions enable row level security;
alter table ai_tool_calls enable row level security;

grant select on table ai_sessions to authenticated;
grant select on table ai_tool_calls to authenticated;

create policy ai_sessions_select_self_or_staff
  on ai_sessions for select to authenticated
  using (actor_user_id = (select private.current_app_user_id()) or (select private.is_staff_member()));

create policy ai_tool_calls_select_self_or_staff
  on ai_tool_calls for select to authenticated
  using (actor_user_id = (select private.current_app_user_id()) or (select private.is_staff_member()));
