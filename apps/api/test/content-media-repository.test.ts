import { describe, expect, it, vi } from "vitest";
import type { PostgresSql, PostgresTransaction } from "../src/shared/postgres";
import { createContentMediaRepositoryMethods } from "../src/modules/content/content-media-repository";

describe("content media repository", () => {
  it("does not approve moderation from provider playback sync", async () => {
    const { sql, queries } = createFakeSql();
    const repository = createContentMediaRepositoryMethods(sql);

    await repository.updateMediaAssetPlayback?.({
      mediaAssetId: "00000000-0000-4000-8000-000000000070",
      providerState: "ready",
      providerPlayable: true,
      playbackUrl: "https://vz.example.test/video/playlist.m3u8",
      posterUrl: "https://vz.example.test/video/thumbnail.jpg",
      durationMs: 90000
    });

    expect(queries.join("\n")).toContain("state = case when");
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
});

function createFakeSql(): { sql: PostgresSql; queries: string[] } {
  const queries: string[] = [];
  const transaction = vi.fn((strings: TemplateStringsArray) => {
    const query = strings.join("?");
    queries.push(query);
    return Promise.resolve(query.includes("returning id") ? [{ id: "media-asset" }] : []);
  }) as unknown as PostgresTransaction;
  const sql = {
    begin: vi.fn(async (work: (tx: PostgresTransaction) => Promise<unknown>) => work(transaction))
  } as unknown as PostgresSql;

  return { sql, queries };
}
