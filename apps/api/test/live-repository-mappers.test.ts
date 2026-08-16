import { describe, expect, it } from "vitest";
import { toLiveRoom } from "../src/modules/live/live-repository-mappers.js";
import type { LiveRoomRow } from "../src/modules/live/live-repository-rows.js";

describe("live repository mapper", () => {
  it("releases live playback and chat only while canonical safety allows provider release", () => {
    const released = toLiveRoom(liveRoomRow());
    expect(released.safetyState).toBe("monitoring");
    expect(released.playback).toMatchObject({ state: "full", provider: "livepeer" });
    expect(released.chat).toEqual({ enabled: true, accessState: "allowed" });

    const quarantined = toLiveRoom(
      liveRoomRow({ live_safety_state: "review_required", live_provider_release_allowed: false })
    );
    expect(quarantined.safetyState).toBe("quarantined");
    expect(quarantined.playback).toEqual({
      state: "not_ready",
      url: null,
      provider: "livepeer"
    });
    expect(quarantined.chat).toEqual({ enabled: false, accessState: "closed" });
  });
});

function liveRoomRow(overrides: Partial<LiveRoomRow> = {}): LiveRoomRow {
  return {
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa51",
    title: "Safe live room",
    state: "live",
    access_rule: "public",
    creator_user_id: "00000000-0000-4000-8000-000000000010",
    creator_handle: "creator",
    creator_display_name: "Creator",
    creator_avatar_url: null,
    provider_stream_id: "provider-stream-51",
    provider_playback_id: "provider-playback-51",
    host_ingest_url: null,
    host_stream_key: null,
    playback_url: "https://livepeercdn.studio/hls/provider-playback-51/index.m3u8",
    preview_seconds: 0,
    event_price_minor: null,
    currency: "SOL",
    members_only_chat: false,
    members_included_in_paid_event: false,
    replay_window_hours: 48,
    replay_content_item_id: null,
    live_safety_state: "approved",
    live_provider_release_allowed: true,
    replay_release_allowed: false,
    replay_playback_url: null,
    replay_provider_playback_id: null,
    has_active_pass: false,
    has_active_membership: false,
    is_creator: false,
    ...overrides
  };
}
