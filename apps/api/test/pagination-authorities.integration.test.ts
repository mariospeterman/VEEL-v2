import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createEngagementCommentRepositoryMethods } from "../src/modules/engagement/engagement-comment-repository.js";
import { createEventAccessPassRepositoryMethods } from "../src/modules/event/event-access-pass-methods.js";
import { createPostgresMutualsRepository } from "../src/modules/mutuals/mutuals-repository.js";
import { createPostgresNotificationRepository } from "../src/modules/notification/notification-repository.js";
import { createPostgresOrganizationRepository } from "../src/modules/organization/organization-repository.js";
import { createPostgresClient, type PostgresSql } from "../src/shared/postgres.js";
import { guardedIntegrationDatabaseUrl } from "./integration-database.js";

const enabled = ["1", "true"].includes(
  process.env.VEEL_ENABLE_REAL_API_INTEGRATION_TESTS ?? ""
);
const describeIntegration = enabled ? describe : describe.skip;

describeIntegration("compound collection pagination against migrated Postgres", () => {
  it("walks every tied timestamp once across social, notification, access, org, and Mutuals reads", async () => {
    const sql = createPostgresClient(guardedIntegrationDatabaseUrl());
    const fixture = createFixture();
    const rollback = new Error("ROLLBACK_PAGINATION_FIXTURE");

    try {
      await sql.begin(async (transaction) => {
        const tx = transaction as unknown as PostgresSql;
        await seedFixture(tx, fixture);

        const comments = createEngagementCommentRepositoryMethods(tx);
        const notifications = createPostgresNotificationRepository(tx);
        const accessPasses = createEventAccessPassRepositoryMethods(
          tx,
          async () => null
        );
        const organizations = createPostgresOrganizationRepository(tx);
        const mutuals = createPostgresMutualsRepository(tx);

        const commentPages = await collectPages((cursor) => comments.listComments({
          supabaseUserId: fixture.actorSupabaseId,
          contentId: fixture.contentIds[0]!,
          limit: 2,
          ...(cursor ? { cursor } : {})
        }));
        const notificationPages = await collectPages((cursor) => notifications.listNotifications({
          supabaseUserId: fixture.actorSupabaseId,
          limit: 2,
          ...(cursor ? { cursor } : {})
        }));
        const accessPassPages = await collectPages((cursor) => accessPasses.listAccessPasses({
          supabaseUserId: fixture.actorSupabaseId,
          limit: 2,
          ...(cursor ? { cursor } : {})
        }));
        const organizationPages = await collectPages((cursor) => organizations.listMyDashboards({
          supabaseUserId: fixture.actorSupabaseId,
          limit: 2,
          ...(cursor ? { cursor } : {})
        }));
        const feedPages = await collectPages(async (cursor) => {
          const page = await mutuals.listFeed({
            supabaseUserId: fixture.actorSupabaseId,
            limit: 2,
            ...(cursor ? { cursor } : {})
          });
          if (!page) throw new Error("Expected an active Mutuals feed");
          return page;
        });
        const mutualPages = await collectPages((cursor) => mutuals.listMutuals({
          supabaseUserId: fixture.actorSupabaseId,
          limit: 2,
          ...(cursor ? { cursor } : {})
        }));

        expectPageWalk(commentPages, fixture.commentIds, (item) => item.id);
        expectPageWalk(notificationPages, fixture.notificationIds, (item) => item.id);
        expectPageWalk(accessPassPages, fixture.accessPassIds, (item) => item.id);
        expectPageWalk(
          organizationPages,
          fixture.organizationIds,
          (item) => item.organization.organizationId
        );
        expectPageWalk(feedPages, fixture.contentIds, (item) => item.contentId);
        expectPageWalk(mutualPages, fixture.mutualIds, (item) => item.id);

        throw rollback;
      });
    } catch (error) {
      if (error !== rollback) throw error;
    } finally {
      await sql.end({ timeout: 5 });
    }
  });
});

interface Fixture {
  actorId: string;
  actorSupabaseId: string;
  creatorId: string;
  creatorSupabaseId: string;
  counterpartIds: string[];
  contentIds: string[];
  mediaAssetIds: string[];
  commentIds: string[];
  notificationIds: string[];
  eventId: string;
  accessPassTypeId: string;
  accessPassIds: string[];
  organizationIds: string[];
  organizationMembershipIds: string[];
  mutualIds: string[];
  createdAt: Date;
}

