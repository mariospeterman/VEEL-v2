import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { decodeFeedCursor } from "../src/modules/content/content-feed-cursor.js";
import { createPostgresContentRepository } from "../src/modules/content/content-repository.js";
import { createPostgresClient } from "../src/shared/postgres.js";
import { guardedIntegrationDatabaseUrl } from "./integration-database.js";

const enabled = ["1", "true"].includes(
  process.env.VEEL_ENABLE_REAL_API_INTEGRATION_TESTS ?? ""
);
const describeIntegration = enabled ? describe : describe.skip;

describeIntegration("bounded feed ranking sessions against Postgres", () => {
  it("keeps pagination stable across engagement changes and reauthorizes before delivery", async () => {
    const databaseUrl = guardedIntegrationDatabaseUrl();
    const sql = createPostgresClient(databaseUrl);
    const repository = createPostgresContentRepository(sql);
    const viewerId = randomUUID();
    const creatorId = randomUUID();
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
        values (${creatorId}, ${`feed_session_${suffix}`}, 'Feed session creator', 'public')
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
            id, creator_user_id, media_type, state, visibility, nsfw_label,
            moderation_state, publish_state, published_at, created_at
          )
          select
            seeded.id, ${creatorId}, 'image', 'ready', 'public', 'none',
            'approved', 'published', now(),
            now() - (seeded.position::integer * interval '1 minute')
          from unnest(${contentIds}::uuid[]) with ordinality as seeded(id, position)
        `;
      });
      await sql`
        insert into content_engagement_counters (content_item_id)
        select id
        from content_items
        where id in ${sql(contentIds)}
        on conflict (content_item_id) do nothing
      `;

      const firstPage = await repository.listHomeFeed({
        supabaseUserId: viewerId,
        mode: "following",
        surface: "home",
        limit: 20
      });
      expect(firstPage.items).toHaveLength(20);
      expect(firstPage.nextCursor).toEqual(expect.any(String));

      const cursor = decodeFeedCursor(firstPage.nextCursor!);
      const sessions = await sql<Array<{
        candidate_count: number;
        ttl_seconds: number;
        ranked_content_ids: string[];
      }>>`
        select
          cardinality(ranked_content_ids)::integer as candidate_count,
          extract(epoch from (expires_at - as_of))::integer as ttl_seconds,
          ranked_content_ids
        from feed_ranking_sessions
        where id = ${cursor.sessionId}
          and viewer_user_id = ${viewerId}
      `;
      expect(sessions[0]).toMatchObject({ candidate_count: 512, ttl_seconds: 1800 });

      const firstPageIds = new Set(firstPage.items.map((item) => item.id));
      const revokedContentId = sessions[0]?.ranked_content_ids.find(
        (contentId) => !firstPageIds.has(contentId)
      );
      expect(revokedContentId).toEqual(expect.any(String));

      await sql`
        update content_engagement_counters
        set like_count = like_count + 100, updated_at = now()
        where content_item_id = ${contentIds[0]!}
      `;
      await sql`
        update content_items
        set publish_state = 'unpublished', updated_at = now()
        where id = ${revokedContentId!}
      `;

      const secondPage = await repository.listHomeFeed({
        supabaseUserId: viewerId,
        mode: "following",
        surface: "home",
        cursor: firstPage.nextCursor!,
        limit: 20
      });
      expect(secondPage.items.some((item) => firstPageIds.has(item.id))).toBe(false);
      expect(secondPage.items.map((item) => item.id)).not.toContain(revokedContentId);
      expect(secondPage.generatedAt).toBe(firstPage.generatedAt);
    } finally {
      try {
        await sql.begin(async (transaction) => {
          await transaction`set local session_replication_role = replica`;
          await transaction`delete from feed_ranking_sessions where viewer_user_id = ${viewerId}`;
          await transaction`
            delete from content_engagement_counters
            where content_item_id = any(${contentIds}::uuid[])
          `;
          await transaction`delete from content_items where id = any(${contentIds}::uuid[])`;
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
