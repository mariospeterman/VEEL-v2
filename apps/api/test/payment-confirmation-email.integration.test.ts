import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import {
  createPostgresPaymentConfirmationEmailRepository,
  type PaymentConfirmationEmailRepository
} from "../../worker/src/payment-confirmation-email";
import { createPostgresClient, type PostgresSql } from "../src/shared/postgres";
import {
  assertIntegrationDatabaseIsAllowed,
  integrationDatabaseUrl
} from "./integration-database.js";

const enableRealApiIntegration =
  process.env.VEEL_ENABLE_REAL_API_INTEGRATION_TESTS === "1" ||
  process.env.VEEL_ENABLE_REAL_API_INTEGRATION_TESTS === "true";
const describeIntegration = enableRealApiIntegration ? describe : describe.skip;

interface SeededUser {
  userId: string;
  providerSubject: string | null;
}

describeIntegration("payment confirmation email queue against Postgres", () => {
  let sql: PostgresSql | null = null;
  const repositories: PaymentConfirmationEmailRepository[] = [];
  const users: SeededUser[] = [];

  afterEach(async () => {
    for (const repository of repositories.reverse()) {
      await repository.close?.();
    }
    repositories.length = 0;

    if (!sql) return;
    for (const user of users.reverse()) {
      await cleanupUser(sql, user);
    }
    users.length = 0;
    await sql.end();
    sql = null;
  });

  it("leases an eligible recipient behind fifty earlier wallet-only deliveries", async () => {
    const databaseUrl = guardedDatabaseUrl();
    sql = createPostgresClient(databaseUrl);
    const walletOnlyUser = await seedUser(sql);
    const emailUser = await seedUser(sql, `buyer-${randomUUID()}@example.test`);
    users.push(walletOnlyUser, emailUser);
    await seedWalletOnlyBacklog(sql, walletOnlyUser.userId, 50);
    const eligibleDeliveryId = await seedDelivery(sql, emailUser.userId, {
      createdAt: new Date(),
      state: "queued"
    });

    const repository = createPostgresPaymentConfirmationEmailRepository(databaseUrl);
    repositories.push(repository);
    const leased = await repository.leaseDueConfirmations({
      now: new Date(Date.now() + 60_000),
      limit: 1,
      includeProviderNotConfigured: true,
      leaseDurationMs: 5 * 60_000,
      maxAttempts: 8
    });

    expect(leased).toHaveLength(1);
    expect(leased[0]).toMatchObject({
      deliveryId: eligibleDeliveryId,
      userId: emailUser.userId,
      to: expect.stringMatching(/^buyer-.+@example\.test$/)
    });

    const walletOnlyStates = await sql<{ attempt_count: number; state: string }[]>`
      select attempt_count, state
      from payment_confirmation_deliveries
      where user_id = ${walletOnlyUser.userId}
    `;
    expect(walletOnlyStates).toHaveLength(50);
    expect(walletOnlyStates.every((row) => row.state === "queued" && row.attempt_count === 0)).toBe(
      true
    );
  });

  it("retries due transient failures and fences stale lease outcomes", async () => {
    const databaseUrl = guardedDatabaseUrl();
    sql = createPostgresClient(databaseUrl);
    const user = await seedUser(sql, `buyer-${randomUUID()}@example.test`);
    users.push(user);
    const deliveryId = await seedDelivery(sql, user.userId, { state: "queued" });

    const repository = createPostgresPaymentConfirmationEmailRepository(databaseUrl);
    repositories.push(repository);
    const firstNow = new Date();
    const [firstLease] = await repository.leaseDueConfirmations({
      now: firstNow,
      limit: 1,
      includeProviderNotConfigured: true,
      leaseDurationMs: 60_000,
      maxAttempts: 3
    });
    expect(firstLease?.deliveryId).toBe(deliveryId);

    await repository.recordDeliveryOutcome({
      deliveryId,
      leaseToken: firstLease!.leaseToken,
      now: firstNow,
      maxAttempts: 3,
      outcome: {
        state: "failed",
        failureCode: "resend_transport_error",
        retryable: true
      }
    });

    const [secondLease] = await repository.leaseDueConfirmations({
      now: new Date(firstNow.getTime() + 2 * 60 * 60_000),
      limit: 1,
      includeProviderNotConfigured: true,
      leaseDurationMs: 60_000,
      maxAttempts: 3
    });
    expect(secondLease).toMatchObject({ deliveryId, attemptCount: 2 });
    expect(secondLease?.leaseToken).not.toBe(firstLease?.leaseToken);

    await repository.recordDeliveryOutcome({
      deliveryId,
      leaseToken: firstLease!.leaseToken,
      now: new Date(firstNow.getTime() + 2 * 60 * 60_000),
      maxAttempts: 3,
      outcome: { state: "sent", providerMessageId: "stale-provider-message" }
    });

    const processingRows = await sql<
      Array<{ attempt_count: number; lease_token: string | null; state: string }>
    >`
      select attempt_count, lease_token, state
      from payment_confirmation_deliveries
      where id = ${deliveryId}
    `;
    expect(processingRows[0]).toEqual({
      attempt_count: 2,
      lease_token: secondLease!.leaseToken,
      state: "processing"
    });

    await repository.recordDeliveryOutcome({
      deliveryId,
      leaseToken: secondLease!.leaseToken,
      now: new Date(firstNow.getTime() + 2 * 60 * 60_000),
      maxAttempts: 3,
      outcome: {
        state: "failed",
        failureCode: "resend_http_400",
        retryable: false
      }
    });

    const terminalRows = await sql<
      Array<{ attempt_count: number; failure_code: string | null; state: string }>
    >`
      select attempt_count, failure_code, state
      from payment_confirmation_deliveries
      where id = ${deliveryId}
    `;
    expect(terminalRows[0]).toEqual({
      attempt_count: 2,
      failure_code: "resend_http_400",
      state: "dead_letter"
    });
  });

  it("dead-letters exhausted work before selection", async () => {
    const databaseUrl = guardedDatabaseUrl();
    sql = createPostgresClient(databaseUrl);
    const user = await seedUser(sql, `buyer-${randomUUID()}@example.test`);
    users.push(user);
    const deliveryId = await seedDelivery(sql, user.userId, {
      attemptCount: 3,
      state: "failed"
    });

    const repository = createPostgresPaymentConfirmationEmailRepository(databaseUrl);
    repositories.push(repository);
    await expect(
      repository.leaseDueConfirmations({
        now: new Date(Date.now() + 60_000),
        limit: 10,
        includeProviderNotConfigured: true,
        leaseDurationMs: 60_000,
        maxAttempts: 3
      })
    ).resolves.toEqual([]);

    const rows = await sql<{ failure_code: string | null; state: string }[]>`
      select failure_code, state
      from payment_confirmation_deliveries
      where id = ${deliveryId}
    `;
    expect(rows[0]).toEqual({
      failure_code: "email_attempt_limit_exceeded",
      state: "dead_letter"
    });
  });
});

