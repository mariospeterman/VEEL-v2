import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createEngagementPreferencesRepositoryMethods } from "../src/modules/engagement/engagement-preferences-repository.js";
import { createEventCoreRepositoryMethods } from "../src/modules/event/event-core-repository.js";
import { createLiveRoomRepositoryMethods } from "../src/modules/live/live-room-repository.js";
import { createPostgresClient } from "../src/shared/postgres.js";
import { guardedIntegrationDatabaseUrl } from "./integration-database.js";

const enabled = ["1", "true"].includes(
  process.env.VEEL_ENABLE_REAL_API_INTEGRATION_TESTS ?? ""
);
const describeIntegration = enabled ? describe : describe.skip;

describeIntegration("fresh DML projections against migrated Postgres", () => {
  it("returns the inserted or updated state on the first repository call", async () => {
    const sql = createPostgresClient(guardedIntegrationDatabaseUrl());
    const userId = randomUUID();
    const suffix = userId.replaceAll("-", "").slice(0, 10);
    const eventRepository = createEventCoreRepositoryMethods(sql);
    const liveRepository = createLiveRoomRepositoryMethods(sql);
    const preferencesRepository = createEngagementPreferencesRepositoryMethods(sql);
    const eventIds: string[] = [];
    const roomIds: string[] = [];

    try {
      await sql`
        insert into users (id, supabase_user_id, state)
        values (${userId}, ${userId}, 'active')
      `;
      await sql`
        insert into profiles (user_id, handle, display_name, visibility)
        values (${userId}, ${`projection_${suffix}`}, 'Projection creator', 'public')
      `;

      const createdEvent = await eventRepository.createEvent({
        supabaseUserId: userId,
        idempotencyKey: `event-create-${suffix}`,
        requestHash: `event-create-hash-${suffix}`,
        body: {
          title: "First-call event",
          startsAt: "2030-11-05T12:00:00.000Z",
          accessRule: "public_sale",
          location: { type: "digital_live_stream", label: "Online" },
          accessPassTypes: [{
            label: "General access",
            priceMinor: 10_000_000,
            currency: "SOL",
            capacity: 5,
            perUserLimit: 1
          }]
        }
      });
      eventIds.push(createdEvent.id);
      expect(createdEvent).toMatchObject({
        title: "First-call event",
        accessPassTypes: [expect.objectContaining({
          label: "General access",
          capacity: 5,
          remaining: 5
        })]
      });

      const updatedEvent = await eventRepository.updateEvent({
        supabaseUserId: userId,
        eventId: createdEvent.id,
        idempotencyKey: `event-update-${suffix}`,
        requestHash: `event-update-hash-${suffix}`,
        body: { title: "Updated on first call" }
      });
      expect(updatedEvent).toMatchObject({ title: "Updated on first call" });
      await expect(eventRepository.findEvent({
        supabaseUserId: userId,
        eventId: createdEvent.id
      })).resolves.toMatchObject({ title: "Updated on first call" });

      const preferences = await preferencesRepository.updateFeedPreferences({
        supabaseUserId: userId,
        body: { defaultMode: "following", nsfwPreference: "sfw" }
      });
      expect(preferences).toMatchObject({
        defaultMode: "following",
        nsfwPreference: "sfw"
      });
      await expect(preferencesRepository.getFeedPreferences({
        supabaseUserId: userId
      })).resolves.toMatchObject({
        defaultMode: "following",
        nsfwPreference: "sfw"
      });

      const reservedRoom = await liveRepository.reserveRoom({
        supabaseUserId: userId,
        idempotencyKey: `live-reserve-${suffix}`,
        requestHash: `live-reserve-hash-${suffix}`,
        title: "Reserved on first call",
        accessMode: "public",
        previewSeconds: 0,
        eventPriceMinor: null,
        membersOnlyChat: false,
        membersIncludedInPaidEvent: false,
        replayWindowHours: 48
      });
      roomIds.push(reservedRoom.id);
      expect(reservedRoom).toMatchObject({
        title: "Reserved on first call",
        providerStreamId: null
      });

      const claimId = randomUUID();
      await expect(liveRepository.claimProviderCreation({
        supabaseUserId: userId,
        roomId: reservedRoom.id,
        claimId
      })).resolves.toBe(true);
      const attachedRoom = await liveRepository.attachProviderRoom({
        supabaseUserId: userId,
        roomId: reservedRoom.id,
        claimId,
        providerRoom: {
          provider: "livepeer",
          providerStreamId: `stream-${suffix}`,
          providerPlaybackId: `playback-${suffix}`,
          providerState: "ready",
          hostIngestUrl: "rtmp://example.test/live",
          hostStreamKey: `secret-${suffix}`,
          playbackUrl: "https://playback.example.test/live.m3u8",
          moderationTargetReference: `moderation-${suffix}`
        }
      });
      expect(attachedRoom).toMatchObject({
        id: reservedRoom.id,
        providerStreamId: `stream-${suffix}`,
        providerPlaybackId: `playback-${suffix}`
      });

      const createdRoom = await liveRepository.createRoom({
        supabaseUserId: userId,
        idempotencyKey: `live-create-${suffix}`,
        requestHash: `live-create-hash-${suffix}`,
        title: "Created on first call",
        accessMode: "public",
        previewSeconds: 0,
        eventPriceMinor: null,
        membersOnlyChat: false,
        membersIncludedInPaidEvent: false,
        replayWindowHours: 48,
        providerRoom: {
          provider: "livepeer",
          providerStreamId: `stream-direct-${suffix}`,
          providerPlaybackId: `playback-direct-${suffix}`,
          providerState: "ready",
          hostIngestUrl: "rtmp://example.test/direct",
          hostStreamKey: `direct-secret-${suffix}`,
          playbackUrl: "https://playback.example.test/direct.m3u8",
          moderationTargetReference: `moderation-direct-${suffix}`
        }
      });
      roomIds.push(createdRoom.id);
      expect(createdRoom).toMatchObject({
        title: "Created on first call",
        providerStreamId: `stream-direct-${suffix}`
      });
    } finally {
      if (roomIds.length > 0) {
        await sql`delete from media_moderation_jobs where live_room_id in ${sql(roomIds)}`;
        await sql`delete from live_safety_sessions where room_id in ${sql(roomIds)}`;
        await sql`delete from media_safety_cases where live_room_id in ${sql(roomIds)}`;
        await sql`delete from live_rooms where id in ${sql(roomIds)}`;
      }
      if (eventIds.length > 0) {
        await sql`delete from event_access_pass_types where event_id in ${sql(eventIds)}`;
        await sql`delete from events where id in ${sql(eventIds)}`;
      }
      await sql`delete from viewer_feed_preferences where user_id = ${userId}`;
      await sql`delete from mutation_command_receipts where actor_user_id = ${userId}`;
      await sql`delete from profiles where user_id = ${userId}`;
      await sql`delete from users where id = ${userId}`;
      await sql.end({ timeout: 5 });
    }
  });
});
