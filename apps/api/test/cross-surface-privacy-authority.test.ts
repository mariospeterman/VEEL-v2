import { describe, expect, it } from "vitest";
import type postgres from "postgres";
import { createLiveChatRepositoryMethods } from "../src/modules/live/live-chat-repository.js";
import { createLiveRoomRepositoryMethods } from "../src/modules/live/live-room-repository.js";
import { createPostgresMutualsRepository } from "../src/modules/mutuals/mutuals-repository.js";

describe("cross-surface privacy authority", () => {
  it("uses canonical eligibility and block policy for Mutuals reads and writes", async () => {
    const { sql, queries } = recordingSql((query) =>
      query.includes("select exists") ? [{ exists: true }] : []
    );
    const repository = createPostgresMutualsRepository(sql);

    await repository.listFeed({
      supabaseUserId: "00000000-0000-4000-8000-000000000601",
      limit: 12
    });
    await repository.createInterest({
      supabaseUserId: "00000000-0000-4000-8000-000000000601",
      body: {
        targetUserId: "00000000-0000-4000-8000-000000000602",
        contentId: "00000000-0000-4000-8000-000000000603",
        action: "yes"
      },
      idempotencyKey: "mutual-interest-1",
      requestHash: "mutual-request-hash"
    });

    const combined = queries.join("\n");
    expect(combined.match(/private\.eligible_content/g)?.length).toBeGreaterThanOrEqual(2);
    expect(combined).toContain("from blocks b");
    expect(combined).toContain("target_public_profile.visibility = 'public'");
    expect(combined).toContain("target_age.result_over_threshold is true");
  });

  it("hides live rooms and chat authors across block and mute boundaries", async () => {
    const roomSql = recordingSql(() => []);
    const roomRepository = createLiveRoomRepositoryMethods(roomSql.sql);
    await roomRepository.findRoom({
      supabaseUserId: "00000000-0000-4000-8000-000000000611",
      roomId: "00000000-0000-4000-8000-000000000612"
    });

    const chatSql = recordingSql(() => []);
    const chatRepository = createLiveChatRepositoryMethods(chatSql.sql, async () => ({
      id: "00000000-0000-4000-8000-000000000612",
      title: "Room",
      creator: {
        id: "00000000-0000-4000-8000-000000000613",
        handle: "creator",
        displayName: "Creator",
        avatarUrl: null,
        badges: []
      },
      state: "live",
      safetyState: "monitoring",
      accessMode: "public",
      accessState: "allowed",
      playback: { state: "not_ready", url: null, provider: "livepeer" },
      previewSecondsRemaining: null,
      eventAccess: null,
      chat: { enabled: true, accessState: "allowed" },
      replayContentId: null,
      providerStreamId: null,
      providerPlaybackId: null,
      hostIngestUrl: null,
      hostStreamKey: null
    }));
    await chatRepository.listChatMessages({
      supabaseUserId: "00000000-0000-4000-8000-000000000611",
      roomId: "00000000-0000-4000-8000-000000000612"
    });

    expect(roomSql.queries.join("\n")).toContain("from blocks b");
    expect(roomSql.queries.join("\n")).toContain("creator.state = 'active'");
    expect(chatSql.queries.join("\n")).toContain("from blocks b");
    expect(chatSql.queries.join("\n")).toContain("from user_mutes mute");
  });
});

function recordingSql(resolveQuery: (query: string) => unknown[]) {
  const queries: string[] = [];
  const sql = (async (strings: TemplateStringsArray) => {
    const query = strings.join("?");
    queries.push(query);
    return resolveQuery(query);
  }) as unknown as postgres.Sql;
  sql.json = ((value: unknown) => value) as postgres.Sql["json"];
  return { sql, queries };
}
