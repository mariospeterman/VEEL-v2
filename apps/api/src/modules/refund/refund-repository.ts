import { randomUUID } from "node:crypto";
import { resolvePostgresClient, type PostgresSql } from "../../shared/postgres.js";
import type { RefundDisputeRequest, RefundRepository } from "./types.js";

export class RefundRepositoryConfigurationError extends Error {
  constructor() {
    super("DATABASE_URL_NOT_CONFIGURED");
    this.name = "RefundRepositoryConfigurationError";
  }
}

export class RefundIdempotencyConflictError extends Error {
  constructor() {
    super("REFUND_IDEMPOTENCY_CONFLICT");
    this.name = "RefundIdempotencyConflictError";
  }
}

interface RefundDisputeRow {
  id: string;
  payment_intent_id: string;
  entitlement_id: string | null;
  reporter_user_id: string;
  kind: RefundDisputeRequest["kind"];
  requested_action: RefundDisputeRequest["requestedAction"];
  state: RefundDisputeRequest["state"];
  resolution: string | null;
  custody_boundary: RefundDisputeRequest["custodyBoundary"];
  request_hash?: string;
  created_at: Date;
  updated_at: Date | null;
  resolved_at: Date | null;
}

const pageSize = 20;

export function createPostgresRefundRepository(database?: string | PostgresSql): RefundRepository {
  if (!database) {
    return {
      async listRequests() {
        throw new RefundRepositoryConfigurationError();
      },
      async createRequest() {
        throw new RefundRepositoryConfigurationError();
      }
    };
  }

  const { sql, ownsClient } = resolvePostgresClient(database);

  return {
    async listRequests(input) {
      const rows = await sql<RefundDisputeRow[]>`
        with target_user as (
          select id
          from users
          where supabase_user_id = ${input.supabaseUserId}
          limit 1
        )
        select
          rd.id,
          rd.payment_intent_id,
          rd.entitlement_id,
          rd.reporter_user_id,
          rd.kind,
          rd.requested_action,
          rd.state,
          rd.resolution,
          rd.custody_boundary,
          rd.created_at,
          rd.updated_at,
          rd.resolved_at
        from refunds_and_disputes rd
        join target_user tu on tu.id = rd.reporter_user_id
        where (${input.cursor ?? null}::timestamptz is null or rd.created_at < ${input.cursor ?? null}::timestamptz)
        order by rd.created_at desc
        limit ${pageSize + 1}
      `;

      const visibleRows = rows.slice(0, pageSize);
      const extraRow = rows[pageSize];

      return {
        items: visibleRows.map(toRefundDisputeRequest),
        nextCursor: extraRow ? extraRow.created_at.toISOString() : null
      };
    },
    async createRequest(input) {
      const rows = await sql.begin(async (transaction) => {
        const insertedRows = await transaction<RefundDisputeRow[]>`
          with target_user as (
            select id
            from users
            where supabase_user_id = ${input.supabaseUserId}
            limit 1
          ),
          existing_request as (
            select
              rd.id,
              rd.payment_intent_id,
              rd.entitlement_id,
              rd.reporter_user_id,
              rd.kind,
              rd.requested_action,
              rd.state,
              rd.resolution,
              rd.custody_boundary,
              rd.request_hash,
              rd.created_at,
              rd.updated_at,
              rd.resolved_at
            from refunds_and_disputes rd
            join target_user tu on tu.id = rd.reporter_user_id
            where rd.idempotency_key = ${input.idempotencyKey}::text
            limit 1
          ),
          owned_payment_intent as (
            select pi.id, pi.user_id, e.id as entitlement_id
            from payment_intents pi
            join target_user tu on tu.id = pi.user_id
            left join entitlements e on e.payment_intent_id = pi.id
            where pi.id = ${input.body.paymentIntentId}::uuid
              and not exists (select 1 from existing_request)
            limit 1
          ),
          inserted_request as (
            insert into refunds_and_disputes (
              id,
              payment_intent_id,
              entitlement_id,
              reporter_user_id,
              kind,
              requested_action,
              reason,
              idempotency_key,
              request_hash
            )
            select
              ${randomUUID()},
              owned_payment_intent.id,
              owned_payment_intent.entitlement_id,
              owned_payment_intent.user_id,
              ${input.body.kind}::text,
              ${input.body.requestedAction}::text,
              ${input.body.reason}::text,
              ${input.idempotencyKey}::text,
              ${input.requestHash}::text
            from owned_payment_intent
            returning
              id,
              payment_intent_id,
              entitlement_id,
              reporter_user_id,
              kind,
              requested_action,
              state,
              resolution,
              custody_boundary,
              request_hash,
              created_at,
              updated_at,
              resolved_at
          ),
          audit_insert as (
            insert into audit_events (
              id,
              actor_user_id,
              subject_type,
              subject_id,
              action,
              metadata
            )
            select
              gen_random_uuid(),
              target_user.id,
              'refund_dispute',
              inserted_request.id,
              'refund_dispute_requested',
              jsonb_build_object(
                'idempotencyKey', ${input.idempotencyKey}::text,
                'paymentIntentId', inserted_request.payment_intent_id,
                'entitlementId', inserted_request.entitlement_id,
                'kind', inserted_request.kind,
                'requestedAction', inserted_request.requested_action,
                'custodyBoundary', inserted_request.custody_boundary
              )
            from inserted_request
            cross join target_user
            returning id
          )
          select
            id,
            payment_intent_id,
            entitlement_id,
            reporter_user_id,
            kind,
            requested_action,
            state,
            resolution,
            custody_boundary,
            request_hash,
            created_at,
            updated_at,
            resolved_at
          from inserted_request
          where exists (select 1 from audit_insert)
          union all
          select
            id,
            payment_intent_id,
            entitlement_id,
            reporter_user_id,
            kind,
            requested_action,
            state,
            resolution,
            custody_boundary,
            request_hash,
            created_at,
            updated_at,
            resolved_at
          from existing_request
          limit 1
        `;

        return insertedRows;
      });

      if (rows[0]?.request_hash && rows[0].request_hash !== input.requestHash) {
        throw new RefundIdempotencyConflictError();
      }

      return rows[0] ? toRefundDisputeRequest(rows[0]) : null;
    },
    async close() {
      if (ownsClient) {
        await sql.end({ timeout: 5 });
      }
    }
  };
}

export function toRefundDisputeRequest(row: RefundDisputeRow): RefundDisputeRequest {
  return {
    id: row.id,
    paymentIntentId: row.payment_intent_id,
    entitlementId: row.entitlement_id,
    reporterUserId: row.reporter_user_id,
    kind: row.kind,
    requestedAction: row.requested_action,
    state: row.state,
    resolution: row.resolution,
    custodyBoundary: row.custody_boundary,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at?.toISOString() ?? null,
    resolvedAt: row.resolved_at?.toISOString() ?? null
  };
}