function guardedDatabaseUrl(): string {
  const databaseUrl = integrationDatabaseUrl();
  assertIntegrationDatabaseIsAllowed(databaseUrl);
  return databaseUrl;
}

async function seedUser(sql: PostgresSql, email?: string): Promise<SeededUser> {
  const userId = randomUUID();
  const providerSubject = email ? randomUUID() : null;
  await sql`insert into users (id, supabase_user_id) values (${userId}, ${userId})`;

  if (providerSubject && email) {
    await sql`
      insert into auth.users (
        id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at
      )
      values (
        ${providerSubject}, 'authenticated', 'authenticated', ${email}, '{}'::jsonb, '{}'::jsonb,
        now(), now()
      )
    `;
    await sql`
      insert into user_provider_identities (
        id, provider, provider_subject, user_id, status, linked_at, last_used_at
      )
      values (
        ${randomUUID()}, 'supabase', ${providerSubject}, ${userId}, 'active', now(), now()
      )
    `;
  }

  return { userId, providerSubject };
}

async function seedWalletOnlyBacklog(
  sql: PostgresSql,
  userId: string,
  count: number
): Promise<void> {
  await sql`
    with intents as (
      insert into payment_intents (
        id, user_id, product_type, target_id, amount_minor, currency, state,
        idempotency_key, request_hash, solana_cluster, treasury_wallet, reference_address,
        expires_at, created_at, quoted_at, settlement_kind, creator_wallet,
        platform_fee_wallet, total_amount_minor, creator_amount_minor,
        creator_side_proceeds_minor, platform_fee_gross_minor,
        platform_fee_amount_minor, referral_amount_minor, enterprise_management_amount_minor
      )
      select
        gen_random_uuid(), ${userId}, 'content_unlock', gen_random_uuid(), 1000000, 'SOL',
        'pending', 'wallet-only-' || n || '-' || gen_random_uuid(), md5(gen_random_uuid()::text),
        'devnet', 'treasury', gen_random_uuid()::text, now() + interval '10 minutes',
        now() - interval '2 hours' + n * interval '1 millisecond', now(), 'platform_owned',
        'creator', 'platform', 1000000, 1000000, 1000000, 0, 0, 0, 0
      from generate_series(1, ${count}) as n
      returning id, created_at
    )
    insert into payment_confirmation_deliveries (
      id, payment_intent_id, user_id, channel, state, terms_version,
      withdrawal_waiver_version, payload, next_attempt_at, created_at
    )
    select
      gen_random_uuid(), id, ${userId}, 'email', 'queued', 'terms-v1', 'waiver-v1',
      jsonb_build_object(
        'receiptNumber', 'WALLET-ONLY-' || id,
        'productType', 'content_unlock',
        'amountMinor', 1000000,
        'currency', 'SOL',
        'withdrawalWaiverAcceptedAt', null
      ),
      created_at, created_at
    from intents
  `;
}

