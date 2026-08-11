import postgres from "postgres";

export type PaymentConfirmationEmailOutcome =
  | {
      state: "sent";
      providerMessageId: string | null;
    }
  | {
      state: "provider_not_configured";
      failureCode: string;
    }
  | {
      state: "failed";
      failureCode: string;
    };

export interface QueuedPaymentConfirmationEmail {
  deliveryId: string;
  leaseToken: string;
  attemptCount: number;
  paymentIntentId: string;
  receiptId: string | null;
  userId: string;
  to: string;
  receiptNumber: string;
  productType: string;
  amountMinor: number;
  currency: string;
  termsVersion: string;
  withdrawalWaiverVersion: string;
  withdrawalWaiverAcceptedAt: string | null;
}

export interface PaymentConfirmationEmailRepository {
  leaseDueConfirmations(input: {
    now: Date;
    limit: number;
    includeProviderNotConfigured: boolean;
    leaseDurationMs: number;
    maxAttempts: number;
  }): Promise<QueuedPaymentConfirmationEmail[]>;
  recordDeliveryOutcome(input: {
    deliveryId: string;
    leaseToken: string;
    now: Date;
    maxAttempts: number;
    outcome: PaymentConfirmationEmailOutcome;
  }): Promise<void>;
  close?(): Promise<void>;
}

export interface PaymentConfirmationEmailProvider {
  readonly isConfigured: boolean;
  send(input: QueuedPaymentConfirmationEmail): Promise<PaymentConfirmationEmailOutcome>;
}

export interface ProcessPaymentConfirmationEmailsResult {
  leased: number;
  sent: number;
  providerNotConfigured: number;
  failed: number;
}

export interface ResendPaymentConfirmationEmailProviderOptions {
  apiKey?: string | undefined;
  from?: string | undefined;
  replyTo?: string | undefined;
  webUrl: string;
  fetchImpl?: typeof fetch | undefined;
}

export async function processPaymentConfirmationEmails(input: {
  repository: PaymentConfirmationEmailRepository;
  provider: PaymentConfirmationEmailProvider;
  now?: Date;
  limit?: number;
  leaseDurationMs?: number;
  maxAttempts?: number;
}): Promise<ProcessPaymentConfirmationEmailsResult> {
  const now = input.now ?? new Date();
  const limit = input.limit ?? 50;
  const leaseDurationMs = input.leaseDurationMs ?? 5 * 60 * 1000;
  const maxAttempts = input.maxAttempts ?? 8;
  const deliveries = await input.repository.leaseDueConfirmations({
    now,
    limit,
    includeProviderNotConfigured: input.provider.isConfigured,
    leaseDurationMs,
    maxAttempts
  });
  const result: ProcessPaymentConfirmationEmailsResult = {
    leased: deliveries.length,
    sent: 0,
    providerNotConfigured: 0,
    failed: 0
  };

  for (const delivery of deliveries) {
    const outcome = await input.provider.send(delivery);
    await input.repository.recordDeliveryOutcome({
      deliveryId: delivery.deliveryId,
      leaseToken: delivery.leaseToken,
      now,
      maxAttempts,
      outcome
    });

    if (outcome.state === "sent") result.sent += 1;
    else if (outcome.state === "provider_not_configured") result.providerNotConfigured += 1;
    else result.failed += 1;
  }

  return result;
}

export function createUnconfiguredPaymentConfirmationEmailProvider(): PaymentConfirmationEmailProvider {
  return {
    isConfigured: false,
    async send() {
      return {
        state: "provider_not_configured",
        failureCode: "transactional_email_provider_not_configured"
      };
    }
  };
}

