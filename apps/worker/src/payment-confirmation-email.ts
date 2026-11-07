import postgres from "postgres";
import {
  formatAtomicAssetAmount,
  isPaymentAssetCurrency,
  type ExactAtomicAmount
} from "@veel/config/asset-amount";

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
      retryable: boolean;
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
  amountMinor: ExactAtomicAmount;
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
  timeoutMs?: number | undefined;
  fetchImpl?: typeof fetch | undefined;
}

export async function processPaymentConfirmationEmails(input: {
  repository: PaymentConfirmationEmailRepository;
  provider: PaymentConfirmationEmailProvider;
  now?: Date;
  limit?: number;
  leaseDurationMs?: number;
  maxAttempts?: number;
  concurrency?: number;
}): Promise<ProcessPaymentConfirmationEmailsResult> {
  const now = input.now ?? new Date();
  const limit = input.limit ?? 50;
  const leaseDurationMs = input.leaseDurationMs ?? 5 * 60 * 1000;
  const maxAttempts = input.maxAttempts ?? 8;
  const concurrency = input.concurrency ?? 4;
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 16) {
    throw new RangeError("Payment confirmation email concurrency must be between 1 and 16");
  }
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

  let nextDeliveryIndex = 0;
  const workerCount = Math.min(concurrency, deliveries.length);
  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (nextDeliveryIndex < deliveries.length) {
        const delivery = deliveries[nextDeliveryIndex++];
        if (!delivery) return;
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
    })
  );

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
  const timeoutMs = options.timeoutMs ?? 10_000;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60_000) {
    throw new RangeError("Resend total timeout must be between 1 and 60000 milliseconds");
  }

  return {
    isConfigured,
    async send(input) {
      if (!isConfigured || !options.apiKey || !options.from) {
        return {
          state: "provider_not_configured",
          failureCode: "transactional_email_provider_not_configured"
        };
      }

      const deadline = Symbol("resend_total_deadline");
      const abortController = new AbortController();
      let timeout: ReturnType<typeof setTimeout> | undefined;
      try {
        const request = (async () => {
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
              subject: `WeVid receipt ${input.receiptNumber}`,
              text: plainTextConfirmation(input, options.webUrl),
              html: htmlConfirmation(input, options.webUrl)
            }),
            signal: abortController.signal
          });
          const body = await response.json().catch(() => ({})) as {
            id?: unknown;
            name?: unknown;
          };
          return { response, body };
        })();
        const timed = new Promise<typeof deadline>((resolve) => {
          timeout = setTimeout(() => {
            abortController.abort();
            resolve(deadline);
          }, timeoutMs);
        });
        const completed = await Promise.race([request, timed]);
        if (completed === deadline) {
          return {
            state: "failed",
            failureCode: "resend_total_deadline_exceeded",
            retryable: true
          };
        }

        if (!completed.response.ok) {
          const failure = classifyResendFailure(completed.response.status, completed.body.name);
          return {
            state: "failed",
            ...failure
          };
        }

        return {
          state: "sent",
          providerMessageId: typeof completed.body.id === "string" ? completed.body.id : null
        };
      } catch {
        return {
          state: "failed",
          failureCode: "resend_transport_error",
          retryable: true
        };
      } finally {
        if (timeout) clearTimeout(timeout);
      }
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
        ? ["queued", "failed", "provider_not_configured"]
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
          where channel = 'email'
            and state in ('queued', 'processing', 'provider_not_configured', 'failed')
            and attempt_count >= ${input.maxAttempts}
            and (state <> 'processing' or leased_until is null or leased_until <= ${input.now})
        `;

        const rows = await transaction<PaymentConfirmationEmailRow[]>`
          with candidate as (
            select
              due.id,
              auth_user.email::text as recipient_email
            from payment_confirmation_deliveries due
            join user_provider_identities identity
              on identity.user_id = due.user_id
             and identity.provider = 'supabase'
             and identity.status = 'active'
            join auth.users auth_user
              on auth_user.id = identity.provider_subject::uuid
            where due.channel = 'email'
              and nullif(btrim(auth_user.email), '') is not null
              and (
                (due.state in ${transaction(states)} and due.next_attempt_at <= ${input.now})
                or (due.state = 'processing' and (due.leased_until is null or due.leased_until <= ${input.now}))
              )
              and due.attempt_count < ${input.maxAttempts}
            order by
              case
                when due.state = 'processing' then coalesce(due.leased_until, '-infinity'::timestamptz)
                else due.next_attempt_at
              end,
              due.created_at,
              due.id
            limit ${input.limit}
            for update of due skip locked
          )
          update payment_confirmation_deliveries delivery
          set
            state = 'processing',
            leased_at = ${input.now},
            lease_token = gen_random_uuid(),
            leased_until = ${new Date(input.now.getTime() + input.leaseDurationMs)},
            attempt_count = delivery.attempt_count + 1,
            failure_code = null,
            updated_at = now()
          from candidate
          where delivery.id = candidate.id
          returning
            delivery.id as delivery_id,
            delivery.lease_token,
            delivery.attempt_count,
            delivery.payment_intent_id,
            delivery.receipt_id,
            delivery.user_id,
            candidate.recipient_email,
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
          amountMinor: row.amount_minor,
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
          state = case
            when ${input.outcome.state === "failed" && !input.outcome.retryable}
              or attempt_count >= ${input.maxAttempts}
              then 'dead_letter'
            else ${input.outcome.state}
          end,
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

