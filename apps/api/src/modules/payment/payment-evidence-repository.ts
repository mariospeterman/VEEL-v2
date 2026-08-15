import { randomUUID } from "node:crypto";
import { resolvePostgresClient, type PostgresSql } from "../../shared/postgres.js";
import type { PaymentEvidenceRepository } from "./types.js";
import { PaymentRepositoryConfigurationError } from "./payment-repository-errors.js";
import { PaymentIntentRow, toStoredPaymentIntent } from "./payment-intent-mapper.js";

export function createPostgresPaymentEvidenceRepository(
  database?: string | PostgresSql
): PaymentEvidenceRepository {
  if (!database) {
    return {
      async recordSolanaProviderEvent() {
        throw new PaymentRepositoryConfigurationError();
      },
      async findIntentByReference() {
        throw new PaymentRepositoryConfigurationError();
      },
      async updateSolanaProviderEvent() {
        throw new PaymentRepositoryConfigurationError();
      }
    };
  }

  const { sql, ownsClient } = resolvePostgresClient(database);

  return {
    async recordSolanaProviderEvent(input) {
      const receiptKey = input.providerEventId;
      const insertedReceipts = await sql<{ id: string }[]>`
        insert into provider_webhook_receipts (
          id,
          provider,
          webhook_type,
          signature_hash,
          idempotency_key
        )
        values (
          ${randomUUID()},
          'helius',
          'solana-indexer',
          ${input.authorizationHash},
          ${receiptKey}
        )
        on conflict (provider, webhook_type, idempotency_key) do nothing
        returning id
      `;

      if (insertedReceipts.length === 0) {
        return false;
      }

      await sql`
        insert into provider_events (
          id,
          provider,
          provider_event_id,
          event_type,
          normalized_state,
          replay_payload
        )
        values (
          ${randomUUID()},
          'helius',
          ${input.providerEventId},
          ${input.eventType},
          'pending',
          ${sql.json({
            kind: "solana_payment",
            signature: input.signature,
            referenceAddresses: input.referenceAddresses
          })}
        )
        on conflict (provider, provider_event_id) do nothing
      `;

      return true;
    },

    async findIntentByReference(input) {
      if (input.referenceAddresses.length === 0) {
        return null;
      }

      const rows = await sql<(PaymentIntentRow & { supabase_user_id: string })[]>`
        select
          pi.*,
          u.supabase_user_id::text as supabase_user_id
        from payment_intents pi
        join users u on u.id = pi.user_id
        where pi.reference_address in ${sql(input.referenceAddresses)}
          and pi.state in ('pending', 'transaction_requested', 'submitted')
          and (not pi.withdrawal_waiver_required or pi.withdrawal_waiver_accepted_at is not null)
        order by pi.created_at asc
        limit 1
      `;
      const row = rows[0];

      return row
        ? {
            supabaseUserId: row.supabase_user_id,
            intent: toStoredPaymentIntent(row)
          }
        : null;
    },

    async updateSolanaProviderEvent(input) {
      await sql`
        update provider_events
        set
          normalized_state = ${input.normalizedState},
          processed_at = now()
        where provider = 'helius'
          and provider_event_id = ${input.providerEventId}
      `;

      await sql`
        update provider_webhook_receipts
        set
          state = ${input.normalizedState},
          processed_at = now()
        where provider = 'helius'
          and webhook_type = 'solana-indexer'
          and idempotency_key = ${input.providerEventId}
      `;
    },

    async close() {
      if (ownsClient) {
        await sql.end({ timeout: 5 });
      }
    }
  };
}
