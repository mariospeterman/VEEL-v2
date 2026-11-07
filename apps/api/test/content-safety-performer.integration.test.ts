import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { recordContentSafetyDeclaration } from
  "../src/modules/content/content-safety-repository.js";
import { createPostgresContentRepository } from
  "../src/modules/content/content-repository.js";
import { createPostgresClient } from "../src/shared/postgres.js";
import { guardedIntegrationDatabaseUrl } from "./integration-database.js";

const enabled = ["1", "true"].includes(
  process.env.VEEL_ENABLE_REAL_API_INTEGRATION_TESTS ?? ""
);
const describeIntegration = enabled ? describe : describe.skip;

describeIntegration("adult content performer verification authority", () => {
  it("revokes self-only and no-real-person readiness with the adult source", async () => {
    const sql = createPostgresClient(guardedIntegrationDatabaseUrl());
    const repository = createPostgresContentRepository(sql);
    const creatorId = randomUUID();
    const viewerId = randomUUID();
    const contentId = randomUUID();
    const noRealPersonContentId = randomUUID();
    const adultRecordId = randomUUID();
    let performerSubjectId: string | undefined;

    try {
      await sql`
        insert into users (id, supabase_user_id, state)
        values
          (${creatorId}, ${creatorId}, 'active'),
          (${viewerId}, ${viewerId}, 'active')
      `;
      await sql`
        insert into profiles (user_id, handle, display_name, visibility)
        values (
          ${creatorId}, ${`performer_safety_${creatorId.replaceAll("-", "").slice(0, 12)}`},
          'Performer safety creator', 'public'
        )
      `;
      await sql`
        insert into content_items (
          id, creator_user_id, media_type, state, publish_state,
          visibility, nsfw_label, moderation_state
        ) values
          (
            ${contentId}, ${creatorId}, 'image', 'draft', 'draft',
            'private', 'adult', 'pending'
          ),
          (
            ${noRealPersonContentId}, ${creatorId}, 'image', 'draft', 'draft',
            'private', 'adult', 'pending'
          )
      `;
      await sql`
        insert into verification_records (
          id, subject_type, subject_id, purpose, status, provider, method,
          threshold_age, result_over_threshold, assurance_level, reusable,
          policy_version, terms_accepted_at, provider_event_at, metadata, created_at
        ) values (
          ${adultRecordId}, 'user', ${creatorId}, 'adult_publisher_eligibility',
          'valid', 'didit', 'gov_id_selfie', 18, true, 'documentary', false,
          'integration-adult-v1', '2026-11-07 12:00:00+00'::timestamptz,
          '2026-11-07 12:00:00+00'::timestamptz,
          ${sql.json({ source: "provider_webhook" })},
          '2026-11-07 12:00:01+00'::timestamptz
        )
      `;
      await sql`
        insert into verification_records (
          subject_type, subject_id, purpose, status, provider, method,
          threshold_age, result_over_threshold, assurance_level, reusable,
          provider_event_at, metadata, created_at
        ) values
          (
            'user', ${creatorId}, 'age_access', 'valid', 'didit',
            'gov_id_selfie', 18, true, 'documentary', false,
            '2026-11-07 11:59:59+00'::timestamptz,
            ${sql.json({ source: "provider_webhook" })},
            '2026-11-07 12:00:00+00'::timestamptz
          ),
          (
            'user', ${viewerId}, 'age_access', 'valid', 'didit',
            'gov_id_selfie', 18, true, 'documentary', false,
            '2026-11-07 11:59:59+00'::timestamptz,
            ${sql.json({ source: "provider_webhook" })},
            '2026-11-07 12:00:00+00'::timestamptz
          )
      `;

      await sql.begin((transaction) => recordContentSafetyDeclaration(transaction, {
        contentId,
        creatorUserId: creatorId,
        rating: "adult",
        representationMode: "self_only",
        policyAccepted: true
      }));
      await sql.begin((transaction) => recordContentSafetyDeclaration(transaction, {
        contentId: noRealPersonContentId,
        creatorUserId: creatorId,
        rating: "adult",
        representationMode: "no_real_person",
        policyAccepted: true
      }));

      const performer = await sql<Array<{ id: string }>>`
        select id
        from performer_subjects
        where owner_user_id = ${creatorId} and linked_user_id = ${creatorId}
      `;
      const currentPerformerSubjectId = performer[0]?.id;
      expect(currentPerformerSubjectId).toEqual(expect.any(String));
      if (!currentPerformerSubjectId) {
        throw new Error("Expected the self-only declaration to create a performer subject");
      }
      performerSubjectId = currentPerformerSubjectId;

      const canonical = await sql<Array<{
        derived_from_record_id: string | null;
        result_over_threshold: boolean | null;
        status: string;
        threshold_age: number | null;
      }>>`
        select status, threshold_age, result_over_threshold, derived_from_record_id
        from private.current_verification_decision(
          'performer', ${currentPerformerSubjectId}, 'performer_eligibility'
        )
      `;
      expect(canonical).toEqual([{
        status: "valid",
        threshold_age: 18,
        result_over_threshold: true,
        derived_from_record_id: adultRecordId
      }]);
      expect(await readiness(sql, contentId)).toBe(true);
      expect(await readiness(sql, noRealPersonContentId)).toBe(true);

      await sql.begin(async (transaction) => {
        await transaction`set local session_replication_role = replica`;
        await transaction`
          update content_items
          set
            state = 'ready',
            publish_state = 'published',
            visibility = 'public',
            moderation_state = 'approved',
            published_at = now()
          where id in (${contentId}, ${noRealPersonContentId})
        `;
      });

      const feedBeforeRevocation = await repository.listHomeFeed({
        supabaseUserId: viewerId,
        mode: "latest",
        surface: "home",
        limit: 10
      });
      expect(feedBeforeRevocation.items.map((item) => item.id)).toContain(contentId);
      expect(feedBeforeRevocation.items.map((item) => item.id)).toContain(noRealPersonContentId);
      await expect(repository.findContentDetail({
        contentId,
        supabaseUserId: viewerId
      })).resolves.toMatchObject({ id: contentId });
      await expect(repository.findContentDetail({
        contentId: noRealPersonContentId,
        supabaseUserId: viewerId
      })).resolves.toMatchObject({ id: noRealPersonContentId });

      await sql`
        insert into verification_records (
          subject_type, subject_id, purpose, status, provider, method,
          threshold_age, result_over_threshold, assurance_level, reusable,
          provider_event_at, metadata, created_at
        ) values (
          'user', ${creatorId}, 'adult_publisher_eligibility', 'blocked',
          'didit', 'gov_id_selfie', 18, false, 'documentary', false,
          '2026-11-07 12:00:02+00'::timestamptz,
          ${sql.json({ source: "provider_webhook" })},
          '2026-11-07 12:00:03+00'::timestamptz
        )
      `;

      const revoked = await sql<Array<{ id: string }>>`
        select id
        from private.current_verification_decision(
          'performer', ${currentPerformerSubjectId}, 'performer_eligibility'
        )
      `;
      expect(revoked).toEqual([]);
      expect(await readiness(sql, contentId)).toBe(false);
      expect(await readiness(sql, noRealPersonContentId)).toBe(false);
      const feedAfterRevocation = await repository.listHomeFeed({
        supabaseUserId: viewerId,
        mode: "latest",
        surface: "home",
        limit: 10
      });
      expect(feedAfterRevocation.items.map((item) => item.id)).not.toContain(contentId);
      expect(feedAfterRevocation.items.map((item) => item.id)).not.toContain(noRealPersonContentId);
      await expect(repository.findContentDetail({
        contentId,
        supabaseUserId: viewerId
      })).resolves.toBeNull();
      await expect(repository.findContentDetail({
        contentId: noRealPersonContentId,
        supabaseUserId: viewerId
      })).resolves.toBeNull();
    } finally {
      await sql`
        delete from content_items where id in (${contentId}, ${noRealPersonContentId})
      `;
      if (performerSubjectId) {
        await sql`delete from performer_subjects where id = ${performerSubjectId}`;
      }
      await sql`
        delete from verification_records
        where subject_id in (${creatorId}, ${viewerId})
          or (${performerSubjectId ?? null}::uuid is not null
            and subject_id = ${performerSubjectId ?? null}::uuid)
      `;
      await sql`delete from profiles where user_id = ${creatorId}`;
      await sql`delete from user_social_counts where user_id in (${creatorId}, ${viewerId})`;
      await sql`delete from users where id in (${creatorId}, ${viewerId})`;
      await sql.end({ timeout: 5 });
    }
  });
});

async function readiness(
  sql: ReturnType<typeof createPostgresClient>,
  contentId: string
): Promise<boolean> {
  const rows = await sql<Array<{ ready: boolean }>>`
    select private.content_performer_readiness(${contentId}) as ready
  `;
  return rows[0]?.ready === true;
}
