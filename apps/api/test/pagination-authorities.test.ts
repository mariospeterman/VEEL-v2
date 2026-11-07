import { describe, expect, it, vi } from "vitest";
import {
  createEngagementCommentRepositoryMethods,
  engagementCommentsCursorScope
} from "../src/modules/engagement/engagement-comment-repository.js";
import {
  createEventAccessPassRepositoryMethods,
  eventAccessPassCursorScope
} from "../src/modules/event/event-access-pass-methods.js";
import {
  createPostgresMutualsRepository,
  mutualsFeedCursorScope,
  mutualsListCursorScope
} from "../src/modules/mutuals/mutuals-repository.js";
import {
  createPostgresNotificationRepository,
  notificationCursorScope
} from "../src/modules/notification/notification-repository.js";
import {
  createPostgresOrganizationRepository,
  organizationDashboardCursorScope
} from "../src/modules/organization/organization-repository.js";
import {
  bindCursorScope,
  decodeTimestampIdCursor
} from "../src/shared/keyset-pagination.js";
import type { PostgresSql } from "../src/shared/postgres.js";

const tiedAt = new Date("2026-11-04T12:30:00.000Z");
const ids = [uuidFor(3), uuidFor(2), uuidFor(1)];
const actorId = uuidFor(100);

describe("remaining compound pagination authorities", () => {
  it("uses the last visible comment and matches its timestamp/id ORDER BY", async () => {
    let query = "";
    const sql = vi.fn((strings: TemplateStringsArray) => {
      query = strings.join("?");
      return Promise.resolve(ids.map(commentRow));
    }) as unknown as PostgresSql;
    const repository = createEngagementCommentRepositoryMethods(sql);

    const page = await repository.listComments({
      supabaseUserId: actorId,
      contentId: uuidFor(101),
      limit: 2
    });

    expect(query).toContain("(c.created_at, c.id) <");
    expect(query).toContain("order by c.created_at desc, c.id desc");
    expect(page.items.map((item) => item.id)).toEqual(ids.slice(0, 2));
    expect(cursorId(engagementCommentsCursorScope(actorId, uuidFor(101)), page.nextCursor)).toBe(ids[1]);
  });

  it("uses the last visible notification and matches its timestamp/id ORDER BY", async () => {
    let query = "";
    const sql = vi.fn((strings: TemplateStringsArray) => {
      query = strings.join("?");
      return Promise.resolve(ids.map(notificationRow));
    }) as unknown as PostgresSql;
    const repository = createPostgresNotificationRepository(sql);

    const page = await repository.listNotifications({
      supabaseUserId: actorId,
      limit: 2
    });

    expect(query).toContain("(n.created_at, n.id) <");
    expect(query).toContain("order by n.created_at desc, n.id desc");
    expect(page.items.map((item) => item.id)).toEqual(ids.slice(0, 2));
    expect(cursorId(bindCursorScope(notificationCursorScope, {
      actor: actorId,
      sort: "created_at:desc,id:desc"
    }), page.nextCursor)).toBe(ids[1]);
  });

  it("uses the last visible Event Access pass and matches its timestamp/id ORDER BY", async () => {
    let query = "";
    const sql = vi.fn((strings: TemplateStringsArray) => {
      query = strings.join("?");
      return Promise.resolve(ids.map(accessPassRow));
    }) as unknown as PostgresSql;
    const repository = createEventAccessPassRepositoryMethods(
      sql,
      vi.fn(async () => null)
    );

    const page = await repository.listAccessPasses({
      supabaseUserId: actorId,
      limit: 2
    });

    expect(query).toContain("(te.created_at, te.id) <");
    expect(query).toContain("order by te.created_at desc, te.id desc");
    expect(page.items.map((item) => item.id)).toEqual(ids.slice(0, 2));
    expect(cursorId(bindCursorScope(eventAccessPassCursorScope, {
      actor: actorId,
      sort: "created_at:desc,id:desc"
    }), page.nextCursor)).toBe(ids[1]);
  });

  it("uses the last visible organization and matches its timestamp/id ORDER BY", async () => {
    let query = "";
    const sql = vi.fn((strings: TemplateStringsArray) => {
      query = strings.join("?");
      return Promise.resolve(ids.map(organizationRow));
    }) as unknown as PostgresSql;
    const repository = createPostgresOrganizationRepository(sql);

    const page = await repository.listMyDashboards({
      supabaseUserId: actorId,
      limit: 2
    });

    expect(query).toContain("(o.created_at, o.id) <");
    expect(query).toContain("order by o.created_at desc, o.id desc");
    expect(page.items.map((item) => item.organization.organizationId)).toEqual(ids.slice(0, 2));
    expect(cursorId(bindCursorScope(organizationDashboardCursorScope, {
      actor: actorId,
      membership_states: "active,invited",
      sort: "created_at:desc,id:desc"
    }), page.nextCursor)).toBe(ids[1]);
  });

  it("uses the last visible content and Mutual row for both Mutuals lists", async () => {
    const queries: string[] = [];
    const sql = vi.fn((strings: TemplateStringsArray) => {
      const query = strings.join("?");
      queries.push(query);
      if (query.includes("from content_items ci")) {
        return Promise.resolve(ids.map(mutualsFeedRow));
      }
      return Promise.resolve(ids.map(mutualRow));
    }) as unknown as PostgresSql;
    const repository = createPostgresMutualsRepository(sql);

    const feed = await repository.listFeed({
      supabaseUserId: actorId,
      limit: 2
    });
    const mutuals = await repository.listMutuals({
      supabaseUserId: actorId,
      limit: 2
    });

    expect(queries[0]).toContain("(ci.created_at, ci.id) <");
    expect(queries[0]).toContain("order by ci.created_at desc, ci.id desc");
    expect(queries[1]).toContain("(created_at, id) <");
    expect(queries[1]).toContain("order by created_at desc, id desc");
    expect(feed?.items.map((item) => item.contentId)).toEqual(ids.slice(0, 2));
    expect(mutuals.items.map((item) => item.id)).toEqual(ids.slice(0, 2));
    expect(cursorId(bindCursorScope(mutualsFeedCursorScope, {
      actor: actorId,
      sort: "created_at:desc,content_id:desc"
    }), feed?.nextCursor ?? null)).toBe(ids[1]);
    expect(cursorId(bindCursorScope(mutualsListCursorScope, {
      actor: actorId,
      sort: "created_at:desc,id:desc"
    }), mutuals.nextCursor)).toBe(ids[1]);
  });
});