export function createResendPaymentConfirmationEmailProvider(
  options: ResendPaymentConfirmationEmailProviderOptions
): PaymentConfirmationEmailProvider {
  const isConfigured = Boolean(options.apiKey && options.from);
  const fetchImpl = options.fetchImpl ?? fetch;

  return {
    isConfigured,
    async send(input) {
      if (!isConfigured || !options.apiKey || !options.from) {
        return {
          state: "provider_not_configured",
          failureCode: "transactional_email_provider_not_configured"
        };
      }

      const response = await fetchImpl("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          authorization: `Bearer ${options.apiKey}`,
          "content-type": "application/json",
          "idempotency-key": `payment-confirmation:${input.deliveryId}`
        },
        body: JSON.stringify({
          from: options.from,
          to: [input.to],
          ...(options.replyTo ? { reply_to: options.replyTo } : {}),
          subject: `Veel receipt ${input.receiptNumber}`,
          text: plainTextConfirmation(input, options.webUrl),
          html: htmlConfirmation(input, options.webUrl)
        })
      });

      if (!response.ok) {
        return {
          state: "failed",
          failureCode: `resend_http_${response.status}`
        };
      }

      const body = await response.json().catch(() => ({}));
      const id = typeof body?.id === "string" ? body.id : null;
      return {
        state: "sent",
        providerMessageId: id
      };
    }
  };
}

export function createPostgresPaymentConfirmationEmailRepository(
  databaseUrl?: string
): PaymentConfirmationEmailRepository {
  if (!databaseUrl) {
    return {
      async leaseDueConfirmations() {
        return [];
      },
      async recordDeliveryOutcome() {
        return;
      }
    };
  }

  const sql = postgres(databaseUrl, {
    max: 3,
    idle_timeout: 20,
    prepare: false
  });

  return {
    async leaseDueConfirmations(input) {
      const states = input.includeProviderNotConfigured
        ? ["queued", "provider_not_configured"]
        : ["queued"];

      return sql.begin(async (transaction) => {
        await transaction`
          update payment_confirmation_deliveries
          set
            state = 'dead_letter',
            failure_code = coalesce(failure_code, 'email_attempt_limit_exceeded'),
            lease_token = null,
            leased_until = null,
            updated_at = now()
          where state in ('queued', 'processing', 'provider_not_configured', 'failed')
            and attempt_count >= ${input.maxAttempts}
            and (state <> 'processing' or leased_until is null or leased_until <= ${input.now})
        `;

        const rows = await transaction<PaymentConfirmationEmailRow[]>`
          update payment_confirmation_deliveries delivery
          set
            state = 'processing',
            leased_at = ${input.now},
            lease_token = gen_random_uuid(),
            leased_until = ${new Date(input.now.getTime() + input.leaseDurationMs)},
            attempt_count = delivery.attempt_count + 1,
            failure_code = null,
            updated_at = now()
          from (
            select due.id
            from payment_confirmation_deliveries due
            where due.channel = 'email'
              and (
                (due.state in ${transaction(states)} and due.next_attempt_at <= ${input.now})
                or (due.state = 'processing' and (due.leased_until is null or due.leased_until <= ${input.now}))
              )
              and due.attempt_count < ${input.maxAttempts}
            order by due.created_at asc
            limit ${input.limit}
            for update skip locked
          ) due,
          users app_user,
          auth.users auth_user
          where delivery.id = due.id
            and app_user.id = delivery.user_id
            and auth_user.id = app_user.supabase_user_id
            and auth_user.email is not null
          returning
            delivery.id as delivery_id,
            delivery.lease_token,
            delivery.attempt_count,
            delivery.payment_intent_id,
            delivery.receipt_id,
            delivery.user_id,
            auth_user.email as recipient_email,
            delivery.payload->>'receiptNumber' as receipt_number,
            delivery.payload->>'productType' as product_type,
            (delivery.payload->>'amountMinor')::bigint as amount_minor,
            delivery.payload->>'currency' as currency,
            delivery.terms_version,
            delivery.withdrawal_waiver_version,
            delivery.payload->>'withdrawalWaiverAcceptedAt' as withdrawal_waiver_accepted_at
        `;

        return rows.map((row) => ({
          deliveryId: row.delivery_id,
          leaseToken: row.lease_token,
          attemptCount: row.attempt_count,
          paymentIntentId: row.payment_intent_id,
          receiptId: row.receipt_id,
          userId: row.user_id,
          to: row.recipient_email,
          receiptNumber: row.receipt_number,
          productType: row.product_type,
          amountMinor: Number(row.amount_minor),
          currency: row.currency,
          termsVersion: row.terms_version,
          withdrawalWaiverVersion: row.withdrawal_waiver_version,
          withdrawalWaiverAcceptedAt: row.withdrawal_waiver_accepted_at
        }));
      });
    },
    async recordDeliveryOutcome(input) {
      if (input.outcome.state === "sent") {
        await sql`
          update payment_confirmation_deliveries
          set
            state = 'sent',
            delivered_at = now(),
            failure_code = null,
            provider_message_id = ${input.outcome.providerMessageId},
            lease_token = null,
            leased_until = null,
            payload = payload || ${sql.json({
              provider: "resend",
              providerMessageId: input.outcome.providerMessageId
            })}::jsonb,
            updated_at = now()
          where id = ${input.deliveryId}
            and state = 'processing'
            and lease_token = ${input.leaseToken}
        `;
        return;
      }

      await sql`
        update payment_confirmation_deliveries
        set
          state = case when attempt_count >= ${input.maxAttempts} then 'dead_letter' else ${input.outcome.state} end,
          failure_code = ${input.outcome.failureCode},
          next_attempt_at = ${input.now} + make_interval(
            secs => least(3600, 30 * power(2, least(attempt_count, 7)))::integer
              + floor(random() * 30)::integer
          ),
          lease_token = null,
          leased_until = null,
          updated_at = now()
        where id = ${input.deliveryId}
          and state = 'processing'
          and lease_token = ${input.leaseToken}
      `;
    },
    async close() {
      await sql.end();
    }
  };
}

