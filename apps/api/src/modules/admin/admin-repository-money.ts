import { randomUUID } from "node:crypto";
import type postgres from "postgres";
import type { AdminRepository } from "./types.js";
import {
  PaymentRow,
  UnlockRow,
  ProviderEventRow,
  AuditEventRow,
  pageSize,
  page,
  toPaymentIntent,
  toUnlock,
  toProviderEvent,
  toAuditEvent
} from "./admin-repository-mappers.js";

export function createMoneyRepository(
  sql: postgres.Sql
): Pick<AdminRepository, "listPaymentIntents" | "listUnlocks" | "listProviderEvents" | "enqueueProviderEventReplay" | "listAuditEvents"> {
  return {
    async listPaymentIntents(input) {
      const rows = await sql<PaymentRow[]>`
        select
          pi.id,
          pi.product_type,
          pi.amount_minor,
          pi.currency,
          pi.state,
          pi.user_id,
          pi.target_id,
          pi.reference_address,
          pi.submitted_signature,
          pi.confirmed_signature,
          pi.created_at,
          pi.confirmed_at,
          count(psa.id) as settlement_attempt_count,
          max(e.id::text) as entitlement_id
        from payment_intents pi
        left join payment_settlement_attempts psa on psa.payment_intent_id = pi.id
        left join entitlements e on e.payment_intent_id = pi.id
        where (${input.cursor ?? null}::timestamptz is null or pi.created_at < ${input.cursor ?? null}::timestamptz)
          and (
            ${input.query ?? null}::text is null
            or pi.reference_address ilike '%' || ${input.query ?? ""} || '%'
            or pi.submitted_signature ilike '%' || ${input.query ?? ""} || '%'
            or pi.confirmed_signature ilike '%' || ${input.query ?? ""} || '%'
          )
        group by pi.id
        order by pi.created_at desc
        limit ${pageSize + 1}
      `;

      return page(rows, toPaymentIntent);
    },
    async listUnlocks(input) {
      const rows = await sql<UnlockRow[]>`
        select id, user_id, target_type, target_id, product_type, payment_intent_id, state, granted_at, ends_at as expires_at
        from entitlements
        where (${input.cursor ?? null}::timestamptz is null or granted_at < ${input.cursor ?? null}::timestamptz)
          and (
            ${input.query ?? null}::text is null
            or target_id::text = ${input.query ?? ""}
            or payment_intent_id::text = ${input.query ?? ""}
          )
        order by granted_at desc
        limit ${pageSize + 1}
      `;

      return page(rows, toUnlock);
    },
    async listProviderEvents(input) {
      const rows = await sql<ProviderEventRow[]>`
        select
          pe.id,
          pe.provider,
          pe.event_type,
          pe.normalized_state,
          pe.received_at,
          pe.processed_at,
          replay.state as latest_replay_state,
          replay.created_at as latest_replay_requested_at,
          replay.processed_at as latest_replay_processed_at
        from provider_events pe
        left join lateral (
          select state, created_at, processed_at
          from provider_event_replay_requests perr
          where perr.provider_event_id = pe.id
          order by perr.created_at desc
          limit 1
        ) replay on true
        where (${input.cursor ?? null}::timestamptz is null or pe.received_at < ${input.cursor ?? null}::timestamptz)
        order by pe.received_at desc
        limit ${pageSize + 1}
      `;

      return page(rows, toProviderEvent);
    },
    async enqueueProviderEventReplay(input) {
      const replayRequestId = randomUUID();
      const auditEventId = randomUUID();
      const reason = input.body.reason.trim();
      const rows = await sql<{ provider_event_exists: boolean }[]>`
        with actor as (
          select id
          from users
          where supabase_user_id = ${input.supabaseUserId}::uuid
        ),
        target as (
          select id
          from provider_events
          where id = ${input.providerEventId}::uuid
        ),
        inserted as (
          insert into provider_event_replay_requests (
            id,
            provider_event_id,
            requested_by_user_id,
            idempotency_key,
            reason,
            state
          )
          select
            ${replayRequestId},
            target.id,
            actor.id,
            ${input.idempotencyKey},
            ${reason},
            'queued'
          from target
          left join actor on true
          on conflict (provider_event_id, idempotency_key) do nothing
          returning id, provider_event_id, requested_by_user_id
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
            ${auditEventId},
            inserted.requested_by_user_id,
            'provider_event',
            inserted.provider_event_id,
            'provider_event.replay_requested',
            jsonb_build_object(
              'replayRequestId', inserted.id,
              'reason', ${reason},
              'boundary', 'worker_replay_enqueue_only'
            )
          from inserted
          returning id
        )
        select exists(select 1 from target) as provider_event_exists
      `;

      return rows[0]?.provider_event_exists ?? false;
    },
    async listAuditEvents(input) {
      const rows = await sql<AuditEventRow[]>`
        select id, subject_type, action, created_at
        from audit_events
        where (${input.cursor ?? null}::timestamptz is null or created_at < ${input.cursor ?? null}::timestamptz)
        order by created_at desc
        limit ${pageSize + 1}
      `;

      return page(rows, toAuditEvent);
    },
  };
}
