import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createPostgresActivityRepository } from "../src/modules/activity/activity-repository.js";
import {
  createPostgresRefundRepository,
  RefundIdempotencyConflictError
} from "../src/modules/refund/refund-repository.js";
import type { CreateRefundDisputeRequestInput } from "../src/modules/refund/types.js";
import { createPostgresClient, type PostgresSql } from "../src/shared/postgres.js";
import { guardedIntegrationDatabaseUrl } from "./integration-database.js";

const enabled = ["1", "true"].includes(process.env.VEEL_ENABLE_REAL_API_INTEGRATION_TESTS ?? "");
const describeIntegration = enabled ? describe : describe.skip;

describeIntegration("activity and refund resilience against migrated Postgres", () => {
  it("walks every activity and refund page across identical timestamps without omission", async () => {
    const sql = createPostgresClient(guardedIntegrationDatabaseUrl());
    const fixture = paginationFixture();

    try {
      await seedPaginationFixture(sql, fixture);
      const activityRepository = createPostgresActivityRepository(sql);
      const refundRepository = createPostgresRefundRepository(sql);

      const combinedPages = await collectPages((cursor) => activityRepository.listActivity({
        supabaseUserId: fixture.supabaseUserId,
        limit: 3,
        ...(cursor ? { cursor } : {})
      }));
      const paymentPages = await collectPages((cursor) => activityRepository.listPaymentActivity({
        supabaseUserId: fixture.supabaseUserId,
        limit: 3,
        ...(cursor ? { cursor } : {})
      }));
      const walletPages = await collectPages((cursor) => activityRepository.listWalletTransactions({
        supabaseUserId: fixture.supabaseUserId,
        limit: 3,
        ...(cursor ? { cursor } : {})
      }));
      const accessPassPages = await collectPages((cursor) => activityRepository.listAccessPasses({
        supabaseUserId: fixture.supabaseUserId,
        limit: 3,
        ...(cursor ? { cursor } : {})
      }));
      const refundPages = await collectPages((cursor) => refundRepository.listRequests({
        supabaseUserId: fixture.supabaseUserId,
        ...(cursor ? { cursor } : {})
      }));

      const expectedCombined = [
        ...fixture.walletIds.sort(descendingId).map((id) => `wallet_transaction:${id}`),
        ...fixture.paymentIds.sort(descendingId).map((id) => `payment_intent:${id}`)
      ];
      expect(combinedPages.map((page) => page.length)).toEqual([3, 3, 3, 3, 2]);
      expect(combinedPages.flat().map((item) => `${item.kind}:${item.id}`)).toEqual(expectedCombined);
      expect(paymentPages.map((page) => page.length)).toEqual([3, 3, 1]);
      expect(paymentPages.flat().map((item) => item.id)).toEqual(
        fixture.paymentIds.sort(descendingId)
      );
      expect(walletPages.map((page) => page.length)).toEqual([3, 3, 1]);
      expect(walletPages.flat().map((item) => item.id)).toEqual(
        fixture.walletIds.sort(descendingId)
      );
      expect(accessPassPages.map((page) => page.length)).toEqual([3, 3, 1]);
      expect(accessPassPages.flat().map((item) => item.id)).toEqual(
        fixture.accessPassIds.sort(descendingId)
      );
      expect(refundPages.map((page) => page.length)).toEqual([20, 20, 1]);
      expect(refundPages.flat().map((item) => item.id)).toEqual(
        fixture.refundIds.sort(descendingId)
      );

      for (const pages of [combinedPages, paymentPages, walletPages, accessPassPages, refundPages]) {
        const ids = pages.flat().map((item) => item.id);
        expect(new Set(ids)).toHaveLength(ids.length);
      }
    } finally {
      await cleanupFixture(sql, fixture);
      await sql.end({ timeout: 5 });
    }
  });

  it("replays simultaneous same-key requests and conflicts changed payloads", async () => {
    const databaseUrl = guardedIntegrationDatabaseUrl();
    const sqlA = createPostgresClient(databaseUrl);
    const sqlB = createPostgresClient(databaseUrl);
    const fixture = concurrencyFixture();

    try {
      await seedBaseFixture(sqlA, fixture);
      const repositoryA = createPostgresRefundRepository(sqlA);
      const repositoryB = createPostgresRefundRepository(sqlB);
      const identical = refundInput(fixture, "same-key", "same-hash", "Identical refund request reason");

      const [first, second] = await Promise.all([
        repositoryA.createRequest(identical),
        repositoryB.createRequest(identical)
      ]);

      expect(first).not.toBeNull();
      expect(second?.id).toBe(first?.id);

      const changedInputs = [
        refundInput(fixture, "changed-key", "changed-hash-a", "Changed refund request reason A"),
        refundInput(fixture, "changed-key", "changed-hash-b", "Changed refund request reason B")
      ] as const;
      const changedResults = await Promise.allSettled([
        repositoryA.createRequest(changedInputs[0]),
        repositoryB.createRequest(changedInputs[1])
      ]);
      const fulfilledIndex = changedResults.findIndex((result) => result.status === "fulfilled");
      const rejectedIndex = changedResults.findIndex((result) => result.status === "rejected");

      expect(fulfilledIndex).toBeGreaterThanOrEqual(0);
      expect(rejectedIndex).toBeGreaterThanOrEqual(0);
      expect(changedResults.filter((result) => result.status === "fulfilled")).toHaveLength(1);
      expect(changedResults.filter((result) => result.status === "rejected")).toHaveLength(1);
      const rejection = changedResults[rejectedIndex];
      expect(rejection?.status).toBe("rejected");
      if (rejection?.status === "rejected") {
        expect(rejection.reason).toBeInstanceOf(RefundIdempotencyConflictError);
      }

      const winner = changedResults[fulfilledIndex];
      if (winner?.status !== "fulfilled" || !winner.value) throw new Error("Expected refund winner");
      const replay = await repositoryB.createRequest(changedInputs[fulfilledIndex]!);
      expect(replay?.id).toBe(winner.value.id);
      await expect(repositoryA.createRequest(changedInputs[rejectedIndex]!))
        .rejects.toBeInstanceOf(RefundIdempotencyConflictError);

      const rows = await sqlA<{ idempotency_key: string; request_count: string; audit_count: string }[]>`
        select
          keys.idempotency_key,
          count(distinct rd.id)::text as request_count,
          count(distinct ae.id)::text as audit_count
        from (values ('same-key'::text), ('changed-key'::text)) keys(idempotency_key)
        left join refunds_and_disputes rd
          on rd.reporter_user_id = ${fixture.userId}::uuid
          and rd.idempotency_key = keys.idempotency_key
        left join audit_events ae
          on ae.actor_user_id = ${fixture.userId}::uuid
          and ae.subject_id = rd.id
          and ae.action = 'refund_dispute_requested'
        group by keys.idempotency_key
        order by keys.idempotency_key
      `;
      expect(rows).toEqual([
        { idempotency_key: "changed-key", request_count: "1", audit_count: "1" },
        { idempotency_key: "same-key", request_count: "1", audit_count: "1" }
      ]);
    } finally {
      await cleanupFixture(sqlA, fixture);
      await Promise.all([sqlA.end({ timeout: 5 }), sqlB.end({ timeout: 5 })]);
    }
  });
});