async function seedDelivery(
  sql: PostgresSql,
  userId: string,
  options: {
    attemptCount?: number;
    createdAt?: Date;
    state: "queued" | "failed";
  }
): Promise<string> {
  const paymentIntentId = randomUUID();
  const deliveryId = randomUUID();
  const createdAt = options.createdAt ?? new Date(Date.now() - 60_000);
  await sql`
    insert into payment_intents (
      id, user_id, product_type, target_id, amount_minor, currency, state,
      idempotency_key, request_hash, solana_cluster, treasury_wallet, reference_address,
      expires_at, created_at, quoted_at, settlement_kind, creator_wallet,
      platform_fee_wallet, total_amount_minor, creator_amount_minor,
      creator_side_proceeds_minor, platform_fee_gross_minor,
      platform_fee_amount_minor, referral_amount_minor, enterprise_management_amount_minor
    )
    values (
      ${paymentIntentId}, ${userId}, 'content_unlock', ${randomUUID()}, 1000000, 'SOL',
      'pending', ${`email-${randomUUID()}`}, ${randomUUID()}, 'devnet', 'treasury',
      ${randomUUID()}, now() + interval '10 minutes', ${createdAt}, now(), 'platform_owned',
      'creator', 'platform', 1000000, 1000000, 1000000, 0, 0, 0, 0
    )
  `;
  await sql`
    insert into payment_confirmation_deliveries (
      id, payment_intent_id, user_id, channel, state, terms_version,
      withdrawal_waiver_version, payload, attempt_count, next_attempt_at, created_at
    )
    values (
      ${deliveryId}, ${paymentIntentId}, ${userId}, 'email', ${options.state}, 'terms-v1',
      'waiver-v1',
      ${sql.json({
        receiptNumber: `VEEL-${paymentIntentId}`,
        productType: "content_unlock",
        amountMinor: 1000000,
        currency: "SOL",
        withdrawalWaiverAcceptedAt: null
      })}::jsonb,
      ${options.attemptCount ?? 0}, ${createdAt}, ${createdAt}
    )
  `;
  return deliveryId;
}

async function cleanupUser(sql: PostgresSql, user: SeededUser): Promise<void> {
  await sql`delete from payment_confirmation_deliveries where user_id = ${user.userId}`;
  await sql`delete from payment_intents where user_id = ${user.userId}`;
  await sql`delete from user_provider_identities where user_id = ${user.userId}`;
  await sql`delete from users where id = ${user.userId}`;
  if (user.providerSubject) {
    await sql`delete from auth.sessions where user_id = ${user.providerSubject}`;
    await sql`delete from auth.users where id = ${user.providerSubject}`;
  }
}