function createFixture(): Fixture {
  const actorId = randomUUID();
  const creatorId = randomUUID();
  return {
    actorId,
    actorSupabaseId: actorId,
    creatorId,
    creatorSupabaseId: creatorId,
    counterpartIds: Array.from({ length: 5 }, () => randomUUID()),
    contentIds: Array.from({ length: 5 }, () => randomUUID()),
    mediaAssetIds: Array.from({ length: 5 }, () => randomUUID()),
    commentIds: Array.from({ length: 5 }, () => randomUUID()),
    notificationIds: Array.from({ length: 5 }, () => randomUUID()),
    eventId: randomUUID(),
    accessPassTypeId: randomUUID(),
    accessPassIds: Array.from({ length: 5 }, () => randomUUID()),
    organizationIds: Array.from({ length: 5 }, () => randomUUID()),
    organizationMembershipIds: Array.from({ length: 5 }, () => randomUUID()),
    mutualIds: Array.from({ length: 5 }, () => randomUUID()),
    createdAt: new Date("2026-11-04T12:30:00.000Z")
  };
}

async function seedFixture(sql: PostgresSql, fixture: Fixture): Promise<void> {
  const suffix = fixture.actorId.replaceAll("-", "").slice(0, 12);
  const users = [
    { id: fixture.actorId, supabase_user_id: fixture.actorSupabaseId, state: "active" },
    { id: fixture.creatorId, supabase_user_id: fixture.creatorSupabaseId, state: "active" },
    ...fixture.counterpartIds.map((id) => ({ id, supabase_user_id: id, state: "active" }))
  ];
  await sql`insert into users ${sql(users, "id", "supabase_user_id", "state")}`;
  await sql`
    insert into profiles (user_id, handle, display_name, visibility)
    values
      (${fixture.actorId}, ${`page_actor_${suffix}`}, 'Page actor', 'public'),
      (${fixture.creatorId}, ${`page_creator_${suffix}`}, 'Page creator', 'public')
  `;
  await sql`
    insert into verification_records (
      subject_type, subject_id, purpose, status, provider, provider_reference,
      method, threshold_age, result_over_threshold, assurance_level, verified_at, reusable
    ) values
      ('user', ${fixture.actorId}, 'age_access', 'valid', 'internal',
        ${`page-actor-age-${suffix}`}, 'reusable_age', 18, true, 'high', now(), false),
      ('user', ${fixture.creatorId}, 'age_access', 'valid', 'internal',
        ${`page-creator-age-${suffix}`}, 'reusable_age', 18, true, 'high', now(), false)
  `;
  await sql`
    insert into mutual_profiles (user_id, enabled, consent_version, visible_on_media, safety_state)
    values
      (${fixture.actorId}, true, 'pagination-v1', true, 'clear'),
      (${fixture.creatorId}, true, 'pagination-v1', true, 'clear')
  `;
  await sql`
    insert into viewer_hidden_creators (
      user_id, creator_user_id, idempotency_key, created_at
    )
    select
      ${fixture.actorId},
      candidate.user_id,
      ${`pagination-hidden-${suffix}-`} || candidate.user_id::text,
      ${fixture.createdAt}
    from mutual_profiles candidate
    where candidate.user_id not in (${fixture.actorId}, ${fixture.creatorId})
  `;

  const content = fixture.contentIds.map((id, index) => ({
    id,
    creator_user_id: fixture.creatorId,
    media_type: "image",
    state: "draft",
    visibility: "public",
    nsfw_label: "none",
    moderation_state: "pending",
    publish_state: "draft",
    caption: `Pagination content ${index}`,
    created_at: fixture.createdAt,
    updated_at: fixture.createdAt
  }));
  await sql`
    insert into content_items ${sql(
      content,
      "id",
      "creator_user_id",
      "media_type",
      "state",
      "visibility",
      "nsfw_label",
      "moderation_state",
      "publish_state",
      "caption",
      "created_at",
      "updated_at"
    )}
  `;
  const media = fixture.mediaAssetIds.map((id, index) => ({
    id,
    content_item_id: fixture.contentIds[index],
    provider: "bunny",
    provider_asset_id: `pagination-image-${suffix}-${index}`,
    provider_state: "ready",
    poster_url: `https://cdn.example.invalid/pagination-${suffix}-${index}.webp`,
    asset_kind: "image",
    position: 0,
    is_cover: true,
    provider_playable: true,
    ready_at: fixture.createdAt,
    created_at: fixture.createdAt
  }));
  await sql`
    insert into media_assets ${sql(
      media,
      "id",
      "content_item_id",
      "provider",
      "provider_asset_id",
      "provider_state",
      "poster_url",
      "asset_kind",
      "position",
      "is_cover",
      "provider_playable",
      "ready_at",
      "created_at"
    )}
  `;

  const safetyCases = fixture.contentIds.map((contentItemId) => ({
    id: randomUUID(),
    content_item_id: contentItemId,
    declared_rating: "none",
    state: "review_required",
    policy_version: "pagination-v1",
    provider_release_allowed: false,
    created_at: fixture.createdAt,
    updated_at: fixture.createdAt
  }));
  await sql`
    insert into media_safety_cases ${sql(
      safetyCases,
      "id",
      "content_item_id",
      "declared_rating",
      "state",
      "policy_version",
      "provider_release_allowed",
      "created_at",
      "updated_at"
    )}
  `;

  const evidenceKinds = [
    { scanType: "container_integrity", provider: "bunny_stream", model: null },
    { scanType: "malware", provider: "bunny_shield", model: null },
    { scanType: "known_hash", provider: "bunny_shield", model: null },
    { scanType: "content_classification", provider: "internal", model: "pagination-v1" },
    { scanType: "manual_review", provider: "internal", model: "pagination-v1" }
  ];
  const scanEvents = safetyCases.flatMap((safetyCase, contentIndex) =>
    evidenceKinds.map((evidence) => ({
      id: randomUUID(),
      media_safety_case_id: safetyCase.id,
      media_asset_id: fixture.mediaAssetIds[contentIndex],
      provider: evidence.provider,
      provider_event_id:
        `pagination-${suffix}-${contentIndex}-${evidence.scanType}`,
      scan_type: evidence.scanType,
      normalized_signal: "clear",
      payload_hash: "a".repeat(64),
      model_or_ruleset_version: evidence.model,
      release_eligible: true,
      observed_at: fixture.createdAt,
      created_at: fixture.createdAt
    }))
  );
  await sql`
    insert into provider_media_scan_events ${sql(
      scanEvents,
      "id",
      "media_safety_case_id",
      "media_asset_id",
      "provider",
      "provider_event_id",
      "scan_type",
      "normalized_signal",
      "payload_hash",
      "model_or_ruleset_version",
      "release_eligible",
      "observed_at",
      "created_at"
    )}
  `;

  for (const safetyCase of safetyCases) {
    await sql`
      update media_safety_cases
      set
        state = 'approved',
        decision_source = 'staff',
        reason_code = 'pagination_fixture_release',
        provider_release_allowed = true,
        reviewed_by_user_id = ${fixture.actorId},
        decided_at = ${fixture.createdAt},
        updated_at = ${fixture.createdAt}
      where id = ${safetyCase.id}
    `;
  }
  for (const [index, contentId] of fixture.contentIds.entries()) {
    await sql`
      update content_items
      set
        release_media_asset_id = ${fixture.mediaAssetIds[index]!},
        state = 'ready',
        moderation_state = 'approved',
        publish_state = 'published',
        published_at = coalesce(published_at, ${fixture.createdAt}),
        updated_at = ${fixture.createdAt}
      where id = ${contentId}
    `;
  }

  const comments = fixture.commentIds.map((id, index) => ({
    id,
    content_item_id: fixture.contentIds[0],
    user_id: fixture.creatorId,
    body: `Pagination comment ${index}`,
    moderation_state: "visible",
    idempotency_key: `pagination-comment-${suffix}-${index}`,
    created_at: fixture.createdAt,
    updated_at: fixture.createdAt
  }));
  await sql`
    insert into comments ${sql(
      comments,
      "id",
      "content_item_id",
      "user_id",
      "body",
      "moderation_state",
      "idempotency_key",
      "created_at",
      "updated_at"
    )}
  `;

  const notifications = fixture.notificationIds.map((id, index) => ({
    id,
    user_id: fixture.actorId,
    kind: "message",
    title: `Pagination notification ${index}`,
    body: "Pagination body",
    state: "unread",
    idempotency_key: `pagination-notification-${suffix}-${index}`,
    created_at: fixture.createdAt
  }));
  await sql`
    insert into notifications ${sql(
      notifications,
      "id",
      "user_id",
      "kind",
      "title",
      "body",
      "state",
      "idempotency_key",
      "created_at"
    )}
  `;

  await sql`
    insert into events (
      id, creator_user_id, title, starts_at, event_type, location_type,
      access_rule, state, idempotency_key, request_hash, created_at, updated_at
    ) values (
      ${fixture.eventId}, ${fixture.creatorId}, 'Pagination event', now() + interval '7 days',
      'physical', 'physical', 'public_sale', 'published',
      ${`pagination-event-${suffix}`}, ${"a".repeat(64)}, ${fixture.createdAt}, ${fixture.createdAt}
    )
  `;
  await sql`
    insert into event_access_pass_types (id, event_id, label, capacity, created_at)
    values (${fixture.accessPassTypeId}, ${fixture.eventId}, 'Pagination pass', 20, ${fixture.createdAt})
  `;
  const passes = fixture.accessPassIds.map((id, index) => ({
    id,
    event_id: fixture.eventId,
    access_pass_type_id: fixture.accessPassTypeId,
    holder_user_id: fixture.actorId,
    qr_token: `pagination-token-${suffix}-${index}`,
    qr_token_hash: `pagination-hash-${suffix}-${index}`,
    created_at: fixture.createdAt
  }));
  await sql`
    insert into event_access_passes ${sql(
      passes,
      "id",
      "event_id",
      "access_pass_type_id",
      "holder_user_id",
      "qr_token",
      "qr_token_hash",
      "created_at"
    )}
  `;

  const organizations = fixture.organizationIds.map((id, index) => ({
    id,
    name: `Pagination organization ${suffix} ${index}`,
    state: "active",
    plan: "enterprise",
    kyb_state: "verified",
    created_at: fixture.createdAt
  }));
  await sql`
    insert into organizations ${sql(
      organizations,
      "id",
      "name",
      "state",
      "plan",
      "kyb_state",
      "created_at"
    )}
  `;
  const memberships = fixture.organizationMembershipIds.map((id, index) => ({
    id,
    organization_id: fixture.organizationIds[index],
    user_id: fixture.actorId,
    role: "owner",
    state: "active",
    joined_at: fixture.createdAt,
    created_at: fixture.createdAt,
    updated_at: fixture.createdAt
  }));
  await sql`
    insert into organization_memberships ${sql(
      memberships,
      "id",
      "organization_id",
      "user_id",
      "role",
      "state",
      "joined_at",
      "created_at",
      "updated_at"
    )}
  `;

  const mutualRows = fixture.mutualIds.map((id, index) => {
    const counterpartId = fixture.counterpartIds[index]!;
    const [userAId, userBId] = [fixture.actorId, counterpartId].sort();
    return {
      id,
      user_a_id: userAId,
      user_b_id: userBId,
      state: "active",
      created_at: fixture.createdAt,
      updated_at: fixture.createdAt
    };
  });
  await sql`
    insert into mutuals ${sql(
      mutualRows,
      "id",
      "user_a_id",
      "user_b_id",
      "state",
      "created_at",
      "updated_at"
    )}
  `;
}

async function collectPages<Item>(
  load: (cursor?: string) => Promise<{ items: Item[]; nextCursor?: string | null }>
): Promise<Item[][]> {
  const pages: Item[][] = [];
  let cursor: string | undefined;
  do {
    const page = await load(cursor);
    pages.push(page.items);
    cursor = page.nextCursor ?? undefined;
  } while (cursor);
  return pages;
}

function expectPageWalk<Item>(
  pages: Item[][],
  expectedIds: string[],
  id: (item: Item) => string
): void {
  expect(pages.map((page) => page.length)).toEqual([2, 2, 1]);
  const actualIds = pages.flat().map(id);
  expect(new Set(actualIds)).toEqual(new Set(expectedIds));
  expect(new Set(actualIds)).toHaveLength(expectedIds.length);
}