interface BaseFixture {
  userId: string;
  supabaseUserId: string;
  paymentIds: string[];
}

interface PaginationFixture extends BaseFixture {
  walletIds: string[];
  eventId: string;
  accessPassTypeId: string;
  accessPassIds: string[];
  refundIds: string[];
  createdAt: Date;
}

function paginationFixture(): PaginationFixture {
  return {
    userId: randomUUID(),
    supabaseUserId: randomUUID(),
    paymentIds: Array.from({ length: 7 }, () => randomUUID()),
    walletIds: Array.from({ length: 7 }, () => randomUUID()),
    eventId: randomUUID(),
    accessPassTypeId: randomUUID(),
    accessPassIds: Array.from({ length: 7 }, () => randomUUID()),
    refundIds: Array.from({ length: 41 }, () => randomUUID()),
    createdAt: new Date("2026-10-01T12:00:00.000Z")
  };
}

function concurrencyFixture(): BaseFixture {
  return {
    userId: randomUUID(),
    supabaseUserId: randomUUID(),
    paymentIds: [randomUUID()]
  };
}

async function seedPaginationFixture(sql: PostgresSql, fixture: PaginationFixture): Promise<void> {
  await seedBaseFixture(sql, fixture, fixture.createdAt);
  await sql.begin(async (transaction) => {
    const wallets = fixture.walletIds.map((id, index) => ({
      id,
      user_id: fixture.userId,
      payment_intent_id: fixture.paymentIds[index],
      chain: "solana_devnet",
      direction: "outgoing",
      amount_minor: 1_000_000,
      currency: "SOL",
      state: "submitted",
      source: "payment_intent",
      reference_address: randomUUID(),
      created_at: fixture.createdAt
    }));
    await transaction`
      insert into wallet_transaction_records ${transaction(
        wallets,
        "id",
        "user_id",
        "payment_intent_id",
        "chain",
        "direction",
        "amount_minor",
        "currency",
        "state",
        "source",
        "reference_address",
        "created_at"
      )}
    `;
    await transaction`
      insert into events (
        id, creator_user_id, title, starts_at, location_type,
        idempotency_key, request_hash, created_at
      ) values (
        ${fixture.eventId}::uuid, ${fixture.userId}::uuid, 'Pagination event',
        ${new Date("2026-12-01T12:00:00.000Z")}, 'physical',
        ${`pagination-event-${fixture.eventId}`}, ${randomUUID()}, ${fixture.createdAt}
      )
    `;
    await transaction`
      insert into event_access_pass_types (id, event_id, label, capacity, created_at)
      values (
        ${fixture.accessPassTypeId}::uuid, ${fixture.eventId}::uuid,
        'Pagination pass', 100, ${fixture.createdAt}
      )
    `;
    const accessPasses = fixture.accessPassIds.map((id, index) => ({
      id,
      event_id: fixture.eventId,
      access_pass_type_id: fixture.accessPassTypeId,
      holder_user_id: fixture.userId,
      qr_token: `pagination-token-${fixture.userId}-${index}`,
      qr_token_hash: `pagination-hash-${fixture.userId}-${index}`,
      created_at: fixture.createdAt
    }));
    await transaction`
      insert into event_access_passes ${transaction(
        accessPasses,
        "id",
        "event_id",
        "access_pass_type_id",
        "holder_user_id",
        "qr_token",
        "qr_token_hash",
        "created_at"
      )}
    `;
    const refunds = fixture.refundIds.map((id, index) => ({
      id,
      payment_intent_id: fixture.paymentIds[0],
      reporter_user_id: fixture.userId,
      kind: "refund_request",
      requested_action: "review_only",
      reason: `Pagination refund reason ${index}`,
      idempotency_key: `pagination-refund-${fixture.userId}-${index}`,
      request_hash: `pagination-hash-${index}`,
      created_at: fixture.createdAt
    }));
    await transaction`
      insert into refunds_and_disputes ${transaction(
        refunds,
        "id",
        "payment_intent_id",
        "reporter_user_id",
        "kind",
        "requested_action",
        "reason",
        "idempotency_key",
        "request_hash",
        "created_at"
      )}
    `;
  });
}

