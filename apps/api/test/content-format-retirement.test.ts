import type postgres from "postgres";
import { describe, expect, it, vi } from "vitest";
import {
  ContentFormatRetiredError,
  ContentPollVoteConflictError
} from "../src/modules/content/content-errors.js";
import { createContentDraftRepositoryMethods } from "../src/modules/content/content-draft-repository.js";
import { createContentPollRepositoryMethods } from "../src/modules/content/content-poll-repository.js";
import { createContentPublishRepositoryMethods } from "../src/modules/content/content-publish-repository.js";
import { createContentUpdateRepositoryMethods } from "../src/modules/content/content-update-repository.js";
import type { ContentItem, CreateContentDraftInput } from "../src/modules/content/types.js";
import { hashIdempotencyPayload } from "../src/shared/idempotency.js";
import type { PostgresTransaction } from "../src/shared/postgres.js";

const actorId = "00000000-0000-4000-8000-000000000001";
const contentId = "00000000-0000-4000-8000-000000000040";
const optionId = "00000000-0000-4000-8000-000000000041";

const legacyTextItem: ContentItem = {
  id: contentId,
  creator: {
    id: actorId,
    handle: "legacy_creator",
    displayName: "Legacy creator",
    avatarUrl: null,
    badges: []
  },
  mediaType: "text",
  distributionMode: "post",
  caption: "Historical text",
  bodyText: "Preserved historical body",
  compositionRevision: 0,
  posterUrl: null,
  playback: { state: "not_ready", url: null, provider: "none" },
  accessState: "free",
  nsfwLabel: "none",
  engagement: {
    liked: false,
    saved: false,
    likeCount: 0,
    commentCount: 0,
    shareCount: 0
  }
};

