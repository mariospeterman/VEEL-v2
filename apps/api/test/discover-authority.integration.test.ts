import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { InvalidDiscoverCursorError } from "../src/modules/discover/discover-cursor.js";
import { createPostgresDiscoverRepository } from "../src/modules/discover/discover-repository.js";
import { createPostgresClient, type PostgresSql } from "../src/shared/postgres.js";
import { guardedIntegrationDatabaseUrl } from "./integration-database.js";

const enabled = ["1", "true"].includes(
  process.env.VEEL_ENABLE_REAL_API_INTEGRATION_TESTS ?? ""
);
const describeIntegration = enabled ? describe : describe.skip;

describeIntegration("discover authority against migrated Postgres", () => {
  it("paginates mixed search with independent typed cursors and canonical eligibility", async () => {
    const sql = createPostgresClient(guardedIntegrationDatabaseUrl());
    const repository = createPostgresDiscoverRepository(sql);
    const creatorId = randomUUID();
    const viewerId = randomUUID();
    const publicContentIds = Array.from({ length: 13 }, () => randomUUID());
    const lockedContentId = publicContentIds[0];
    if (!lockedContentId) throw new Error("Expected a locked content fixture id");
    const subscriberContentId = randomUUID();
    const rejectedContentId = randomUUID();
    const quarantinedContentId = randomUUID();
    const hashtagId = randomUUID();
    const eventId = randomUUID();
    const approvedLiveId = randomUUID();
    const rejectedLiveId = randomUUID();
    const quarantinedLiveId = randomUUID();
    const firstWaitingLiveId = randomUUID();
    const secondWaitingLiveId = randomUUID();
    const fixedCreatedAt = new Date("2026-11-04T12:00:00.000Z");
    const suffix = creatorId.replaceAll("-", "").slice(0, 12);
    const handle = `mixed_${suffix}`;
    const hashtagSlug = `mixed_${suffix}`;

    try {
      await sql`
        insert into users (id, supabase_user_id, state)
        values
          (${creatorId}, ${creatorId}, 'active'),
          (${viewerId}, ${viewerId}, 'active')
      `;
      await sql`
        insert into profiles (user_id, handle, display_name, visibility)
        values
          (${creatorId}, ${handle}, 'Mixed creator', 'public'),
          (${viewerId}, ${`viewer_${suffix}`}, 'Mixed viewer', 'public')
      `;
      await sql`
        insert into verification_records (
          subject_type, subject_id, purpose, status, provider, provider_reference,
          method, threshold_age, result_over_threshold, assurance_level, verified_at, reusable
        ) values
          ('user', ${creatorId}, 'age_access', 'valid', 'internal',
            ${`discover-creator-age-${suffix}`}, 'reusable_age', 18, true, 'high', now(), false),
          ('user', ${viewerId}, 'age_access', 'valid', 'internal',
            ${`discover-viewer-age-${suffix}`}, 'reusable_age', 18, true, 'high', now(), false)
      `;

      for (const [index, contentId] of publicContentIds.entries()) {
        await insertTextContent(sql, {
          id: contentId,
          creatorId,
          caption: `mixed result ${index}`,
          visibility: "public",
          createdAt: fixedCreatedAt
        });
      }
      await insertTextContent(sql, {
        id: subscriberContentId,
        creatorId,
        caption: "mixed subscriber only",
        visibility: "subscribers",
        createdAt: fixedCreatedAt
      });
      await insertTextContent(sql, {
        id: rejectedContentId,
        creatorId,
        caption: "mixed rejected",
        visibility: "public",
        createdAt: fixedCreatedAt,
        releaseState: "rejected"
      });
      await insertTextContent(sql, {
        id: quarantinedContentId,
        creatorId,
        caption: "mixed quarantined",
        visibility: "public",
        createdAt: fixedCreatedAt,
        releaseState: "quarantined"
      });
      await sql`
        insert into content_access_rules (
          id, content_item_id, access_type, product_type, price_minor, currency, state
        ) values (
          ${randomUUID()}, ${lockedContentId}, 'locked', 'content_unlock', 25000000, 'SOL', 'active'
        )
      `;
      await sql`
        insert into hashtags (id, slug, display_name, state)
        values (${hashtagId}, ${hashtagSlug}, ${`#${hashtagSlug}`}, 'active')
      `;
      await sql`
        insert into content_hashtags (content_item_id, hashtag_id, source)
        values (${lockedContentId}, ${hashtagId}, 'caption')
      `;
      await sql`
        insert into events (
          id, creator_user_id, title, description, starts_at, ends_at,
          event_type, location_type, access_rule, state, idempotency_key, request_hash
        ) values (
          ${eventId}, ${creatorId}, 'Mixed event', 'mixed discovery event',
          now() + interval '7 days', now() + interval '7 days 2 hours',
          'digital_live_stream', 'digital_live_stream', 'public_sale', 'published',
          ${`discover-event-${suffix}`}, ${"a".repeat(64)}
        )
      `;

      await insertLiveRoom(sql, {
        id: approvedLiveId,
        creatorId,
        suffix: `${suffix}-approved`,
        safetyState: "approved"
      });
      await insertLiveRoom(sql, {
        id: rejectedLiveId,
        creatorId,
        suffix: `${suffix}-rejected`,
        safetyState: "rejected"
      });
      await insertLiveRoom(sql, {
        id: quarantinedLiveId,
        creatorId,
        suffix: `${suffix}-quarantined`,
        safetyState: "quarantined"
      });

      const firstPage = await repository.search({
        supabaseUserId: viewerId,
        query: "mixed",
        limit: 12
      });
      expect(firstPage.content).toHaveLength(12);
      expect(firstPage.nextCursors.content).toEqual(expect.any(String));
      expect(firstPage.creators.map((creator) => creator.id)).toContain(creatorId);
      expect(firstPage.hashtags.map((hashtag) => hashtag.slug)).toContain(hashtagSlug);
      expect(firstPage.events.map((event) => event.id)).toContain(eventId);
      expect(firstPage.liveRooms).toHaveLength(1);
      expect(firstPage.liveRooms[0]).toMatchObject({
        id: approvedLiveId,
        safetyState: "monitoring",
        accessState: "event_access_required",
        playback: { state: "blocked", url: null, provider: "livepeer" }
      });

      const contentCursor = firstPage.nextCursors.content;
      if (!contentCursor) throw new Error("Expected a content continuation cursor");
      const secondPage = await repository.search({
        supabaseUserId: viewerId,
        query: "mixed",
        cursors: { content: contentCursor },
        limit: 12
      });
      expect(secondPage.content).toHaveLength(1);
      expect(secondPage.nextCursors.content).toBeNull();

      const visibleIds = [...firstPage.content, ...secondPage.content].map((item) => item.id);
      expect(new Set(visibleIds).size).toBe(13);
      expect(visibleIds).toEqual(expect.arrayContaining(publicContentIds));
      expect(visibleIds).not.toContain(subscriberContentId);
      expect(visibleIds).not.toContain(rejectedContentId);
      expect(visibleIds).not.toContain(quarantinedContentId);
      expect([...firstPage.content, ...secondPage.content]).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: lockedContentId, accessState: "locked", bodyText: null })
      ]));
      expect(firstPage.liveRooms.map((room) => room.id)).not.toContain(rejectedLiveId);
      expect(firstPage.liveRooms.map((room) => room.id)).not.toContain(quarantinedLiveId);

      await expect(repository.search({
        supabaseUserId: viewerId,
        query: "mixed",
        cursors: { liveRooms: contentCursor },
        limit: 12
      })).rejects.toBeInstanceOf(InvalidDiscoverCursorError);

      const firstWaitingCreatedAt = new Date(Date.now() + 120_000);
      const secondWaitingCreatedAt = new Date(Date.now() + 60_000);
      await insertLiveRoom(sql, {
        id: firstWaitingLiveId,
        creatorId,
        suffix: `${suffix}-waiting-first`,
        safetyState: "approved",
        state: "waiting",
        createdAt: firstWaitingCreatedAt
      });
      await insertLiveRoom(sql, {
        id: secondWaitingLiveId,
        creatorId,
        suffix: `${suffix}-waiting-second`,
        safetyState: "approved",
        state: "waiting",
        createdAt: secondWaitingCreatedAt
      });

      const firstLivePage = await repository.listLive({
        supabaseUserId: viewerId,
        limit: 1
      });
      expect(firstLivePage.items[0]?.id).toBe(firstWaitingLiveId);
      const liveCursor = firstLivePage.nextCursor;
      if (!liveCursor) throw new Error("Expected a live-room continuation cursor");

      await sql`
        update live_rooms
        set state = 'live', updated_at = now()
        where id = ${secondWaitingLiveId}
      `;
      const secondLivePage = await repository.listLive({
        supabaseUserId: viewerId,
        cursor: liveCursor,
        limit: 1
      });
      expect(secondLivePage.items[0]?.id).toBe(secondWaitingLiveId);
    } finally {
      await cleanup(sql, creatorId, viewerId, hashtagSlug);
      await repository.close?.();
    }
  });
});

async function insertTextContent(
  sql: PostgresSql,
  input: {
    id: string;
    creatorId: string;
    caption: string;
    visibility: "public" | "subscribers";
    createdAt: Date;
    releaseState?: "approved" | "rejected" | "quarantined";
  }
): Promise<void> {
  const releaseState = input.releaseState ?? "approved";
  await sql`
    insert into content_items (
      id, creator_user_id, media_type, state, visibility, nsfw_label,
      moderation_state, publish_state, caption, body_text, created_at, updated_at
    ) values (
      ${input.id}, ${input.creatorId}, 'text', 'ready', ${input.visibility}, 'none',
      'pending', 'published', ${input.caption}, ${input.caption}, ${input.createdAt}, ${input.createdAt}
    )
  `;
  await sql`
    insert into media_safety_cases (
      content_item_id, declared_rating, state, decision_source, reason_code,
      policy_version, provider_release_allowed, evidence_summary, decided_at
    ) values (
      ${input.id}, 'none', ${releaseState}, 'automated', ${`discover_${releaseState}`},
      'discover-integration-v1', ${releaseState === "approved"}, '{}'::jsonb,
      ${releaseState === "quarantined" ? null : new Date()}
    )
  `;
  await sql`
    update content_items
    set moderation_state = ${releaseState === "approved" ? "approved" : releaseState}
    where id = ${input.id}
  `;
}

async function insertLiveRoom(
  sql: PostgresSql,
  input: {
    id: string;
    creatorId: string;
    suffix: string;
    safetyState: "approved" | "rejected" | "quarantined";
    state?: "waiting" | "live";
    createdAt?: Date;
  }
): Promise<void> {
  const state = input.state ?? "live";
  const createdAt = input.createdAt ?? new Date();
  await sql`
    insert into live_rooms (
      id, creator_user_id, title, provider_stream_id, provider_playback_id,
      provider_state, state, access_rule, preview_seconds, event_price_minor,
      currency, members_only_chat, members_included_in_paid_event, replay_window_hours,
      playback_url, idempotency_key, request_hash, created_at, updated_at
    ) values (
      ${input.id}, ${input.creatorId}, ${`Mixed live ${input.suffix}`},
      ${`stream-${input.suffix}`}, ${`playback-${input.suffix}`},
      ${state === "live" ? "active" : "created"}, ${state},
      'paid_event', 60, 50000000, 'SOL', false, false, 48,
      ${`https://livepeercdn.studio/hls/playback-${input.suffix}/index.m3u8`},
      ${`discover-live-${input.suffix}`}, ${"b".repeat(64)}, ${createdAt}, ${createdAt}
    )
  `;
  await sql`
    insert into media_safety_cases (
      live_room_id, declared_rating, state, decision_source, reason_code,
      policy_version, provider_release_allowed, evidence_summary, decided_at
    ) values (
      ${input.id}, 'none', ${input.safetyState === "approved" ? "quarantined" : input.safetyState},
      'automated', 'discover_live_seed', 'discover-live-v1', false, '{}'::jsonb,
      ${input.safetyState === "quarantined" ? null : new Date()}
    )
  `;

  if (input.safetyState !== "approved") return;

  await sql`
    insert into live_safety_sessions (
      room_id, media_safety_case_id, moderation_target_reference, state,
      acknowledgement_event_id, acknowledged_at, last_heartbeat_at,
      heartbeat_expires_at, next_check_at
    )
    select
      ${input.id}, safety.id, ${`target-${input.suffix}`}, 'monitoring',
      ${`ack-${input.suffix}`}, now(), now(), now() + interval '5 minutes', now() + interval '1 minute'
    from media_safety_cases safety
    where safety.live_room_id = ${input.id} and safety.state <> 'superseded'
  `;
  await sql`
    update media_safety_cases
    set state = 'approved', provider_release_allowed = true,
        reason_code = 'live_monitoring_healthy', decided_at = now(), updated_at = now()
    where live_room_id = ${input.id} and state <> 'superseded'
  `;
}

async function cleanup(
  sql: PostgresSql,
  creatorId: string,
  viewerId: string,
  hashtagSlug: string
): Promise<void> {
  await sql`
    delete from content_access_rules
    where content_item_id in (select id from content_items where creator_user_id = ${creatorId})
  `;
  await sql`delete from live_safety_sessions where room_id in (select id from live_rooms where creator_user_id = ${creatorId})`;
  await sql`delete from media_safety_cases where live_room_id in (select id from live_rooms where creator_user_id = ${creatorId})`;
  await sql`delete from live_rooms where creator_user_id = ${creatorId}`;
  await sql`delete from events where creator_user_id = ${creatorId}`;
  await sql`delete from content_items where creator_user_id = ${creatorId}`;
  await sql`delete from hashtags where slug = ${hashtagSlug}`;
  await sql`delete from verification_records where subject_id in (${creatorId}, ${viewerId})`;
  await sql`delete from profiles where user_id in (${creatorId}, ${viewerId})`;
  await sql`delete from users where id in (${creatorId}, ${viewerId})`;
}