async function seedBaseFixture(
  sql: PostgresSql,
  fixture: BaseFixture,
  createdAt = new Date("2026-10-02T12:00:00.000Z")
): Promise<void> {
  await sql`
    insert into users (id, supabase_user_id, state)
    values (${fixture.userId}::uuid, ${fixture.supabaseUserId}::uuid, 'active')
  `;
  const paymentRows = fixture.paymentIds.map((id, index) => ({
    id,
    user_id: fixture.userId,
    product_type: "content_unlock",
    target_id: randomUUID(),
    amount_minor: 1_000_000,
    currency: "SOL",
    state: "pending",
    idempotency_key: `resilience-payment-${fixture.userId}-${index}`,
    request_hash: randomUUID(),
    solana_cluster: "devnet",
    treasury_wallet: "treasury-wallet",
    reference_address: randomUUID(),
    expires_at: new Date(createdAt.getTime() + 10 * 60_000),
    created_at: createdAt,
    quoted_at: createdAt,
    settlement_kind: "platform_owned",
    creator_wallet: "creator-wallet",
    platform_fee_wallet: "platform-wallet",
    total_amount_minor: 1_000_000,
    creator_amount_minor: 1_000_000,
    creator_side_proceeds_minor: 1_000_000,
    platform_fee_gross_minor: 0,
    platform_fee_amount_minor: 0,
    referral_amount_minor: 0,
    enterprise_management_amount_minor: 0
  }));
  await sql`
    insert into payment_intents ${sql(
      paymentRows,
      "id",
      "user_id",
      "product_type",
      "target_id",
      "amount_minor",
      "currency",
      "state",
      "idempotency_key",
      "request_hash",
      "solana_cluster",
      "treasury_wallet",
      "reference_address",
      "expires_at",
      "created_at",
      "quoted_at",
      "settlement_kind",
      "creator_wallet",
      "platform_fee_wallet",
      "total_amount_minor",
      "creator_amount_minor",
      "creator_side_proceeds_minor",
      "platform_fee_gross_minor",
      "platform_fee_amount_minor",
      "referral_amount_minor",
      "enterprise_management_amount_minor"
    )}
  `;
}