describe("retired content formats", () => {
  it.each(["text", "poll"] as const)("rejects a fresh %s draft after checking for a completed replay", async (mediaType) => {
    const queries: string[] = [];
    const transaction = transactionStub((query) => {
      queries.push(query);
      if (query.includes("from users")) return [{ id: actorId }];
      if (query.includes("select request_hash, response_body")) {
        return [{ request_hash: "request-hash", response_body: null }];
      }
      return [];
    });
    const repository = createContentDraftRepositoryMethods(sqlStub(transaction));

    await expect(repository.createDraft(draftInput(mediaType))).rejects.toBeInstanceOf(
      ContentFormatRetiredError
    );
    expect(queries.some((query) => query.includes("select count(*)"))).toBe(false);
    expect(queries.some((query) => query.includes("insert into content_items"))).toBe(false);
  });

  it("replays an exactly completed historical text draft before applying the retirement gate", async () => {
    const queries: string[] = [];
    const transaction = transactionStub((query) => {
      queries.push(query);
      if (query.includes("from users")) return [{ id: actorId }];
      if (query.includes("select request_hash, response_body")) {
        return [{ request_hash: "request-hash", response_body: { contentId } }];
      }
      if (query.includes("poll_projection.poll")) return [legacyContentRow()];
      return [];
    });
    const repository = createContentDraftRepositoryMethods(sqlStub(transaction));

    await expect(repository.createDraft(draftInput("text"))).resolves.toMatchObject({
      id: contentId,
      mediaType: "text",
      bodyText: "Preserved historical body"
    });
    expect(queries.some((query) => query.includes("select count(*)"))).toBe(false);
    expect(queries.some((query) => query.includes("insert into content_items"))).toBe(false);
  });

  it.each(["text", "poll"] as const)("rejects a fresh update of historical %s content", async (mediaType) => {
    const queries: string[] = [];
    const transaction = transactionStub((query) => {
      queries.push(query);
      if (query.includes("select id from users where supabase_user_id")) return [{ id: actorId }];
      if (query.includes("select request_hash, response_body from idempotency_keys")) {
        return [{ request_hash: "request-hash", response_body: null }];
      }
      if (query.includes("select media_type") && query.includes("from content_items")) {
        return [{ media_type: mediaType }];
      }
      return [];
    });
    const repository = createContentUpdateRepositoryMethods(sqlStub(transaction));

    await expect(repository.updateOwnedContent!(updateInput())).rejects.toBeInstanceOf(
      ContentFormatRetiredError
    );
    expect(queries.some((query) => query.includes("update content_items ci"))).toBe(false);
  });

  it("returns the stored response for an exactly completed historical update", async () => {
    const queries: string[] = [];
    const transaction = transactionStub((query) => {
      queries.push(query);
      if (query.includes("select id from users where supabase_user_id")) return [{ id: actorId }];
      if (query.includes("select request_hash, response_body from idempotency_keys")) {
        return [{ request_hash: "request-hash", response_body: { contentId, response: legacyTextItem } }];
      }
      return [];
    });
    const repository = createContentUpdateRepositoryMethods(sqlStub(transaction));

    await expect(repository.updateOwnedContent!(updateInput())).resolves.toEqual(legacyTextItem);
    expect(queries.some((query) => query.includes("select media_type"))).toBe(false);
    expect(queries.some((query) => query.includes("update content_items ci"))).toBe(false);
  });

  it.each(["text", "poll"] as const)("rejects a fresh publish of historical %s content", async (mediaType) => {
    const queries: string[] = [];
    const transaction = transactionStub((query) => {
      queries.push(query);
      if (query.includes("select ci.id, u.id as actor_user_id")) {
        return [{ id: contentId, actor_user_id: actorId, media_type: mediaType }];
      }
      if (query.includes("from mutation_command_receipts")) return [];
      return [];
    });
    const repository = createContentPublishRepositoryMethods(sqlStub(transaction));

    await expect(repository.publishOwnedContent!(publishInput())).rejects.toBeInstanceOf(
      ContentFormatRetiredError
    );
    expect(queries.some((query) => query.includes("with actor as"))).toBe(false);
  });

  it("returns the stored response for an exactly completed historical publish", async () => {
    const queries: string[] = [];
    const input = publishInput();
    const transaction = transactionStub((query) => {
      queries.push(query);
      if (query.includes("select ci.id, u.id as actor_user_id")) {
        return [{ id: contentId, actor_user_id: actorId, media_type: "text" }];
      }
      if (query.includes("from mutation_command_receipts")) {
        return [{
          target_type: "content",
          target_id: contentId,
          request_version: 1,
          request_body_hash: hashIdempotencyPayload({
            contentId,
            scheduledFor: null,
            scheduledForProvided: false,
            requestHash: input.requestHash
          }),
          response_status: 200,
          response_body: legacyTextItem
        }];
      }
      return [];
    });
    const repository = createContentPublishRepositoryMethods(sqlStub(transaction));

    await expect(repository.publishOwnedContent!(input)).resolves.toEqual(legacyTextItem);
    expect(queries.some((query) => query.includes("with actor as"))).toBe(false);
  });

  it("rejects a fresh poll vote but replays an exactly completed historical vote", async () => {
    let completed = false;
    const queries: string[] = [];
    const transaction = transactionStub((query) => {
      queries.push(query);
      if (query.includes("select request_hash, response_body from idempotency_keys")) {
        return [{
          request_hash: "request-hash",
          response_body: completed ? { contentId, optionId } : null
        }];
      }
      if (query.includes("select jsonb_build_object")) {
        return [{
          poll: {
            question: "Historical poll",
            options: [{ id: optionId, position: 0, text: "Yes", voteCount: 1 }],
            state: "closed",
            totalVoteCount: 1,
            closesAt: null,
            viewerOptionId: optionId
          }
        }];
      }
      return [];
    });
    const repository = createContentPollRepositoryMethods(sqlStub(transaction));
    const input = {
      appUserId: actorId,
      contentId,
      optionId,
      idempotencyKey: "poll-vote-key",
      requestHash: "request-hash"
    };

    await expect(repository.voteOnPoll!(input)).rejects.toBeInstanceOf(ContentFormatRetiredError);
    completed = true;
    await expect(repository.voteOnPoll!(input)).resolves.toMatchObject({
      question: "Historical poll",
      viewerOptionId: optionId
    });
    expect(queries.some((query) => query.includes("insert into content_poll_votes"))).toBe(false);
    expect(queries.some((query) => query.includes("from private.eligible_content"))).toBe(true);
  });

  it("does not reveal the current poll projection when a completed replay is no longer eligible", async () => {
    const queries: string[] = [];
    const transaction = transactionStub((query) => {
      queries.push(query);
      if (query.includes("select request_hash, response_body from idempotency_keys")) {
        return [{
          request_hash: "request-hash",
          response_body: { contentId, optionId }
        }];
      }
      if (query.includes("select jsonb_build_object")) return [];
      return [];
    });
    const repository = createContentPollRepositoryMethods(sqlStub(transaction));

    await expect(repository.voteOnPoll!({
      appUserId: actorId,
      contentId,
      optionId,
      idempotencyKey: "poll-vote-key",
      requestHash: "request-hash"
    })).resolves.toBeNull();

    expect(queries.some((query) => query.includes("from private.eligible_content"))).toBe(true);
    expect(queries.some((query) => query.includes("insert into content_poll_votes"))).toBe(false);
  });

  it("keeps changed-request poll receipt reuse as an idempotency conflict", async () => {
    const transaction = transactionStub((query) => {
      if (query.includes("select request_hash, response_body from idempotency_keys")) {
        return [{ request_hash: "original-hash", response_body: { contentId, optionId } }];
      }
      return [];
    });
    const repository = createContentPollRepositoryMethods(sqlStub(transaction));

    await expect(repository.voteOnPoll!({
      appUserId: actorId,
      contentId,
      optionId,
      idempotencyKey: "poll-vote-key",
      requestHash: "changed-hash"
    })).rejects.toBeInstanceOf(ContentPollVoteConflictError);
  });
});

