import type { components } from "@veel/contracts";

export type AiSession = components["schemas"]["AiSession"];
export type AiSessionScope = components["schemas"]["AiSessionScope"];
export type AiCapabilities = components["schemas"]["AiCapabilities"];
export type AiToolCall = components["schemas"]["AiToolCall"];
export type AiToolName = components["schemas"]["AiToolName"];
export type CreateAiSessionRequest = components["schemas"]["CreateAiSessionRequest"];
export type CreateAiToolCallRequest = components["schemas"]["CreateAiToolCallRequest"];

export interface CreateAiSessionInput {
  supabaseUserId: string;
  scope: AiSessionScope;
  allowedTools: AiToolName[];
  idempotencyKey: string;
  expiresAt: Date;
}

export interface CreateAiToolCallInput {
  session: AiSession;
  supabaseUserId: string;
  toolName: AiToolName;
  inputSummary: string;
  outputSummary: string;
  inputRedacted: Record<string, unknown>;
  outputRedacted: Record<string, unknown>;
  state: AiToolCall["state"];
  confirmationState: AiToolCall["confirmationState"];
  affectedResource: NonNullable<AiToolCall["affectedResource"]> | null;
  idempotencyKey: string;
}

export interface AiRepository {
  createOrReuseSession(input: CreateAiSessionInput): Promise<AiSession>;
  findSessionForSupabaseUser(input: {
    sessionId: string;
    supabaseUserId: string;
  }): Promise<AiSession | null>;
  createOrReuseToolCall(input: CreateAiToolCallInput): Promise<AiToolCall>;
  close?(): Promise<void>;
}