function refundInput(
  fixture: BaseFixture,
  idempotencyKey: string,
  requestHash: string,
  reason: string
): CreateRefundDisputeRequestInput {
  return {
    supabaseUserId: fixture.supabaseUserId,
    idempotencyKey,
    requestHash,
    body: {
      paymentIntentId: fixture.paymentIds[0]!,
      kind: "refund_request",
      requestedAction: "review_only",
      reason
    }
  };
}

async function collectPages<Item>(
  load: (cursor?: string) => Promise<{ items: Item[]; nextCursor?: string | null }>
): Promise<Item[][]> {
  const pages: Item[][] = [];
  let cursor: string | undefined;
  do {
    const page = await load(cursor);
    pages.push(page.items);
    cursor = page.nextCursor ?? undefined;
    if (pages.length > 100) throw new Error("Pagination did not terminate");
  } while (cursor);
  return pages;
}

async function cleanupFixture(sql: PostgresSql, fixture: BaseFixture | PaginationFixture): Promise<void> {
  await sql.begin(async (transaction) => {
    await transaction`delete from audit_events where actor_user_id = ${fixture.userId}::uuid`;
    await transaction`delete from refunds_and_disputes where reporter_user_id = ${fixture.userId}::uuid`;
    if ("accessPassIds" in fixture) {
      await transaction`delete from event_access_passes where holder_user_id = ${fixture.userId}::uuid`;
      await transaction`delete from event_access_pass_types where id = ${fixture.accessPassTypeId}::uuid`;
      await transaction`delete from events where id = ${fixture.eventId}::uuid`;
    }
    await transaction`delete from wallet_transaction_records where user_id = ${fixture.userId}::uuid`;
    await transaction`delete from payment_intents where user_id = ${fixture.userId}::uuid`;
    await transaction`delete from users where id = ${fixture.userId}::uuid`;
  });
}

function descendingId(left: string, right: string): number {
  return right.localeCompare(left);
}
