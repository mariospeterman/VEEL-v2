import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createContentMediaRepositoryMethods } from "../src/modules/content/content-media-repository.js";
import { createPostgresClient } from "../src/shared/postgres.js";
import { guardedIntegrationDatabaseUrl } from "./integration-database.js";

const enabled = ["1", "true"].includes(
  process.env.VEEL_ENABLE_REAL_API_INTEGRATION_TESTS ?? ""
);
const describeIntegration = enabled ? describe : describe.skip;

describeIntegration("content media durability against migrated Postgres", () => {
  it("serializes same-key video provisioning and repairs interrupted webhook ingestion", async () => {
    const sql = createPostgresClient(guardedIntegrationDatabaseUrl());
    const userId = randomUUID();
    const contentId = randomUUID();
    const idempotencyKey = `video-${randomUUID()}`;
    const requestHash = "a".repeat(64);
    const providerEventId = `bunny-${randomUUID()}`;
    const repository = createContentMediaRepositoryMethods(sql);

    try {
      await sql`
        insert into users (id, supabase_user_id, state)
        values (${userId}, ${userId}, 'active')
      `;
      await sql`
        insert into content_items (
          id, creator_user_id, media_type, state, visibility,
          moderation_state, publish_state
        ) values (
          ${contentId}, ${userId}, 'vod', 'draft', 'private', 'pending', 'draft'
        )
      `;

      const reserve = () => repository.reserveVideoAssetUpload({
        supabaseUserId: userId,
        contentId,
        idempotencyKey,
        requestHash,
        mimeType: "video/mp4",
        quotaWindowStart: new Date(Date.now() - 60_000),
        dailyMediaUploadQuota: 30
      });
      const concurrent = await Promise.all([reserve(), reserve()]);
      expect(concurrent.map((item) => item.state).sort()).toEqual([
        "create_provider_asset",
        "provider_creation_pending"
      ]);
      expect(new Set(concurrent.map((item) => item.mediaAssetId)).size).toBe(1);

      await repository.recordVideoUploadProviderAsset({
        supabaseUserId: userId,
        idempotencyKey,
        requestHash,
        providerAssetId: `video-${randomUUID()}`
      });
      const attached = await repository.completeVideoAssetUpload({
        supabaseUserId: userId,
        idempotencyKey,
        requestHash
      });
      const lostResponseRetry = await reserve();
      expect(lostResponseRetry).toEqual({
        mediaAssetId: attached.mediaAssetId,
        providerAssetId: attached.providerAssetId,
        state: "completed"
      });
      await expect(repository.reserveVideoAssetUpload({
        supabaseUserId: userId,
        contentId,
        idempotencyKey,
        requestHash: "b".repeat(64),
        mimeType: "video/mp4",
        quotaWindowStart: new Date(Date.now() - 60_000),
        dailyMediaUploadQuota: 30
      })).rejects.toMatchObject({
        reason: "idempotency_conflict"
      });

      // Simulate the old failure boundary: receipt committed, provider event absent.
      await sql`
        insert into provider_webhook_receipts (
          id, provider, webhook_type, idempotency_key
        ) values (
          ${randomUUID()}, 'bunny', 'media-status', ${providerEventId}
        )
      `;
      const webhook = {
        provider: "bunny" as const,
        providerEventId,
        eventType: "video.ready",
        normalizedState: "ready",
        replayPayload: {
          kind: "media_asset",
          providerAssetId: attached.providerAssetId
        }
      };
      await expect(repository.recordMediaProviderWebhook(webhook)).resolves.toBe(true);
      await expect(repository.recordMediaProviderWebhook(webhook)).resolves.toBe(true);
      await sql`
        update provider_events
        set processed_at = now()
        where provider = 'bunny' and provider_event_id = ${providerEventId}
      `;
      await expect(repository.recordMediaProviderWebhook(webhook)).resolves.toBe(false);
      const eventCount = await sql<{ count: number }[]>`
        select count(*)::integer as count
        from provider_events
        where provider = 'bunny' and provider_event_id = ${providerEventId}
      `;
      expect(eventCount[0]?.count).toBe(1);
    } finally {
      await sql`delete from provider_events where provider = 'bunny' and provider_event_id = ${providerEventId}`;
      await sql`
        delete from provider_webhook_receipts
        where provider = 'bunny' and webhook_type = 'media-status'
          and idempotency_key = ${providerEventId}
      `;
      await sql`delete from media_upload_operations where content_item_id = ${contentId}`;
      await sql`delete from media_assets where content_item_id = ${contentId}`;
      await sql`delete from content_items where id = ${contentId}`;
      await sql`delete from users where id = ${userId}`;
      await sql.end({ timeout: 5 });
    }
  });
});