function transactionStub(
  resolve: (query: string, values: unknown[]) => unknown[]
): PostgresTransaction {
  const transaction = vi.fn((strings: TemplateStringsArray, ...values: unknown[]) =>
    Promise.resolve(resolve(strings.join("?"), values))) as unknown as PostgresTransaction;
  transaction.json = ((value: unknown) => value) as PostgresTransaction["json"];
  return transaction;
}

function sqlStub(transaction: PostgresTransaction): postgres.Sql {
  return {
    begin: vi.fn(async (work: (tx: PostgresTransaction) => Promise<unknown>) => work(transaction))
  } as unknown as postgres.Sql;
}

function draftInput(mediaType: "text" | "poll"): CreateContentDraftInput {
  return {
    supabaseUserId: actorId,
    idempotencyKey: "draft-key",
    requestHash: "request-hash",
    mediaType,
    caption: "Historical format",
    ...(mediaType === "text"
      ? { bodyText: "Preserved historical body" }
      : { poll: { question: "Historical poll", options: ["Yes", "No"], closesAt: null } }),
    visibility: "private",
    nsfwLabel: "none",
    representationMode: "no_real_person",
    contentSafetyPolicyAccepted: true,
    quotaWindowStart: new Date("2026-01-01T00:00:00.000Z"),
    dailyDraftQuota: 20
  };
}

function updateInput() {
  return {
    supabaseUserId: actorId,
    contentId,
    idempotencyKey: "update-key",
    requestHash: "request-hash",
    caption: "Changed historical content",
    captionProvided: true,
    bodyTextProvided: false,
    scheduledForProvided: false,
    contentSafetyPolicyAccepted: false,
    teaserStartMsProvided: false,
    teaserEndMsProvided: false,
    thumbnailFrameMsProvided: false,
    eventDraftProvided: false
  };
}

function publishInput() {
  return {
    supabaseUserId: actorId,
    contentId,
    idempotencyKey: "publish-key",
    requestHash: "request-hash",
    scheduledFor: null,
    scheduledForProvided: false
  };
}

function legacyContentRow() {
  return {
    id: contentId,
    media_type: "text" as const,
    distribution_mode: "post" as const,
    expires_at: null,
    scheduled_for: null,
    caption: "Historical text",
    body_text: "Preserved historical body",
    asset_revision: 0,
    nsfw_label: "none" as const,
    creator_id: actorId,
    handle: "legacy_creator",
    display_name: "Legacy creator",
    avatar_url: null,
    poll: null
  };
}
