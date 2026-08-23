import { describe, expect, it, vi } from "vitest";
import { createLiveStatusRepositoryMethods } from "../src/modules/live/live-status-repository";
import type { PostgresSql, PostgresTransaction } from "../src/shared/postgres";

describe("live status repository", () => {
  it("fails closed when Livepeer acknowledges a different moderation target", async () => {
    const queries: string[] = [];
    const values: unknown[] = [];
    const transaction = vi.fn((strings: TemplateStringsArray, ...queryValues: unknown[]) => {
      const query = strings.join("?");
      queries.push(query);
      values.push(...queryValues);
      if (query.includes("from live_rooms room") && query.includes("expected_target")) {
        return Promise.resolve([{
          room_id: "room-1",
          room_state: "live",
          session_id: "session-1",
          expected_target: "rtmp://moderation/expected",
          acknowledged_at: null
        }]);
      }
      if (query.includes("insert into live_safety_monitoring_events")) return Promise.resolve([{ id: "event-1" }]);
      return Promise.resolve([]);
    }) as unknown as PostgresTransaction;
    const sql = { begin: vi.fn(async (work: (tx: PostgresTransaction) => Promise<unknown>) => work(transaction)) } as unknown as PostgresSql;

    const applied = await createLiveStatusRepositoryMethods(sql).recordLiveSafetyEvent!({
      provider: "livepeer",
      providerEventId: "connected-wrong-target",
      providerStreamId: "stream-1",
      eventKind: "target_connected",
      normalizedSignal: "healthy",
      moderationTargetReference: "rtmp://moderation/wrong",
      payloadHash: "a".repeat(64),
      signatureHash: "b".repeat(64),
      observedAt: new Date("2026-08-23T12:00:00.000Z")
    });

    expect(applied).toBe(true);
    expect(values).toContain("provider_inconsistent");
    expect(values).toContain("inconsistent");
    expect(values).toContain("live_monitoring_inconsistent");
    expect(queries.join("\n")).toContain("state = 'suspended'");
    expect(queries.join("\n")).toContain("provider_release_allowed = false");
    expect(queries.join("\n")).toContain("insert into live_safety_provider_actions");
  });

  it("does not apply a duplicate live-safety provider event twice", async () => {
    const queries: string[] = [];
    const transaction = vi.fn((strings: TemplateStringsArray) => {
      const query = strings.join("?");
      queries.push(query);
      if (query.includes("from live_rooms room") && query.includes("expected_target")) {
        return Promise.resolve([{
          room_id: "room-1",
          room_state: "live",
          session_id: "session-1",
          expected_target: "rtmp://moderation/exact",
          acknowledged_at: null
        }]);
      }
      if (query.includes("insert into live_safety_monitoring_events")) return Promise.resolve([]);
      return Promise.resolve([]);
    }) as unknown as PostgresTransaction;
    const sql = { begin: vi.fn(async (work: (tx: PostgresTransaction) => Promise<unknown>) => work(transaction)) } as unknown as PostgresSql;

    await expect(createLiveStatusRepositoryMethods(sql).recordLiveSafetyEvent!({
      provider: "livepeer",
      providerEventId: "duplicate-connected",
      providerStreamId: "stream-1",
      eventKind: "target_connected",
      normalizedSignal: "healthy",
      moderationTargetReference: "rtmp://moderation/exact",
      payloadHash: "a".repeat(64),
      signatureHash: "b".repeat(64),
      observedAt: new Date("2026-08-23T12:00:00.000Z")
    })).resolves.toBe(false);

    expect(queries.join("\n")).not.toContain("set state = 'target_connected'");
    expect(queries.join("\n")).not.toContain("insert into live_safety_provider_actions");
  });

  it("records a healthy heartbeat and evaluates the database release predicate", async () => {
    const queries: string[] = [];
    const transaction = vi.fn((strings: TemplateStringsArray) => {
      const query = strings.join("?");
      queries.push(query);
      if (query.includes("from live_rooms room") && query.includes("expected_target")) {
        return Promise.resolve([{
          room_id: "room-1",
          room_state: "live",
          session_id: "session-1",
          expected_target: "rtmp://moderation/exact",
          acknowledged_at: new Date("2026-08-23T11:59:55.000Z")
        }]);
      }
      if (query.includes("insert into live_safety_monitoring_events")) return Promise.resolve([{ id: "event-heartbeat" }]);
      return Promise.resolve([]);
    }) as unknown as PostgresTransaction;
    const sql = { begin: vi.fn(async (work: (tx: PostgresTransaction) => Promise<unknown>) => work(transaction)) } as unknown as PostgresSql;

    await expect(createLiveStatusRepositoryMethods(sql).recordLiveSafetyEvent!({
      provider: "livepeer",
      providerEventId: "healthy-heartbeat",
      providerStreamId: "stream-1",
      eventKind: "heartbeat",
      normalizedSignal: "healthy",
      moderationTargetReference: "rtmp://moderation/exact",
      payloadHash: "a".repeat(64),
      signatureHash: "b".repeat(64),
      observedAt: new Date("2026-08-23T12:00:00.000Z")
    })).resolves.toBe(true);

    expect(queries.join("\n")).toContain("set state = 'monitoring'");
    expect(queries.join("\n")).toContain("heartbeat_expires_at");
    expect(queries.join("\n")).toContain("private.live_safety_release_ready");
    expect(queries.join("\n")).toContain("provider_release_allowed = true");
  });

  it("denies local delivery and queues suspension for a normalized severe signal", async () => {
    const queries: string[] = [];
    const values: unknown[] = [];
    const transaction = vi.fn((strings: TemplateStringsArray, ...queryValues: unknown[]) => {
      const query = strings.join("?");
      queries.push(query);
      values.push(...queryValues);
      if (query.includes("from live_rooms room") && query.includes("expected_target")) {
        return Promise.resolve([{
          room_id: "room-1",
          room_state: "live",
          session_id: "session-1",
          expected_target: "moderation-target",
          acknowledged_at: new Date("2026-08-23T11:59:55.000Z")
        }]);
      }
      if (query.includes("insert into live_safety_monitoring_events")) return Promise.resolve([{ id: "event-adverse" }]);
      return Promise.resolve([]);
    }) as unknown as PostgresTransaction;
    const sql = { begin: vi.fn(async (work: (tx: PostgresTransaction) => Promise<unknown>) => work(transaction)) } as unknown as PostgresSql;

    await expect(createLiveStatusRepositoryMethods(sql).recordLiveSafetyEvent!({
      provider: "moderation_provider",
      providerEventId: "adverse-1",
      providerStreamId: "stream-1",
      eventKind: "adverse_signal",
      normalizedSignal: "apparent_minor_sexual_context",
      moderationTargetReference: "moderation-target",
      payloadHash: "a".repeat(64),
      signatureHash: "b".repeat(64),
      observedAt: new Date("2026-08-23T12:00:00.000Z")
    })).resolves.toBe(true);

    expect(values).toContain("live_monitoring_apparent_minor_sexual_context");
    expect(queries.join("\n")).toContain("provider_release_allowed = false");
    expect(queries.join("\n")).toContain("state = 'suspended'");
    expect(queries.join("\n")).toContain("insert into live_safety_provider_actions");
  });

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
      playbackUrl: null
    })).resolves.toBe(true);

    expect(queries.join("\n")).toContain("current_event.received_at >=");
    expect(values).toContain(providerCheckedAt);
    expect(queries.join("\n")).toContain("normalized_state = 'ignored_stale'");
    expect(queries.join("\n")).not.toContain("update live_rooms\n          set");
    expect(queries.join("\n")).not.toContain("update live_passes");
  });

  it("records the database-owned direct Livepeer observation cutoff", async () => {
    const queries: string[] = [];
    const values: unknown[] = [];
    const providerObservationCutoff = new Date("2026-08-17T08:05:00.000Z");
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
      providerObservationCutoff,
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
    expect(values).toContain(providerObservationCutoff);
  });

  it("captures provider freshness from the Postgres clock", async () => {
    const cutoff = new Date("2026-08-17T08:05:00.000Z");
    const sql = vi.fn((strings: TemplateStringsArray) => {
      expect(strings.join("?")).toContain("clock_timestamp()");
      return Promise.resolve([{ cutoff }]);
    }) as unknown as PostgresSql;
    const repository = createLiveStatusRepositoryMethods(sql);

    await expect(repository.captureProviderObservationCutoff()).resolves.toEqual(cutoff);
  });
});
