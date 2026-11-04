import { describe, expect, it } from "vitest";
import type postgres from "postgres";
import { createEventCoreRepositoryMethods } from "../src/modules/event/event-core-repository.js";
import { createEngagementPreferencesRepositoryMethods } from "../src/modules/engagement/engagement-preferences-repository.js";
import { createLiveRoomRepositoryMethods } from "../src/modules/live/live-room-repository.js";

describe("DML repository projections", () => {
  it("projects a newly inserted event in a follow-up statement in the same transaction", async () => {
    const eventId = "00000000-0000-4000-8000-000000000501";
    const requestHash = "event-request-hash";
    const { sql, queries } = fakeSql((query) => {
      if (query.includes("insert into events")) return [{ id: eventId, request_hash: requestHash }];
      if (query.includes("where e.id =")) {
        return [{
          id: eventId,
          title: "Launch",
          description: null,
          starts_at: new Date("2026-11-05T12:00:00.000Z"),
          ends_at: null,
          access_rule: "public_sale",
          location_type: "digital_live_stream",
          location_label: "WeVid",
          location_lat: null,
          location_lng: null,
          state: "draft",
          request_hash: requestHash
        }];
      }
      if (query.includes("from event_access_pass_types")) {
        return [{
          id: "00000000-0000-4000-8000-000000000502",
          event_id: eventId,
          label: "Access",
          price_minor: 100,
          currency: "USDC",
          capacity: 10,
          issued_count: 0,
          sale_starts_at: null,
          sale_ends_at: null,
          per_user_limit: 1,
          state: "active"
        }];
      }
      return [];
    });

    const repository = createEventCoreRepositoryMethods(sql);
    const event = await repository.createEvent({
      supabaseUserId: "00000000-0000-4000-8000-000000000503",
      idempotencyKey: "event-create-1",
      requestHash,
      body: {
        title: "Launch",
        startsAt: "2026-11-05T12:00:00.000Z",
        accessRule: "public_sale",
        location: { type: "digital_live_stream", label: "WeVid" },
        accessPassTypes: [{ label: "Access", priceMinor: 100, currency: "USDC", capacity: 10 }]
      }
    });

    expect(event.id).toBe(eventId);
    expect(queries.findIndex((query) => query.includes("insert into events"))).toBeLessThan(
      queries.findIndex((query) => query.includes("where e.id ="))
    );
  });

  it("projects a newly reserved live room after the mutating statement", async () => {
    const roomId = "00000000-0000-4000-8000-000000000511";
    const requestHash = "live-request-hash";
    const { sql, queries } = fakeSql((query) => {
      if (query.includes("insert into live_rooms")) return [{ id: roomId, request_hash: requestHash }];
      if (query.includes("where lr.id =")) return [liveRoomRow(roomId, requestHash)];
      return [];
    });
    const repository = createLiveRoomRepositoryMethods(sql);
    const room = await repository.reserveRoom({
      supabaseUserId: "00000000-0000-4000-8000-000000000512",
      idempotencyKey: "live-reserve-1",
      requestHash,
      title: "Room",
      accessMode: "public",
      previewSeconds: 0,
      eventPriceMinor: null,
      membersOnlyChat: false,
      membersIncludedInPaidEvent: false,
      replayWindowHours: 48
    });

    expect(room.id).toBe(roomId);
    expect(room.providerStreamId).toBeNull();
    expect(queries.findIndex((query) => query.includes("insert into live_rooms"))).toBeLessThan(
      queries.findIndex((query) => query.includes("where lr.id ="))
    );
  });

  it("reads updated feed preferences after the upsert statement", async () => {
    const userId = "00000000-0000-4000-8000-000000000521";
    const { sql, queries } = fakeSql((query) => {
      if (query.includes("select id from users")) return [{ id: userId }];
      if (query.includes("from viewer_feed_preferences vfp")) {
        return [{
          default_feed_mode: "following",
          nsfw_preference: "sfw",
          hidden_creator_ids: [],
          hidden_topics: []
        }];
      }
      return [];
    });
    const repository = createEngagementPreferencesRepositoryMethods(sql);
    const preferences = await repository.updateFeedPreferences({
      supabaseUserId: "00000000-0000-4000-8000-000000000522",
      body: { defaultMode: "following", nsfwPreference: "sfw" }
    });

    expect(preferences).toMatchObject({ defaultMode: "following", nsfwPreference: "sfw" });
    expect(queries.findIndex((query) => query.includes("insert into viewer_feed_preferences"))).toBeLessThan(
      queries.findIndex((query) => query.includes("from viewer_feed_preferences vfp"))
    );
  });
});

function fakeSql(resolveQuery: (query: string) => unknown[]) {
  const queries: string[] = [];
  const transaction = (async (strings: TemplateStringsArray) => {
    const query = strings.join("?");
    queries.push(query);
    return resolveQuery(query);
  }) as unknown as postgres.TransactionSql;
  transaction.json = ((value: unknown) => value) as postgres.TransactionSql["json"];
  const sql = {
    json: (value: unknown) => value,
    begin: async (run: (tx: postgres.TransactionSql) => Promise<unknown>) => run(transaction)
  } as unknown as postgres.Sql;
  return { sql, queries };
}

function liveRoomRow(id: string, requestHash: string) {
  return {
    id,
    title: "Room",
    state: "waiting",
    created_at: new Date("2026-11-04T12:00:00.000Z"),
    access_rule: "public",
    creator_user_id: "00000000-0000-4000-8000-000000000512",
    creator_handle: "creator",
    creator_display_name: "Creator",
    creator_avatar_url: null,
    provider_stream_id: null,
    provider_playback_id: null,
    host_ingest_url: null,
    host_stream_key: null,
    playback_url: null,
    preview_seconds: 0,
    event_price_minor: null,
    currency: "SOL",
    members_only_chat: false,
    members_included_in_paid_event: false,
    replay_window_hours: 48,
    replay_content_item_id: null,
    live_safety_state: "quarantined",
    live_provider_release_allowed: false,
    replay_release_allowed: false,
    replay_playback_url: null,
    replay_provider_playback_id: null,
    request_hash: requestHash,
    has_active_pass: false,
    has_active_membership: false,
    is_creator: true
  };
}
