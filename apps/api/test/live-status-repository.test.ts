import { describe, expect, it, vi } from "vitest";
import { createLiveStatusRepositoryMethods } from "../src/modules/live/live-status-repository";
import type { PostgresSql, PostgresTransaction } from "../src/shared/postgres";

describe("live status repository", () => {
  it("ignores an older replay-ready delivery instead of replacing the current replay", async () => {
    const queries: string[] = [];
    const transaction = vi.fn((strings: TemplateStringsArray) => {
      const query = strings.join("?");
      queries.push(query);
      if (query.includes("select id, state")) {
        return Promise.resolve([{ id: "live-room", state: "replay_ready" }]);
      }
      if (query.includes("as is_latest")) {
        return Promise.resolve([{ is_latest: false, processed_at: null }]);
      }
      return Promise.resolve([]);
    }) as unknown as PostgresTransaction;
    const sql = {
      begin: vi.fn(async (work: (tx: PostgresTransaction) => Promise<unknown>) => work(transaction))
    } as unknown as PostgresSql;
    const repository = createLiveStatusRepositoryMethods(sql);

    await expect(repository.updateRoomFromWebhook?.({
      providerEventId: "stale-recording-ready",
      providerStreamId: "stream-1",
      providerPlaybackId: "stale-playback",
      providerState: "recording_ready",
      state: "replay_ready",
      playbackUrl: "https://playback.example/stale.m3u8",
      preventStateRegression: true
    })).resolves.toBe(true);

    expect(queries.join("\n")).toContain("normalized_state = 'ignored_stale'");
    expect(queries.join("\n")).toContain("newer.delivery_sequence > current_event.delivery_sequence");
    expect(queries.join("\n")).not.toContain("update live_rooms\n          set");
  });

  it("does not repeat an already-applied replay-ready handoff", async () => {
    const queries: string[] = [];
    const transaction = vi.fn((strings: TemplateStringsArray) => {
      const query = strings.join("?");
      queries.push(query);
      if (query.includes("select id, state")) {
        return Promise.resolve([{ id: "live-room", state: "replay_ready" }]);
      }
      if (query.includes("as is_latest")) {
        return Promise.resolve([{
          is_latest: true,
          processed_at: new Date("2026-08-17T07:50:00.000Z")
        }]);
      }
      return Promise.resolve([]);
    }) as unknown as PostgresTransaction;
    const sql = {
      begin: vi.fn(async (work: (tx: PostgresTransaction) => Promise<unknown>) => work(transaction))
    } as unknown as PostgresSql;
    const repository = createLiveStatusRepositoryMethods(sql);

    await expect(repository.updateRoomFromWebhook?.({
      providerEventId: "already-applied-recording-ready",
      providerStreamId: "stream-1",
      providerPlaybackId: "current-playback",
      providerState: "recording_ready",
      state: "replay_ready",
      playbackUrl: "https://playback.example/current.m3u8",
      preventStateRegression: true
    })).resolves.toBe(true);

    expect(queries.join("\n")).not.toContain("normalized_state = 'ignored_stale'");
    expect(queries.join("\n")).not.toContain("update live_rooms\n          set");
    expect(queries.join("\n")).not.toContain("live_replay_handoff_ready");
  });
});
