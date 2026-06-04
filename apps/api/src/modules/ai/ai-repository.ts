import { randomUUID } from "node:crypto";
import postgres from "postgres";
import type {
  AiRepository,
  AiSession,
  AiSessionScope,
  AiToolCall,
  AiToolName
} from "./types.js";

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
type JsonObject = { [key: string]: JsonValue };

export class AiRepositoryConfigurationError extends Error {
  constructor() {
    super("DATABASE_URL_NOT_CONFIGURED");
    this.name = "AiRepositoryConfigurationError";
  }
}

interface AiSessionRow {
  id: string;
  actor_user_id: string;
  scope: AiSessionScope;
  state: AiSession["state"];
  allowed_tools: AiToolName[];
  created_at: Date;
  expires_at: Date;
}

interface AiToolCallRow {
  id: string;
  session_id: string;
  tool_name: AiToolName;
  state: AiToolCall["state"];
  confirmation_state: AiToolCall["confirmationState"];
  subject_type: NonNullable<AiToolCall["affectedResource"]>["type"] | null;
  subject_id: string | null;
  input_summary: string;
  output_summary: string;
  output_redacted: JsonObject;
  created_at: Date;
}

export function createPostgresAiRepository(databaseUrl?: string): AiRepository {
  if (!databaseUrl) {
    return {
      async createOrReuseSession() {
        throw new AiRepositoryConfigurationError();
      },
      async findSessionForSupabaseUser() {
        throw new AiRepositoryConfigurationError();
      },
      async createOrReuseToolCall() {
        throw new AiRepositoryConfigurationError();
      }
    };
  }

  const sql = postgres(databaseUrl, {
    max: 5,
    idle_timeout: 20,
    prepare: false
  });

  return {
    async createOrReuseSession(input) {
      const rows = await sql<AiSessionRow[]>`
        with actor as (
          select id
          from users
          where supabase_user_id = ${input.supabaseUserId}
          limit 1
        ),
        inserted as (
          insert into ai_sessions (
            id,
            actor_user_id,
            scope,
            allowed_tools,
            idempotency_key,
            expires_at
          )
          select
            ${randomUUID()},
            actor.id,
            ${input.scope},
            ${input.allowedTools},
            ${input.idempotencyKey},
            ${input.expiresAt}
          from actor
          on conflict (actor_user_id, idempotency_key) do nothing
          returning id, actor_user_id, scope, state, allowed_tools, created_at, expires_at
        )
        select id, actor_user_id, scope, state, allowed_tools, created_at, expires_at
        from inserted
        union all
        select s.id, s.actor_user_id, s.scope, s.state, s.allowed_tools, s.created_at, s.expires_at
        from ai_sessions s
        join actor on actor.id = s.actor_user_id
        where s.idempotency_key = ${input.idempotencyKey}
        limit 1
      `;

      const row = rows[0];
      if (!row) {
        throw new AiRepositoryConfigurationError();
      }

      return toSession(row);
    },
    async findSessionForSupabaseUser(input) {
      const rows = await sql<AiSessionRow[]>`
        select s.id, s.actor_user_id, s.scope, s.state, s.allowed_tools, s.created_at, s.expires_at
        from ai_sessions s
        join users u on u.id = s.actor_user_id
        where s.id = ${input.sessionId}
          and u.supabase_user_id = ${input.supabaseUserId}
        limit 1
      `;

      return rows[0] ? toSession(rows[0]) : null;
    },
    async createOrReuseToolCall(input) {
      const rows = await sql<AiToolCallRow[]>`
        with actor as (
          select id
          from users
          where supabase_user_id = ${input.supabaseUserId}
          limit 1
        ),
        inserted as (
          insert into ai_tool_calls (
            id,
            session_id,
            actor_user_id,
            scope,
            tool_name,
            state,
            confirmation_state,
            subject_type,
            subject_id,
            input_summary,
            output_summary,
            input_redacted,
            output_redacted,
            idempotency_key
          )
          select
            ${randomUUID()},
            ${input.session.id},
            actor.id,
            ${input.session.scope},
            ${input.toolName},
            ${input.state},
            ${input.confirmationState},
            ${input.affectedResource?.type ?? null},
            ${input.affectedResource?.id ?? null},
            ${input.inputSummary},
            ${input.outputSummary},
            ${sql.json(toJsonObject(input.inputRedacted))},
            ${sql.json(toJsonObject(input.outputRedacted))},
            ${input.idempotencyKey}
          from actor
          on conflict (session_id, idempotency_key) do nothing
          returning
            id,
            session_id,
            tool_name,
            state,
            confirmation_state,
            subject_type,
            subject_id,
            input_summary,
            output_summary,
            output_redacted,
            created_at
        )
        select
          id,
          session_id,
          tool_name,
          state,
          confirmation_state,
          subject_type,
          subject_id,
          input_summary,
          output_summary,
          output_redacted,
          created_at
        from inserted
        union all
        select
          tc.id,
          tc.session_id,
          tc.tool_name,
          tc.state,
          tc.confirmation_state,
          tc.subject_type,
          tc.subject_id,
          tc.input_summary,
          tc.output_summary,
          tc.output_redacted,
          tc.created_at
        from ai_tool_calls tc
        where tc.session_id = ${input.session.id}
          and tc.idempotency_key = ${input.idempotencyKey}
        limit 1
      `;

      const row = rows[0];
      if (!row) {
        throw new AiRepositoryConfigurationError();
      }

      return toToolCall(row);
    },
    async close() {
      await sql.end({ timeout: 5 });
    }
  };
}

function toSession(row: AiSessionRow): AiSession {
  return {
    id: row.id,
    scope: row.scope,
    state: row.state,
    allowedTools: row.allowed_tools,
    createdAt: row.created_at.toISOString(),
    expiresAt: row.expires_at.toISOString()
  };
}

function toToolCall(row: AiToolCallRow): AiToolCall {
  return {
    id: row.id,
    sessionId: row.session_id,
    toolName: row.tool_name,
    state: row.state,
    confirmationState: row.confirmation_state,
    inputSummary: row.input_summary,
    outputSummary: row.output_summary,
    result: row.output_redacted,
    affectedResource: row.subject_type
      ? {
          type: row.subject_type,
          id: row.subject_id
        }
      : null,
    createdAt: row.created_at.toISOString()
  };
}

function toJsonObject(value: Record<string, unknown>): JsonObject {
  return JSON.parse(JSON.stringify(value)) as JsonObject;
}
