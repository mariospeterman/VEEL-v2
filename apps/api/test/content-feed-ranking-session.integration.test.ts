import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { bindCursorScope } from "../src/shared/keyset-pagination.js";
import { cursorTimestamp } from "../src/shared/database-timestamp.js";
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

  it("advances across a fully denied candidate batch without skipping later eligible content", async () => {
    const databaseUrl = guardedIntegrationDatabaseUrl();
    const sql = createPostgresClient(databaseUrl);
    const repository = createPostgresContentRepository(sql);
    const viewerId = randomUUID();
    const creatorId = randomUUID();
    const eligibleContentId = randomUUID();
    const deniedContentIds = Array.from({ length: 128 }, () => randomUUID());
    const suffix = viewerId.replaceAll("-", "").slice(0, 12);

    try {
      await sql`
        insert into users (id, supabase_user_id, state)
        values
          (${viewerId}, ${viewerId}, 'active'),
          (${creatorId}, ${creatorId}, 'active')
      `;
      await sql`
        insert into profiles (user_id, handle, display_name, visibility)
        values (${creatorId}, ${`feed_denied_${suffix}`}, 'Feed denied creator', 'public')
      `;
      await sql`
        insert into verification_records (
          subject_type, subject_id, purpose, status, provider, provider_reference,
          method, threshold_age, result_over_threshold, assurance_level, verified_at, reusable
        ) values
          ('user', ${viewerId}, 'age_access', 'valid', 'internal',
            ${`feed-denied-viewer-age-${suffix}`}, 'reusable_age', 18, true, 'high', now(), false),
          ('user', ${creatorId}, 'age_access', 'valid', 'internal',
            ${`feed-denied-creator-age-${suffix}`}, 'reusable_age', 18, true, 'high', now(), false)
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
            'subscribers',
            'none',
            'approved',
            'published',
            now() - (seeded.position * interval '1 microsecond'),
            now() - interval '2 hours'
          from unnest(${deniedContentIds}::uuid[]) with ordinality as seeded(id, position)
        `;
        await transaction`
          insert into content_items (
            id, creator_user_id, media_type, distribution_mode, state, visibility,
            nsfw_label, moderation_state, publish_state, published_at, created_at
          ) values (
            ${eligibleContentId}, ${creatorId}, 'image', 'post', 'ready', 'public',
            'none', 'approved', 'published', now() - interval '1 hour', now() - interval '2 hours'
          )
        `;
      });

      const deniedPage = await repository.listHomeFeed({
        supabaseUserId: viewerId,
        mode: "following",
        surface: "home",
        limit: 20
      });
      expect(deniedPage.items).toEqual([]);
      expect(deniedPage.nextCursor).toEqual(expect.any(String));

      const eligiblePage = await repository.listHomeFeed({
        supabaseUserId: viewerId,
        mode: "following",
        surface: "home",
        cursor: deniedPage.nextCursor!,
        limit: 20
      });
      expect(eligiblePage.items.map((item) => item.id)).toEqual([eligibleContentId]);
      expect(eligiblePage.nextCursor).toBeNull();
      expect(eligiblePage.generatedAt).toBe(deniedPage.generatedAt);
    } finally {
      try {
        await sql.begin(async (transaction) => {
          await transaction`set local session_replication_role = replica`;
          await transaction`
            delete from content_items
            where id = any(${[...deniedContentIds, eligibleContentId]}::uuid[])
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

  it("keeps cursor tuple bounds on the chronological index in a generic prepared plan", async () => {
    const databaseUrl = guardedIntegrationDatabaseUrl();
    const sql = createPostgresClient(databaseUrl);
    const creatorId = randomUUID();
    const suffix = creatorId.replaceAll("-", "").slice(0, 12);
    const contentIds = Array.from({ length: 128 }, () => randomUUID());

    try {
      await sql`
        insert into users (id, supabase_user_id, state)
        values (${creatorId}, ${creatorId}, 'active')
      `;
      await sql`
        insert into profiles (user_id, handle, display_name, visibility)
        values (${creatorId}, ${`feed_plan_${suffix}`}, 'Feed plan creator', 'public')
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
            now() - (seeded.position * interval '1 microsecond'),
            now() - interval '2 hours'
          from unnest(${contentIds}::uuid[]) with ordinality as seeded(id, position)
        `;
      });

      const ordered = await sql<Array<{ id: string; published_at: Date }>>`
        select id, published_at
        from content_items
        where state = 'ready'
          and publish_state = 'published'
          and moderation_state = 'approved'
          and published_at is not null
          and published_at <= now()
          and distribution_mode = 'post'
          and media_type not in ('text', 'poll')
        order by published_at desc, id desc
      `;
      const upper = ordered[0]!;
      const after = ordered[40]!;
      const expectedIds = ordered.slice(41, 61).map((row) => row.id);
      const executeArguments = [
        `'${cursorTimestamp(upper.published_at)}'::timestamptz`,
        `'${upper.id}'::uuid`,
        `'${cursorTimestamp(after.published_at)}'::timestamptz`,
        `'${after.id}'::uuid`,
        "20::integer"
      ].join(", ");

      const proof = await sql.begin(async (transaction) => {
        await transaction`set local plan_cache_mode = force_generic_plan`;
        await transaction`set local enable_seqscan = off`;
        await transaction`set local enable_bitmapscan = off`;
        await transaction.unsafe(`
          prepare content_feed_cursor_generic_plan (
            timestamptz, uuid, timestamptz, uuid, integer
          ) as
          select content.id, content.published_at
          from content_items content
          where content.state = 'ready'
            and content.publish_state = 'published'
            and content.moderation_state = 'approved'
            and content.published_at is not null
            and content.published_at <= now()
            and content.distribution_mode = 'post'
            and content.media_type not in ('text', 'poll')
            and (content.published_at, content.id) <= ($1, $2)
            and (content.published_at, content.id) < ($3, $4)
          order by content.published_at desc, content.id desc
          limit $5
        `);

        // Values are generated UUIDs and canonical database timestamps; PREPARE's EXECUTE
        // grammar cannot infer extended-query placeholders at this call site.
        const plan = await transaction.unsafe<Array<{ "QUERY PLAN": string }>>(
          `explain (analyze, buffers, format text)
           execute content_feed_cursor_generic_plan(${executeArguments})`
        );
        const rows = await transaction.unsafe<Array<{ id: string }>>(
          `execute content_feed_cursor_generic_plan(${executeArguments})`
        );
        await transaction.unsafe("deallocate content_feed_cursor_generic_plan");

        return {
          ids: rows.map((row) => row.id),
          plan: plan.map((row) => row["QUERY PLAN"]).join("\n")
        };
      });

      expect(proof.ids).toEqual(expectedIds);
      expect(proof.ids).not.toContain(after.id);
      expect(proof.plan).toMatch(/Index (?:Only )?Scan using content_items_home_chronological_idx/);
      expect(proof.plan).toMatch(/Index Cond:.*ROW\(published_at, id\).*\$[1234]/);
    } finally {
      try {
        await sql.begin(async (transaction) => {
          await transaction`set local session_replication_role = replica`;
          await transaction`
            delete from content_items
            where id = any(${contentIds}::uuid[])
          `;
          await transaction`delete from profiles where user_id = ${creatorId}`;
          await transaction`delete from user_social_counts where user_id = ${creatorId}`;
          await transaction`delete from users where id = ${creatorId}`;
        });
      } finally {
        await sql.end({ timeout: 5 });
      }
    }
  }, 60_000);
});
