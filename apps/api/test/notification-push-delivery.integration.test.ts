import { createECDH, randomBytes, randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { createPostgresNotificationRepository } from "../src/modules/notification/notification-repository";
import type { NotificationRepository } from "../src/modules/notification/types";
import { createPostgresClient, type PostgresSql } from "../src/shared/postgres";
import {
  createPostgresNotificationDeliveryRepository,
  type NotificationDeliveryRepository
} from "../../worker/src/notification-delivery";
import {
  assertIntegrationDatabaseIsAllowed,
  integrationDatabaseUrl
} from "./integration-database.js";

const enableRealApiIntegration = ["1", "true"].includes(
  process.env.VEEL_ENABLE_REAL_API_INTEGRATION_TESTS ?? ""
);
const describeIntegration = enableRealApiIntegration ? describe : describe.skip;

describeIntegration("notification push ownership against Postgres", () => {
  let sql: PostgresSql | null = null;
  let apiRepository: NotificationRepository | null = null;
  let workerRepository: NotificationDeliveryRepository | null = null;
  const userIds: string[] = [];

  afterEach(async () => {
    try {
      await workerRepository?.close?.();
      await apiRepository?.close?.();
      if (sql && userIds.length > 0) {
        await sql`
          delete from notification_delivery_attempts where user_id in ${sql(userIds)}
        `;
        await sql`delete from notifications where user_id in ${sql(userIds)}`;
        await sql`delete from notification_action_receipts where actor_user_id in ${sql(userIds)}`;
        await sql`delete from notification_preferences where user_id in ${sql(userIds)}`;
        await sql`delete from notification_devices where user_id in ${sql(userIds)}`;
        await sql`delete from users where id in ${sql(userIds)}`;
      }
    } finally {
      await sql?.end({ timeout: 5 });
      sql = null;
      apiRepository = null;
      workerRepository = null;
      userIds.length = 0;
    }
  });

  it("cancels account-A work, fences a delayed 410, and dispatches only account B", async () => {
    const databaseUrl = guardedDatabaseUrl();
    const encryptionKey = randomBytes(32).toString("base64url");
    sql = createPostgresClient(databaseUrl);
    apiRepository = createPostgresNotificationRepository(databaseUrl, { encryptionKey });
    workerRepository = createPostgresNotificationDeliveryRepository({
      databaseUrl,
      encryptionKey
    });
    const userA = await seedUser(sql);
    const userB = await seedUser(sql);
    userIds.push(userA, userB);
    await enablePush(sql, userA);
    await enablePush(sql, userB);

    const endpoint = `https://fcm.googleapis.com/fcm/send/${randomUUID()}`;
    const deviceA = await apiRepository.registerDevice({
      supabaseUserId: userA,
      idempotencyKey: `register-a-${randomUUID()}`,
      body: pushSubscription(endpoint)
    });
    const notificationA = await seedNotification(sql, userA, "Account A private notification");
    expect(await workerRepository.enqueueDueDeliveries({ now: new Date(), limit: 20 })).toBe(1);
    const [leaseA] = await workerRepository.leaseDueDeliveries({
      now: new Date(Date.now() + 1_000),
      limit: 20,
      leaseDurationMs: 60_000,
      maxAttempts: 8
    });
    expect(leaseA).toMatchObject({
      notificationId: notificationA,
      deviceId: deviceA.id,
      userId: userA,
      deviceSubscriptionGeneration: 1
    });

    const deviceB = await apiRepository.registerDevice({
      supabaseUserId: userB,
      idempotencyKey: `register-b-${randomUUID()}`,
      body: pushSubscription(endpoint)
    });
    expect(deviceB.id).toBe(deviceA.id);
    await expect(workerRepository.prepareDeliveryForDispatch(leaseA!)).resolves.toBeNull();

    await workerRepository.recordDeliveryOutcome({
      attemptId: leaseA!.attemptId,
      deviceId: leaseA!.deviceId,
      deviceSubscriptionGeneration: leaseA!.deviceSubscriptionGeneration,
      userId: leaseA!.userId,
      leaseToken: leaseA!.leaseToken,
      maxAttempts: 8,
      outcome: { state: "revoked", failureCode: "push_subscription_gone" }
    });

    const currentDevice = await sql<
      Array<{ state: string; subscription_generation: number; user_id: string }>
    >`
      select
        state,
        subscription_generation::integer as subscription_generation,
        user_id
      from notification_devices
      where id = ${deviceA.id}
    `;
    expect(currentDevice[0]).toEqual({
      state: "active",
      subscription_generation: 2,
      user_id: userB
    });

    const notificationB = await seedNotification(sql, userB, "Account B private notification");
    expect(await workerRepository.enqueueDueDeliveries({ now: new Date(), limit: 20 })).toBe(1);
    const [leaseB] = await workerRepository.leaseDueDeliveries({
      now: new Date(Date.now() + 1_000),
      limit: 20,
      leaseDurationMs: 60_000,
      maxAttempts: 8
    });
    expect(leaseB).toMatchObject({
      notificationId: notificationB,
      deviceId: deviceA.id,
      userId: userB,
      deviceSubscriptionGeneration: 2
    });
    await expect(workerRepository.prepareDeliveryForDispatch(leaseB!)).resolves.toMatchObject({
      notificationId: notificationB,
      userId: userB,
      deviceSubscriptionGeneration: 2,
      endpoint
    });
  });

  it("rechecks push preferences after leasing and before dispatch", async () => {
    const databaseUrl = guardedDatabaseUrl();
    const encryptionKey = randomBytes(32).toString("base64url");
    sql = createPostgresClient(databaseUrl);
    apiRepository = createPostgresNotificationRepository(databaseUrl, { encryptionKey });
    workerRepository = createPostgresNotificationDeliveryRepository({
      databaseUrl,
      encryptionKey
    });
    const userId = await seedUser(sql);
    userIds.push(userId);
    await enablePush(sql, userId);
    await apiRepository.registerDevice({
      supabaseUserId: userId,
      idempotencyKey: `register-${randomUUID()}`,
      body: pushSubscription(`https://updates.push.services.mozilla.com/wpush/v2/${randomUUID()}`)
    });
    await seedNotification(sql, userId, "Preference race");
    await workerRepository.enqueueDueDeliveries({ now: new Date(), limit: 20 });
    const [lease] = await workerRepository.leaseDueDeliveries({
      now: new Date(Date.now() + 1_000),
      limit: 20,
      leaseDurationMs: 60_000,
      maxAttempts: 8
    });
    expect(lease).toBeDefined();

    await sql`
      update notification_preferences
      set push_enabled = false, updated_at = now()
      where user_id = ${userId}
    `;
    await expect(workerRepository.prepareDeliveryForDispatch(lease!)).resolves.toBeNull();
    const rows = await sql<Array<{ failure_code: string | null; state: string }>>`
      select failure_code, state
      from notification_delivery_attempts
      where id = ${lease!.attemptId}
    `;
    expect(rows[0]).toEqual({
      failure_code: "push_preference_disabled",
      state: "skipped"
    });
  });

  it("rotates a shared endpoint concurrently with a revoked outcome without deadlock or stale revocation", async () => {
    const databaseUrl = guardedDatabaseUrl();
    const encryptionKey = randomBytes(32).toString("base64url");
    sql = createPostgresClient(databaseUrl);
    apiRepository = createPostgresNotificationRepository(databaseUrl, { encryptionKey });
    workerRepository = createPostgresNotificationDeliveryRepository({ databaseUrl, encryptionKey });
    const userA = await seedUser(sql);
    const userB = await seedUser(sql);
    userIds.push(userA, userB);
    await enablePush(sql, userA);
    await enablePush(sql, userB);

    const endpoint = `https://fcm.googleapis.com/fcm/send/${randomUUID()}`;
    const firstDevice = await apiRepository.registerDevice({
      supabaseUserId: userA,
      idempotencyKey: `register-concurrent-a-${randomUUID()}`,
      body: pushSubscription(endpoint)
    });
    await seedNotification(sql, userA, "Concurrent endpoint rotation");
    await workerRepository.enqueueDueDeliveries({ now: new Date(), limit: 20 });
    const [lease] = await workerRepository.leaseDueDeliveries({
      now: new Date(Date.now() + 1_000),
      limit: 20,
      leaseDurationMs: 60_000,
      maxAttempts: 8
    });
    expect(lease).toBeDefined();

    const [, rotatedDevice] = await Promise.all([
      workerRepository.recordDeliveryOutcome({
        attemptId: lease!.attemptId,
        deviceId: lease!.deviceId,
        deviceSubscriptionGeneration: lease!.deviceSubscriptionGeneration,
        userId: lease!.userId,
        leaseToken: lease!.leaseToken,
        maxAttempts: 8,
        outcome: { state: "revoked", failureCode: "push_subscription_gone" }
      }),
      apiRepository.registerDevice({
        supabaseUserId: userB,
        idempotencyKey: `register-concurrent-b-${randomUUID()}`,
        body: pushSubscription(endpoint)
      })
    ]);

    expect(rotatedDevice.id).toBe(firstDevice.id);
    const current = await sql<Array<{
      state: string;
      subscription_generation: number;
      user_id: string;
    }>>`
      select state, subscription_generation::integer as subscription_generation, user_id
      from notification_devices
      where id = ${firstDevice.id}
    `;
    expect(current[0]).toEqual({
      state: "active",
      subscription_generation: 2,
      user_id: userB
    });
  });
});

function guardedDatabaseUrl(): string {
  const databaseUrl = integrationDatabaseUrl();
  assertIntegrationDatabaseIsAllowed(databaseUrl);
  return databaseUrl;
}

async function seedUser(sql: PostgresSql): Promise<string> {
  const id = randomUUID();
  await sql`insert into users (id, supabase_user_id, state) values (${id}, ${id}, 'active')`;
  return id;
}

async function enablePush(sql: PostgresSql, userId: string): Promise<void> {
  await sql`
    insert into notification_preferences (user_id, push_enabled)
    values (${userId}, true)
  `;
}

async function seedNotification(
  sql: PostgresSql,
  userId: string,
  title: string
): Promise<string> {
  const id = randomUUID();
  await sql`
    insert into notifications (id, user_id, kind, title, body, action_url, state)
    values (${id}, ${userId}, 'message', ${title}, 'private body', '/app/messages', 'unread')
  `;
  return id;
}

function pushSubscription(endpoint: string) {
  return {
    provider: "web_push" as const,
    platform: "desktop" as const,
    endpoint,
    p256dh: createECDH("prime256v1").generateKeys().toString("base64url"),
    auth: randomBytes(16).toString("base64url"),
    userAgent: "integration-test"
  };
}
