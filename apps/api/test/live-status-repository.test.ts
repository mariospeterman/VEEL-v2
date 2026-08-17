import { describe, expect, it, vi } from "vitest";
import { createLiveStatusRepositoryMethods } from "../src/modules/live/live-status-repository";
import type { PostgresSql, PostgresTransaction } from "../src/shared/postgres";

describe("live status repository", () => {
  it("ignores an older replay-ready delivery instead of replacing the current replay", async () => {
    const queries: string[] = [];
    const transaction = vi.fn((strings: TemplateStringsArray) => {
      const query = strings.join("?");
      queries.push(query);
      if (query.includes("select id, provider_checked_at, state")) {
        return Promise.resolve([{ id: "live-room", provider_checked_at: null, state: "replay_ready" }]);
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
    expect(queries.join("\n")).toContain("newer.normalized_state is distinct from 'ignored_stale'");
    expect(queries.join("\n")).not.toContain("update live_rooms\n          set");
  });

  it("does not repeat an already-applied replay-ready handoff", async () => {
    const queries: string[] = [];
    const transaction = vi.fn((strings: TemplateStringsArray) => {
      const query = strings.join("?");
      queries.push(query);
      if (query.includes("select id, provider_checked_at, state")) {
        return Promise.resolve([{ id: "live-room", provider_checked_at: null, state: "replay_ready" }]);
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

  it("does not repeat a replay-ready handoff when the normal webhook resumes after recovery", async () => {
    const queries: string[] = [];
    const transaction = vi.fn((strings: TemplateStringsArray) => {
      const query = strings.join("?");
      queries.push(query);
      if (query.includes("select id, provider_checked_at, state")) {
        return Promise.resolve([{ id: "live-room", provider_checked_at: null, state: "replay_ready" }]);
      }
      if (query.includes("as is_latest")) {
        return Promise.resolve([{
          is_latest: true,
          processed_at: new Date("2026-08-17T09:00:00.000Z")
        }]);
      }
      return Promise.resolve([]);
    }) as unknown as PostgresTransaction;
    const sql = {
      begin: vi.fn(async (work: (tx: PostgresTransaction) => Promise<unknown>) => work(transaction))
    } as unknown as PostgresSql;
    const repository = createLiveStatusRepositoryMethods(sql);

    await expect(repository.updateRoomFromWebhook?.({
      providerEventId: "recovery-finished-before-webhook",
      providerStreamId: "stream-1",
      providerPlaybackId: "current-playback",
      providerState: "recording_ready",
      state: "replay_ready",
      playbackUrl: "https://playback.example/current.m3u8"
    })).resolves.toBe(true);

    expect(queries.join("\n")).not.toContain("update live_rooms\n          set");
    expect(queries.join("\n")).not.toContain("live_replay_handoff_ready");
  });

  it("ignores replay evidence older than a direct Livepeer sync", async () => {
    const queries: string[] = [];
    const providerCheckedAt = new Date("2026-08-17T08:00:00.000Z");
    const values: unknown[] = [];
    const transaction = vi.fn((strings: TemplateStringsArray, ...queryValues: unknown[]) => {
      const query = strings.join("?");
      queries.push(query);
      values.push(...queryValues);
      if (query.includes("select id, provider_checked_at, state")) {
        return Promise.resolve([{ id: "live-room", provider_checked_at: providerCheckedAt, state: "live" }]);
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
      providerEventId: "ended-before-direct-sync",
      providerStreamId: "stream-1",
      providerPlaybackId: "playback-1",
      providerState: "ended",
      state: "ended",
      playbackUrl: null,
      preventStateRegression: true
    })).resolves.toBe(true);

    expect(queries.join("\n")).toContain("current_event.received_at >=");
    expect(values).toContain(providerCheckedAt);
    expect(queries.join("\n")).toContain("normalized_state = 'ignored_stale'");
    expect(queries.join("\n")).not.toContain("update live_rooms\n          set");
    expect(queries.join("\n")).not.toContain("update live_passes");
  });

  it("records direct Livepeer sync observation time", async () => {
    const queries: string[] = [];
    const values: unknown[] = [];
    const providerObservedAt = new Date("2026-08-17T08:05:00.000Z");
    const transaction = vi.fn((strings: TemplateStringsArray, ...queryValues: unknown[]) => {
      const query = strings.join("?");
      queries.push(query);
      values.push(...queryValues);
      if (query.includes("update live_rooms")) {
        return Promise.resolve([{ id: "live-room" }]);
      }
      return Promise.resolve([]);
    }) as unknown as PostgresTransaction;
    const sql = {
      begin: vi.fn(async (work: (tx: PostgresTransaction) => Promise<unknown>) => work(transaction))
    } as unknown as PostgresSql;
    const repository = createLiveStatusRepositoryMethods(sql);

    await repository.updateRoomStatus({
      providerObservedAt,
      roomId: "live-room",
      status: {
        playbackUrl: "https://playback.example/live.m3u8",
        providerPlaybackId: "playback-1",
        providerState: "active",
        providerStreamId: "stream-1",
        replayPlaybackUrl: null,
        replayProviderAssetId: null,
        replayProviderPlaybackId: null,
        state: "live"
      }
    });

    expect(queries.join("\n")).toContain("provider_checked_at = ?");
    expect(queries.join("\n")).toContain("provider_checked_at <= ?");
    expect(queries.join("\n")).toContain("newer.received_at > ?");
    expect(values).toContain(providerObservedAt);
  });
});