export function classifyResendFailure(
  status: number,
  providerName: unknown
): { failureCode: string; retryable: boolean } {
  const name = typeof providerName === "string" ? providerName : null;
  if (name === "concurrent_idempotent_requests" || name === "resource_locked") {
    return { failureCode: `resend_${name}`, retryable: true };
  }
  if (name === "invalid_idempotent_request") {
    return { failureCode: `resend_${name}`, retryable: false };
  }
  return {
    failureCode: `resend_http_${status}`,
    retryable: status === 408 || status === 425 || status === 429 || status >= 500
  };
}

function plainTextConfirmation(input: QueuedPaymentConfirmationEmail, webUrl: string): string {
  const amount = confirmationAmount(input);
  return [
    `Receipt: ${input.receiptNumber}`,
    `Product: ${input.productType}`,
    `Amount: ${amount}`,
    `Terms version: ${input.termsVersion}`,
    `Withdrawal waiver: ${input.withdrawalWaiverVersion}`,
    input.withdrawalWaiverAcceptedAt
      ? `Immediate digital access waiver accepted at: ${input.withdrawalWaiverAcceptedAt}`
      : "Immediate digital access waiver: not recorded",
    `Activity: ${new URL("/app/activity", webUrl).toString()}`,
    "Blockchain finality does not affect mandatory legal refund rights for non-delivery, defects, duplicate payment, fraud, misdescription, or applicable law."
  ].join("\n");
}

function htmlConfirmation(input: QueuedPaymentConfirmationEmail, webUrl: string): string {
  const activityUrl = new URL("/app/activity", webUrl).toString();
  const amount = confirmationAmount(input);

  return `<!doctype html>
<html>
  <body>
    <h1>Payment confirmed</h1>
    <p>Receipt <strong>${escapeHtml(input.receiptNumber)}</strong> is ready.</p>
    <ul>
      <li>Product: ${escapeHtml(input.productType)}</li>
      <li>Amount: ${escapeHtml(amount)}</li>
      <li>Terms: ${escapeHtml(input.termsVersion)}</li>
      <li>Withdrawal waiver: ${escapeHtml(input.withdrawalWaiverVersion)}</li>
      <li>Waiver accepted: ${escapeHtml(input.withdrawalWaiverAcceptedAt ?? "not recorded")}</li>
    </ul>
    <p><a href="${escapeHtml(activityUrl)}">Open payment activity</a></p>
    <p>Blockchain finality does not affect mandatory legal refund rights for non-delivery, defects, duplicate payment, fraud, misdescription, or applicable law.</p>
  </body>
</html>`;
}

function confirmationAmount(input: QueuedPaymentConfirmationEmail): string {
  if (isPaymentAssetCurrency(input.currency)) {
    return formatAtomicAssetAmount(input.amountMinor, input.currency);
  }
  return `${input.amountMinor.toString()} ${input.currency}`;
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