function cursorId(scope: string, cursor: string | null | undefined): string | null {
  return decodeTimestampIdCursor(scope, cursor ?? undefined).id;
}

function commentRow(id: string) {
  return {
    id,
    body: `Comment ${id}`,
    moderation_state: "visible",
    parent_comment_id: null,
    created_at: tiedAt,
    author_id: uuidFor(200),
    handle: "creator",
    display_name: "Creator",
    avatar_url: null,
    liked: false,
    like_count: "0",
    reply_count: "0",
    mentions: []
  };
}

function notificationRow(id: string) {
  return {
    id,
    kind: "messages",
    title: "Notification",
    body: "Notification body",
    action_url: null,
    state: "unread",
    related_resource_type: null,
    related_resource_id: null,
    created_at: tiedAt,
    read_at: null
  };
}

function accessPassRow(id: string) {
  return {
    id,
    event_id: uuidFor(300),
    access_pass_type_id: uuidFor(301),
    holder_user_id: uuidFor(302),
    payment_intent_id: null,
    qr_token: `token-${id}`,
    state: "active",
    checked_in_at: null,
    created_at: tiedAt
  };
}

function organizationRow(id: string) {
  return {
    membership_id: uuidFor(400 + Number.parseInt(id.slice(-2), 16)),
    organization_id: id,
    name: `Organization ${id}`,
    state: "active",
    plan: "enterprise",
    kyb_state: "verified",
    verification_kyb_status: "valid",
    role: "owner",
    membership_state: "active",
    created_at: tiedAt,
    joined_at: tiedAt,
    member_count: 1,
    active_member_count: 1,
    tier_waiver_state: "active",
    has_enterprise_entitlement: true
  };
}

function mutualsFeedRow(id: string) {
  return {
    content_id: id,
    creator_user_id: uuidFor(500),
    handle: "creator",
    display_name: "Creator",
    avatar_url: null,
    title: "Mutuals content",
    media_type: "image",
    cover_asset_kind: "image",
    poster_url: null,
    created_at: tiedAt
  };
}

function mutualRow(id: string) {
  return {
    id,
    user_a_id: uuidFor(600),
    user_b_id: uuidFor(601),
    source_content_item_id: null,
    conversation_id: null,
    state: "active",
    stale_at: null,
    expires_at: null,
    created_at: tiedAt
  };
}

function uuidFor(value: number): string {
  return `00000000-0000-4000-8000-${value.toString(16).padStart(12, "0")}`;
}
