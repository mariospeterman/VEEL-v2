import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { bindCursorScope } from "../src/shared/keyset-pagination.js";
import { decodeFeedCursor } from "../src/modules/content/content-feed-cursor.js";
import { createPostgresContentRepository } from "../src/modules/content/content-repository.js";
import { createPostgresClient } from "../src/shared/postgres.js";
import { guardedIntegrationDatabaseUrl } from "./integration-database.js";

const enabled = ["1", "true"].includes(
  process.env.VEEL_ENABLE_REAL_API_INTEGRATION_TESTS ?? ""
);
const describeIntegration = enabled ? describe : describe.skip;

describeIntegration("chronological content feed against Postgres", () => {
  it("traverses beyond 512 with tied microseconds while reauthorizing each page", async () => {
    const databaseUrl = guardedIntegrationDatabaseUrl();
    const sql = createPostgresClient(databaseUrl);
    const repository = createPostgresContentRepository(sql);
    const viewerId = randomUUID();
    const creatorId = randomUUID();
    const newContentId = randomUUID();
    const suffix = viewerId.replaceAll("-", "").slice(0, 12);
    const contentIds = Array.from({ length: 520 }, () => randomUUID());

    try {
      await sql`
        insert into users (id, supabase_user_id, state)
        values
          (${viewerId}, ${viewerId}, 'active'),
          (${creatorId}, ${creatorId}, 'active')
      `;
      await sql`
        insert into profiles (user_id, handle, display_name, visibility)
        values (${creatorId}, ${`feed_keyset_${suffix}`}, 'Feed keyset creator', 'public')
      `;
      await sql`
        insert into verification_records (
          subject_type, subject_id, purpose, status, provider, provider_reference,
          method, threshold_age, result_over_threshold, assurance_level, verified_at, reusable
        ) values
          ('user', ${viewerId}, 'age_access', 'valid', 'internal',
            ${`feed-viewer-age-${suffix}`}, 'reusable_age', 18, true, 'high', now(), false),
          ('user', ${creatorId}, 'age_access', 'valid', 'internal',
            ${`feed-creator-age-${suffix}`}, 'reusable_age', 18, true, 'high', now(), false)
      `;
      await sql`
        insert into user_follows (follower_user_id, followed_user_id, state)
        values (${viewerId}, ${creatorId}, 'active')
      `;
      await sql.begin(async (transaction) => {
        await transaction`set local session_replication_role = replica`;
        await transaction`
          insert into content_items (
            id, creator_user_id, media_type, distribution_mode, state, visibility,
            nsfw_label, moderation_state, publish_state, published_at, created_at
          )
          select
            seeded.id,
            ${creatorId},
            'image',
            'post',
            'ready',
            'public',
            'none',
            'approved',
            'published',
            now() - interval '1 hour'
              - (floor((seeded.position - 1)::numeric / 2) * interval '1 microsecond'),
            now() - interval '2 hours'
          from unnest(${contentIds}::uuid[]) with ordinality as seeded(id, position)
        `;
      });

      const expectedRows = await sql<Array<{ id: string }>>`
        select id
        from content_items
        where id = any(${contentIds}::uuid[])
        order by published_at desc, id desc
      `;
      const expectedIds = expectedRows.map((row) => row.id);
      const revokedContentId = expectedIds[100]!;

      const firstPage = await repository.listHomeFeed({
        supabaseUserId: viewerId,
        mode: "following",
        surface: "home",
        limit: 100
      });
      expect(firstPage.items).toHaveLength(100);
      expect(firstPage.rankingVersion).toBe("chronological_v1");
      expect(firstPage.nextCursor).toEqual(expect.any(String));

      const scope = bindCursorScope("content:feed", {
        actor: viewerId,
        mode: "following",
        order: "published_at:desc,id:desc",
        surface: "home"
      });
      const decoded = decodeFeedCursor(firstPage.nextCursor!, scope);
      expect(decoded.upper.publishedAt).toMatch(/\.\d{6}Z$/);

      await sql.begin(async (transaction) => {
        await transaction`set local session_replication_role = replica`;
        await transaction`
          insert into content_items (
            id, creator_user_id, media_type, distribution_mode, state, visibility,
            nsfw_label, moderation_state, publish_state, published_at, created_at
          ) values (
            ${newContentId}, ${creatorId}, 'image', 'post', 'ready', 'public',
            'none', 'approved', 'published', now(), now()
          )
        `;
        await transaction`
          update content_items
          set publish_state = 'unpublished', updated_at = now()
          where id = ${revokedContentId}
        `;
      });

      const deliveredIds = firstPage.items.map((item) => item.id);
      let cursor = firstPage.nextCursor;
      while (cursor) {
        const page = await repository.listHomeFeed({
          supabaseUserId: viewerId,
          mode: "following",
          surface: "home",
          cursor,
          limit: 100
        });
        expect(page.generatedAt).toBe(firstPage.generatedAt);
        deliveredIds.push(...page.items.map((item) => item.id));
        cursor = page.nextCursor;
      }

      expect(deliveredIds).toEqual(expectedIds.filter((id) => id !== revokedContentId));
      expect(new Set(deliveredIds).size).toBe(deliveredIds.length);
      expect(deliveredIds).toHaveLength(519);
      expect(deliveredIds).not.toContain(newContentId);

      const refreshed = await repository.listHomeFeed({
        supabaseUserId: viewerId,
        mode: "following",
        surface: "home",
        limit: 20
      });
      expect(refreshed.items[0]?.id).toBe(newContentId);
    } finally {
      try {
        await sql.begin(async (transaction) => {
          await transaction`set local session_replication_role = replica`;
          await transaction`
            delete from content_items
            where id = any(${[...contentIds, newContentId]}::uuid[])
          `;
          await transaction`
            delete from user_follows
            where follower_user_id = ${viewerId} and followed_user_id = ${creatorId}
          `;
          await transaction`
            delete from verification_records
            where subject_type = 'user' and subject_id in (${viewerId}, ${creatorId})
          `;
          await transaction`delete from profiles where user_id = ${creatorId}`;
          await transaction`
            delete from user_social_counts where user_id in (${viewerId}, ${creatorId})
          `;
          await transaction`delete from users where id in (${viewerId}, ${creatorId})`;
        });
      } finally {
        await sql.end({ timeout: 5 });
      }
    }
  }, 60_000);
});
