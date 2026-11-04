import type postgres from "postgres";
import { hashIdempotencyPayload } from "./idempotency.js";
import type { PostgresTransaction } from "./postgres.js";

export class MutationCommandIdempotencyConflictError extends Error {
  constructor() {
    super("MUTATION_COMMAND_IDEMPOTENCY_CONFLICT");
    this.name = "MutationCommandIdempotencyConflictError";
  }
}

interface MutationCommandReceiptRow {
  target_type: string;
  target_id: string;
  request_version: number;
  request_body_hash: string;
  response_status: number;
  response_body: unknown;
}

export interface MutationCommandReceiptInput {
  actorUserId: string;
  action: string;
  targetType: string;
  targetId: string;
  idempotencyKey: string;
  requestVersion: number;
  requestBody: unknown;
  responseStatus: number;
}

export async function resolveMutationActorBySupabaseUserId(
  transaction: PostgresTransaction,
  supabaseUserId: string
): Promise<string | null> {
  const actors = await transaction<{ id: string }[]>`
    select id
    from users
    where supabase_user_id = ${supabaseUserId}::uuid
    limit 1
  `;
  return actors[0]?.id ?? null;
}

/**
 * Serializes a logical command by actor/action/key and persists its original response.
 * Callers must invoke this inside the same transaction as the protected mutation.
 */
export async function executeWithMutationCommandReceipt<Response>(
  transaction: PostgresTransaction,
  input: MutationCommandReceiptInput,
  execute: () => Promise<Response | null>
): Promise<Response | null> {
  const requestBodyHash = hashIdempotencyPayload(input.requestBody);

  await transaction`
    select pg_advisory_xact_lock(
      hashtextextended(
        ${`mutation-command:${input.actorUserId}:${input.action}:${input.idempotencyKey}`},
        0
      )
    )
  `;

  const receipts = await transaction<MutationCommandReceiptRow[]>`
    select
      target_type,
      target_id,
      request_version,
      request_body_hash,
      response_status,
      response_body
    from mutation_command_receipts
    where actor_user_id = ${input.actorUserId}::uuid
      and action = ${input.action}
      and idempotency_key = ${input.idempotencyKey}
    limit 1
  `;
  const receipt = receipts[0];

  if (receipt) {
    if (
      receipt.target_type !== input.targetType ||
      receipt.target_id !== input.targetId ||
      receipt.request_version !== input.requestVersion ||
      receipt.request_body_hash !== requestBodyHash ||
      receipt.response_status !== input.responseStatus
    ) {
      throw new MutationCommandIdempotencyConflictError();
    }

    return receipt.response_body as Response;
  }

  const response = await execute();
  if (response === null) return null;

  await transaction`
    insert into mutation_command_receipts (
      actor_user_id,
      action,
      target_type,
      target_id,
      idempotency_key,
      request_version,
      request_body_hash,
      response_status,
      response_body
    ) values (
      ${input.actorUserId}::uuid,
      ${input.action},
      ${input.targetType},
      ${input.targetId},
      ${input.idempotencyKey},
      ${input.requestVersion},
      ${requestBodyHash},
      ${input.responseStatus},
      ${transaction.json(JSON.parse(JSON.stringify(response)) as postgres.JSONValue)}::jsonb
    )
  `;

  return response;
}
