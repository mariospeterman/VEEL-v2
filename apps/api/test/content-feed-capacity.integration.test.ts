import { performance } from "node:perf_hooks";
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createPostgresContentRepository } from "../src/modules/content/content-repository.js";
import { createPostgresClient } from "../src/shared/postgres.js";
import { guardedIntegrationDatabaseUrl } from "./integration-database.js";

const enabled = ["1", "true"].includes(
  process.env.VEEL_ENABLE_REAL_API_INTEGRATION_TESTS ?? ""
) && ["1", "true"].includes(
  process.env.VEEL_ENABLE_FEED_CAPACITY_TESTS ?? ""
);
const describeCapacity = enabled ? describe : describe.skip;

const CREATOR_COUNT = 100;
const FOLLOWED_CREATOR_COUNT = 50;
const ITEMS_PER_CREATOR = 1_000;
const ADULT_CREATOR_INTERVAL = 10;
const SCROLL_PAGE_COUNT = 40;
const PAGE_SIZE = 100;

describeCapacity("chronological feed capacity against representative Postgres data", () => {
  it("keeps index-backed p95/p99 latency and process memory bounded across a 100k corpus", async () => {
    const sql = createPostgresClient(guardedIntegrationDatabaseUrl());
    const repository = createPostgresContentRepository(sql);
    const viewerId = randomUUID();
    const creatorIds = Array.from({ length: CREATOR_COUNT }, () => randomUUID());
    const allUserIds = [viewerId, ...creatorIds];
    const followedCreatorIds = creatorIds.slice(0, FOLLOWED_CREATOR_COUNT);
    const adultCreatorIds = creatorIds.filter(
      (_creatorId, index) => (index + 1) % ADULT_CREATOR_INTERVAL === 0
    );
    const expectedAdultItems = adultCreatorIds.length * ITEMS_PER_CREATOR;
    const suffix = viewerId.replaceAll("-", "").slice(0, 12);

    try {
      await sql`
        insert into users (id, supabase_user_id, state)
        select seeded.id, seeded.id, 'active'
        from unnest(${allUserIds}::uuid[]) as seeded(id)
      `;
      await sql`
        insert into profiles (user_id, handle, display_name, visibility)
        select
          seeded.id,
          ${`feed_capacity_${suffix}_`} || seeded.position::text,
          'Capacity creator ' || seeded.position::text,
          'public'
        from unnest(${creatorIds}::uuid[]) with ordinality as seeded(id, position)
      `;
      await sql`
        insert into verification_records (
          subject_type, subject_id, purpose, status, provider, provider_reference,
          method, threshold_age, result_over_threshold, assurance_level, verified_at, reusable
        )
        select
          'user', seeded.id, 'age_access', 'valid', 'internal',
          ${`feed-capacity-age-${suffix}-`} || seeded.position::text,
          'reusable_age', 18, true, 'high', now(), false
        from unnest(${allUserIds}::uuid[]) with ordinality as seeded(id, position)
      `;
      await sql`
        insert into verification_records (
          subject_type, subject_id, purpose, status, provider, provider_reference,
          method, threshold_age, result_over_threshold, assurance_level,
          verified_at, reusable, policy_version, terms_accepted_at
        )
        select
          'user', seeded.id, 'adult_publisher_eligibility', 'valid', 'manual',
          ${`feed-capacity-adult-${suffix}-`} || seeded.position::text,
          'manual_review', 18, true, 'documentary', now(), false,
          'feed-capacity-adult-v1', now()
        from unnest(${adultCreatorIds}::uuid[]) with ordinality as seeded(id, position)
      `;
      await sql`
        insert into user_follows (follower_user_id, followed_user_id, state)
        select ${viewerId}, seeded.id, 'active'
        from unnest(${followedCreatorIds}::uuid[]) as seeded(id)
      `;
      await sql.begin(async (transaction) => {
        await transaction`set local session_replication_role = replica`;
        await transaction`
          insert into content_items (
            id, creator_user_id, media_type, distribution_mode, state, visibility,
            nsfw_label, moderation_state, publish_state, published_at, created_at
          )
          select
            gen_random_uuid(),
            creator.id,
            case when item.position % 10 = 0 then 'clip' else 'image' end,
            'post',
            'ready',
            case when item.position % 20 = 0 then 'subscribers' else 'public' end,
            case
              when creator.position % ${ADULT_CREATOR_INTERVAL} = 0 then 'adult'
              else 'none'
            end,
            'approved',
            'published',
            now() - (
              ((item.position - 1) * ${CREATOR_COUNT} + creator.position)
              * interval '1 microsecond'
            ),
            now() - interval '2 hours'
          from unnest(${creatorIds}::uuid[]) with ordinality as creator(id, position)
          cross join generate_series(1, ${ITEMS_PER_CREATOR}) as item(position)
        `;
        await transaction`
          insert into content_safety_declarations (
            content_item_id, uploader_user_id, representation_mode,
            policy_version, state, accepted_at, content_revision
          )
          select
            content.id, content.creator_user_id, 'no_real_person',
            'feed-capacity-safety-v1', 'active', now(), 1
          from content_items content
          where content.creator_user_id = any(${adultCreatorIds}::uuid[])
            and content.nsfw_label = 'adult'
        `;
      });
      await sql`analyze content_items`;
      await sql`analyze user_follows`;

      const corpusRows = await sql<Array<{ count: number }>>`
        select count(*)::int as count
        from content_items
        where creator_user_id = any(${creatorIds}::uuid[])
      `;
      expect(corpusRows[0]?.count).toBe(CREATOR_COUNT * ITEMS_PER_CREATOR);

      const adultCorpusRows = await sql<Array<{ count: number }>>`
        select count(*)::int as count
        from content_items content
        join content_safety_declarations declaration
          on declaration.content_item_id = content.id
         and declaration.state = 'active'
         and declaration.representation_mode = 'no_real_person'
        where content.creator_user_id = any(${adultCreatorIds}::uuid[])
          and content.nsfw_label = 'adult'
      `;
      expect(adultCorpusRows[0]?.count).toBe(expectedAdultItems);

      const planRows = await sql<Array<{ "QUERY PLAN": string }>>`
        explain (analyze, buffers, format text)
        with viewer as materialized (
          select id from users
          where supabase_user_id = ${viewerId} and state = 'active'
          limit 1
        )
        select content.id, content.published_at
        from content_items content
        join viewer on true
        where content.creator_user_id <> viewer.id
          and content.state = 'ready'
          and content.publish_state = 'published'
          and content.moderation_state = 'approved'
          and content.published_at is not null
          and content.published_at <= now()
          and content.distribution_mode = 'post'
          and content.media_type not in ('text', 'poll')
          and exists (
            select 1 from user_follows current_follow
            where current_follow.follower_user_id = viewer.id
              and current_follow.followed_user_id = content.creator_user_id
              and current_follow.state = 'active'
          )
        order by content.published_at desc, content.id desc
        limit 128
      `;
      const plan = planRows.map((row) => row["QUERY PLAN"]).join("\n");
      expect(plan).toMatch(/Index (?:Only )?Scan using content_items_home_chronological_idx/);
      expect(plan).not.toMatch(/Seq Scan on content_items/);

      const candidateRows = await sql<Array<{ id: string; nsfw_label: string }>>`
        with viewer as materialized (
          select id from users
          where supabase_user_id = ${viewerId} and state = 'active'
          limit 1
        )
        select content.id, content.nsfw_label
        from content_items content
        join viewer on true
        where content.creator_user_id <> viewer.id
          and content.state = 'ready'
          and content.publish_state = 'published'
          and content.moderation_state = 'approved'
          and content.published_at is not null
          and content.published_at <= now()
          and content.distribution_mode = 'post'
          and content.media_type not in ('text', 'poll')
          and exists (
            select 1 from user_follows current_follow
            where current_follow.follower_user_id = viewer.id
              and current_follow.followed_user_id = content.creator_user_id
              and current_follow.state = 'active'
          )
        order by content.published_at desc, content.id desc
        limit 128
      `;
      const adultCandidateCount = candidateRows.filter(
        (row) => row.nsfw_label === "adult"
      ).length;
      expect(adultCandidateCount).toBeGreaterThan(0);
      const authorizationStartedAt = performance.now();
      const authorizationRows = await sql<Array<{ count: number }>>`
        select count(*)::int as count
        from private.eligible_content(
          ${viewerId},
          null,
          ${candidateRows.map((row) => row.id)}::uuid[]
        )
      `;
      const authorizationProbeMs = performance.now() - authorizationStartedAt;
      expect(authorizationRows[0]?.count).toBeGreaterThan(0);

      const coldStartedAt = performance.now();
      const coldPage = await repository.listHomeFeed({
        supabaseUserId: viewerId,
        mode: "following",
        surface: "home",
        limit: PAGE_SIZE
      });
      const coldStartMs = performance.now() - coldStartedAt;
      expect(coldPage.items).toHaveLength(PAGE_SIZE);

      const latenciesMs: number[] = [];
      const baselineHeapBytes = process.memoryUsage().heapUsed;
      let peakHeapBytes = baselineHeapBytes;
      let cursor: string | null | undefined;
      let delivered = 0;
      let generatedAt: string | undefined;

      for (let pageIndex = 0; pageIndex < SCROLL_PAGE_COUNT; pageIndex += 1) {
        const startedAt = performance.now();
        const page = await repository.listHomeFeed({
          supabaseUserId: viewerId,
          mode: "following",
          surface: "home",
          ...(cursor ? { cursor } : {}),
          limit: PAGE_SIZE
        });
        latenciesMs.push(performance.now() - startedAt);
        generatedAt ??= page.generatedAt;
        expect(page.generatedAt).toBe(generatedAt);
        expect(page.items.length).toBeLessThanOrEqual(PAGE_SIZE);
        delivered += page.items.length;
        cursor = page.nextCursor;
        peakHeapBytes = Math.max(peakHeapBytes, process.memoryUsage().heapUsed);
        if (!cursor) break;
      }

      const sortedLatencies = [...latenciesMs].sort((left, right) => left - right);
      const percentile = (value: number) => sortedLatencies[
        Math.max(0, Math.ceil(sortedLatencies.length * value) - 1)
      ] ?? Number.POSITIVE_INFINITY;
      const p95Ms = percentile(0.95);
      const p99Ms = percentile(0.99);
      const heapGrowthBytes = Math.max(0, peakHeapBytes - baselineHeapBytes);
      const metrics = {
        corpusSize: CREATOR_COUNT * ITEMS_PER_CREATOR,
        adultCorpusSize: expectedAdultItems,
        adultCreators: adultCreatorIds.length,
        adultCandidates: adultCandidateCount,
        followedCreators: FOLLOWED_CREATOR_COUNT,
        pagesMeasured: latenciesMs.length,
        delivered,
        authorizationProbeMs: Math.round(authorizationProbeMs * 100) / 100,
        coldStartMs: Math.round(coldStartMs * 100) / 100,
        p95Ms: Math.round(p95Ms * 100) / 100,
        p99Ms: Math.round(p99Ms * 100) / 100,
        peakHeapGrowthMiB: Math.round((heapGrowthBytes / (1024 * 1024)) * 100) / 100
      };
      console.info("feed-capacity-metrics", JSON.stringify(metrics));

      expect(latenciesMs).toHaveLength(SCROLL_PAGE_COUNT);
      expect(delivered).toBeGreaterThan(SCROLL_PAGE_COUNT * PAGE_SIZE * 0.75);
      expect(p95Ms).toBeLessThan(1_000);
      expect(p99Ms).toBeLessThan(2_000);
      expect(heapGrowthBytes).toBeLessThan(128 * 1024 * 1024);
    } finally {
      try {
        await sql.begin(async (transaction) => {
          await transaction`set local session_replication_role = replica`;
          await transaction`
            delete from content_safety_declarations
            where uploader_user_id = any(${adultCreatorIds}::uuid[])
          `;
          await transaction`
            delete from content_items
            where creator_user_id = any(${creatorIds}::uuid[])
          `;
          await transaction`
            delete from user_follows
            where follower_user_id = ${viewerId}
              and followed_user_id = any(${creatorIds}::uuid[])
          `;
          await transaction`
            delete from verification_records
            where subject_type = 'user'
              and subject_id = any(${allUserIds}::uuid[])
          `;
          await transaction`delete from profiles where user_id = any(${creatorIds}::uuid[])`;
          await transaction`delete from user_social_counts where user_id = any(${allUserIds}::uuid[])`;
          await transaction`delete from users where id = any(${allUserIds}::uuid[])`;
        });
      } finally {
        await sql.end({ timeout: 5 });
      }
    }
  }, 300_000);
});
