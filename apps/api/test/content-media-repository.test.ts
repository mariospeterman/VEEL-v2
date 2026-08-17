import { describe, expect, it, vi } from "vitest";
import type { PostgresSql, PostgresTransaction } from "../src/shared/postgres";
import { createContentMediaRepositoryMethods } from "../src/modules/content/content-media-repository";

describe("content media repository", () => {
  it("does not approve moderation from provider playback sync", async () => {
    const { sql, queries, values } = createFakeSql();
    const repository = createContentMediaRepositoryMethods(sql);
    const providerObservedAt = new Date("2026-08-17T08:05:00.000Z");

    await repository.updateMediaAssetPlayback?.({
      mediaAssetId: "00000000-0000-4000-8000-000000000070",
      providerObservedAt,
      providerState: "ready",
      providerPlayable: true,
      playbackUrl: "https://vz.example.test/video/playlist.m3u8",
      posterUrl: "https://vz.example.test/video/thumbnail.jpg",
      durationMs: 90000
    });

    expect(queries.join("\n")).toContain("state = case when");
    expect(queries.join("\n")).toContain("provider_checked_at = ?");
    expect(values).toContain(providerObservedAt);
    expect(queries.join("\n")).not.toContain("moderation_state");
  });

  it("does not approve moderation from provider webhooks", async () => {
    const { sql, queries } = createFakeSql();
    const repository = createContentMediaRepositoryMethods(sql);

    await repository.updateMediaAssetFromWebhook?.({
      provider: "bunny",
      providerEventId: "bunny-event-1",
      providerAssetId: "bunny-video-guid",
      providerState: "ready",
      providerPlayable: true
    });

    expect(queries.join("\n")).toContain("state = case when");
    expect(queries.join("\n")).not.toContain("moderation_state");
  });

  it("ignores an older non-playable replay after a newer asset delivery", async () => {
    const { sql, queries } = createFakeSql({ isLatestProviderEvent: false });
    const repository = createContentMediaRepositoryMethods(sql);

    await expect(repository.updateMediaAssetFromWebhook?.({
      provider: "bunny",
      providerEventId: "bunny-stale-processing-event",
      providerAssetId: "bunny-video-guid",
      providerState: "processing",
      providerPlayable: false,
      preventStateRegression: true
    })).resolves.toBe(true);

    expect(queries.join("\n")).toContain("normalized_state = 'ignored_stale'");
    expect(queries.join("\n")).not.toContain("update media_assets\n          set");
  });

  it("ignores an older ready replay after a newer asset delivery", async () => {
    const { sql, queries } = createFakeSql({ isLatestProviderEvent: false });
    const repository = createContentMediaRepositoryMethods(sql);

    await expect(repository.updateMediaAssetFromWebhook?.({
      provider: "bunny",
      providerEventId: "bunny-stale-ready-event",
      providerAssetId: "bunny-video-guid",
      providerState: "ready",
      providerPlayable: true,
      preventStateRegression: true
    })).resolves.toBe(true);

    expect(queries.join("\n")).toContain("newer.delivery_sequence > current_event.delivery_sequence");
    expect(queries.join("\n")).toContain("newer.normalized_state is distinct from 'ignored_stale'");
    expect(queries.join("\n")).toContain("normalized_state = 'ignored_stale'");
    expect(queries.join("\n")).not.toContain("update media_assets\n          set");
  });

  it("ignores a recorded webhook replay after a newer direct provider observation", async () => {
    const { sql, queries } = createFakeSql({
      isLatestProviderEvent: false,
      providerCheckedAt: new Date("2026-08-17T07:45:00.000Z")
    });
    const repository = createContentMediaRepositoryMethods(sql);

    await expect(repository.updateMediaAssetFromWebhook?.({
      provider: "bunny",
      providerEventId: "bunny-recorded-before-direct-sync",
      providerAssetId: "bunny-video-guid",
      providerState: "processing",
      providerPlayable: false,
      preventStateRegression: true
    })).resolves.toBe(true);

    expect(queries.join("\n")).toContain("current_event.received_at >=");
    expect(queries.join("\n")).toContain("normalized_state = 'ignored_stale'");
    expect(queries.join("\n")).not.toContain("update media_assets\n          set");
  });
});

function createFakeSql(input: {
  isLatestProviderEvent?: boolean;
  providerCheckedAt?: Date | null;
} = {}): { sql: PostgresSql; queries: string[]; values: unknown[] } {
  const queries: string[] = [];
  const values: unknown[] = [];
  const transaction = vi.fn((strings: TemplateStringsArray, ...queryValues: unknown[]) => {
    const query = strings.join("?");
    queries.push(query);
    values.push(...queryValues);
    if (query.includes("select id")) {
      return Promise.resolve([{
        id: "media-asset",
        provider_checked_at: input.providerCheckedAt ?? null
      }]);
    }
    if (query.includes("as is_latest")) {
      return Promise.resolve([{
        is_latest: input.isLatestProviderEvent ?? true,
        processed_at: null
      }]);
    }
    return Promise.resolve(query.includes("returning id") ? [{ id: "media-asset" }] : []);
  }) as unknown as PostgresTransaction;
  const sql = {
    begin: vi.fn(async (work: (tx: PostgresTransaction) => Promise<unknown>) => work(transaction))
  } as unknown as PostgresSql;

  return { sql, queries, values };
}