function plainTextConfirmation(input: QueuedPaymentConfirmationEmail, webUrl: string): string {
  return [
    `Receipt: ${input.receiptNumber}`,
    `Product: ${input.productType}`,
    `Amount: ${input.amountMinor} ${input.currency}`,
    `Terms version: ${input.termsVersion}`,
    `Withdrawal waiver: ${input.withdrawalWaiverVersion}`,
    input.withdrawalWaiverAcceptedAt
      ? `Immediate digital access waiver accepted at: ${input.withdrawalWaiverAcceptedAt}`
      : "Immediate digital access waiver: not recorded",
    `Activity: ${new URL("/activity", webUrl).toString()}`,
    "Blockchain finality does not affect mandatory legal refund rights for non-delivery, defects, duplicate payment, fraud, misdescription, or applicable law."
  ].join("\n");
}

function htmlConfirmation(input: QueuedPaymentConfirmationEmail, webUrl: string): string {
  const activityUrl = new URL("/activity", webUrl).toString();

  return `<!doctype html>
<html>
  <body>
    <h1>Payment confirmed</h1>
    <p>Receipt <strong>${escapeHtml(input.receiptNumber)}</strong> is ready.</p>
    <ul>
      <li>Product: ${escapeHtml(input.productType)}</li>
      <li>Amount: ${input.amountMinor} ${escapeHtml(input.currency)}</li>
      <li>Terms: ${escapeHtml(input.termsVersion)}</li>
      <li>Withdrawal waiver: ${escapeHtml(input.withdrawalWaiverVersion)}</li>
      <li>Waiver accepted: ${escapeHtml(input.withdrawalWaiverAcceptedAt ?? "not recorded")}</li>
    </ul>
    <p><a href="${escapeHtml(activityUrl)}">Open payment activity</a></p>
    <p>Blockchain finality does not affect mandatory legal refund rights for non-delivery, defects, duplicate payment, fraud, misdescription, or applicable law.</p>
  </body>
</html>`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

interface PaymentConfirmationEmailRow {
  delivery_id: string;
  lease_token: string;
  attempt_count: number;
  payment_intent_id: string;
  receipt_id: string | null;
  user_id: string;
  recipient_email: string;
  receipt_number: string;
  product_type: string;
  amount_minor: string;
  currency: string;
  terms_version: string;
  withdrawal_waiver_version: string;
  withdrawal_waiver_accepted_at: string | null;
}
