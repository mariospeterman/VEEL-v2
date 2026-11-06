import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { PostgresTransaction } from "../src/shared/postgres";
import { createPostgresClient } from "../src/shared/postgres";
import { guardedIntegrationDatabaseUrl } from "./integration-database.js";

const enabled = ["1", "true"].includes(
  process.env.VEEL_ENABLE_REAL_API_INTEGRATION_TESTS ?? ""
);
const describeIntegration = enabled ? describe : describe.skip;
const canonicalIdentityTables = [
  "user_provider_identities",
  "app_sessions",
  "recovery_link_intents"
] as const;
const canonicalIdentityAuthorityMigration = readFileSync(
  new URL(
    "../../../packages/database/migrations/0133_canonical_identity_data_api_authority.sql",
    import.meta.url
  ),
  "utf8"
);

const permissionScopedFinanceTables = [
  "refunds_and_disputes",
  "refund_remediation_evidence",
  "organization_settlement_wallets",
  "managed_creator_relationships",
  "managed_creator_agreements",
  "managed_creator_allocation_records"
] as const;

const serverOwnedTables = [
  "identity_verifications",
  "tax_profiles",
  "tax_profile_versions",
  "seller_of_record_determinations",
  "jurisdiction_tax_rules",
  "product_tax_matrix",
  "buyer_location_evidence",
  "vat_determinations",
  "receipts",
  "receipt_lines",
  "platform_fee_statements",
  "vat_invoices",
  "vat_invoice_lines",
  "tax_adjustments",
  "compliance_ledger_entries",
  "dac7_reports",
  "dac7_report_lines",
  "carf_reports",
  "carf_report_lines",
  "compliance_review_queue",
  "compliance_exports",
  "referral_programs",
  "partner_campaigns",
  "partner_contracts",
  "referral_abuse_flags",
  "tier_waivers",
  "organizations",
  ...permissionScopedFinanceTables,
  ...canonicalIdentityTables,
  "user_social_counts",
  "content_engagement_counters",
  "comments",
  "content_items",
  "media_assets",
  "content_access_rules",
  "content_hashtags",
  "media_safety_cases",
  "comment_reactions",
  "comment_mentions"
] as const;

describeIntegration("server-owned Data API authority", () => {
  it("removes effective browser-role privileges and leaves backend reads available", async () => {
    const sql = createPostgresClient(guardedIntegrationDatabaseUrl());
    const staffUserId = randomUUID();
    const staffMembershipId = randomUUID();

    try {
      const privileges = await sql<
        Array<{
          anon_select: boolean;
          authenticated_select: boolean;
          backend_select: boolean;
          table_name: string;
        }>
      >`
        select
          table_name,
          has_table_privilege('anon', format('public.%I', table_name), 'select') as anon_select,
          has_table_privilege(
            'authenticated', format('public.%I', table_name), 'select'
          ) as authenticated_select,
          has_table_privilege(
            current_user, format('public.%I', table_name), 'select'
          ) as backend_select
        from unnest(${serverOwnedTables}::text[]) as table_name
        order by table_name
      `;
      expect(privileges).toHaveLength(serverOwnedTables.length);
      expect(privileges.every((row) => !row.anon_select && !row.authenticated_select)).toBe(true);
      expect(privileges.every((row) => row.backend_select)).toBe(true);

      const backendProbe = await sql<{ count: number }[]>`
        select count(*)::integer as count from content_items
      `;
      expect(backendProbe[0]?.count).toBeGreaterThanOrEqual(0);

      await sql`
        insert into users (id, supabase_user_id, state)
        values (${staffUserId}, ${staffUserId}, 'active')
      `;
      await sql`
        insert into staff_memberships (id, user_id, role, state, granted_by_user_id)
        values (${staffMembershipId}, ${staffUserId}, 'ai_ops', 'active', ${staffUserId})
      `;

      for (const table of permissionScopedFinanceTables) {
        await expect(
          sql.begin(async (transaction) => {
            await assumeBrowserRole(transaction, "authenticated", staffUserId);
            await transaction.unsafe(`select 1 from public.${table} limit 1`);
          })
        ).rejects.toMatchObject({ code: "42501" });
      }
      await expect(
        sql.begin(async (transaction) => {
          await assumeBrowserRole(transaction, "authenticated", staffUserId);
          await transaction`select id from identity_verifications limit 1`;
        })
      ).rejects.toMatchObject({ code: "42501" });
      await expect(
        sql.begin(async (transaction) => {
          await assumeBrowserRole(transaction, "anon");
          await transaction`select content_item_id from content_engagement_counters limit 1`;
        })
      ).rejects.toMatchObject({ code: "42501" });
    } finally {
      await sql`delete from staff_memberships where id = ${staffMembershipId}`;
      await sql`delete from users where id = ${staffUserId}`;
      await sql.end({ timeout: 5 });
    }
  });

  it("denies canonical identity records to every staff role, revoked staff, and unrelated users", async () => {
    const sql = createPostgresClient(guardedIntegrationDatabaseUrl());
    const targetUserId = randomUUID();
    const targetIdentityId = randomUUID();
    const targetSessionId = randomUUID();
    const targetProviderSessionId = randomUUID();
    const targetRecoveryIntentId = randomUUID();
    const actors = [
      { membershipId: randomUUID(), membershipState: "active", role: "event_ops", userId: randomUUID() },
      { membershipId: randomUUID(), membershipState: "active", role: "support", userId: randomUUID() },
      { membershipId: randomUUID(), membershipState: "active", role: "finance", userId: randomUUID() },
      { membershipId: randomUUID(), membershipState: "active", role: "trust_safety", userId: randomUUID() },
      { membershipId: randomUUID(), membershipState: "revoked", role: "event_ops", userId: randomUUID() },
      { membershipId: null, membershipState: null, role: null, userId: randomUUID() }
    ] as const;
    const actorIdentityIds = actors.map(() => randomUUID());
    const allUserIds = [targetUserId, ...actors.map((actor) => actor.userId)];
    const membershipIds = actors.flatMap((actor) =>
      actor.membershipId === null ? [] : [actor.membershipId]
    );

    try {
      for (const userId of allUserIds) {
        await sql`
          insert into users (id, supabase_user_id, state)
          values (${userId}, ${userId}, 'active')
        `;
      }
      await sql`
        insert into user_provider_identities (
          id, provider, provider_subject, user_id, status, linked_at
        ) values (
          ${targetIdentityId}, 'supabase', ${targetUserId}, ${targetUserId}, 'active', now()
        )
      `;
      for (const [index, actor] of actors.entries()) {
        const identityId = actorIdentityIds[index];
        if (!identityId) throw new Error("Missing canonical identity fixture id");
        await sql`
          insert into user_provider_identities (
            id, provider, provider_subject, user_id, status, linked_at
          ) values (
            ${identityId}, 'supabase', ${actor.userId},
            ${actor.userId}, 'active', now()
          )
        `;
        if (actor.membershipId && actor.role && actor.membershipState) {
          await sql`
            insert into staff_memberships (id, user_id, role, state, granted_by_user_id)
            values (
              ${actor.membershipId}, ${actor.userId}, ${actor.role},
              ${actor.membershipState}, ${actor.userId}
            )
          `;
        }
      }
      await sql`
        insert into app_sessions (
          id, user_id, provider_identity_id, authentication_method,
          provider_session_id, token_hash, expires_at, authenticated_at
        ) values (
          ${targetSessionId}, ${targetUserId}, ${targetIdentityId}, 'supabase_recovery',
          ${targetProviderSessionId}, ${`session-${targetSessionId}`},
          now() + interval '1 hour', now()
        )
      `;
      await sql`
        insert into recovery_link_intents (
          id, user_id, session_id, token_hash, expires_at
        ) values (
          ${targetRecoveryIntentId}, ${targetUserId}, ${targetSessionId},
          ${`recovery-${targetRecoveryIntentId}`}, now() + interval '15 minutes'
        )
      `;

      for (const actor of actors) {
        const resolved = await sql.begin(async (transaction) => {
          await assumeBrowserRole(transaction, "authenticated", actor.userId);
          return transaction<{ user_id: string | null }[]>`
            select private.current_app_user_id() as user_id
          `;
        });
        expect(resolved).toEqual([{ user_id: actor.userId }]);

        for (const table of canonicalIdentityTables) {
          await expect(
            sql.begin(async (transaction) => {
              await assumeBrowserRole(transaction, "authenticated", actor.userId);
              await transaction.unsafe(`select 1 from public.${table} limit 1`);
            })
          ).rejects.toMatchObject({ code: "42501" });
        }
      }
    } finally {
      await sql`delete from recovery_link_intents where id = ${targetRecoveryIntentId}`;
      await sql`delete from app_sessions where id = ${targetSessionId}`;
      await sql`delete from staff_memberships where id = any(${membershipIds}::uuid[])`;
      await sql`
        delete from user_provider_identities
        where id = any(${[targetIdentityId, ...actorIdentityIds]}::uuid[])
      `;
      await sql`delete from users where id = any(${allUserIds}::uuid[])`;
      await sql.end({ timeout: 5 });
    }
  });

  it("removes retained legacy grants, broad policies, and unsafe future-object defaults", async () => {
    const sql = createPostgresClient(guardedIntegrationDatabaseUrl());

    try {
      await sql.begin(async (transaction) => {
        await transaction.unsafe(`
          grant select on table
            user_provider_identities,
            app_sessions,
            recovery_link_intents
          to authenticated
        `);
        await transaction.unsafe(`
          create policy user_provider_identities_staff_select
            on user_provider_identities for select to authenticated
            using ((select private.is_staff_member()))
        `);
        await transaction.unsafe(`
          create policy app_sessions_staff_select
            on app_sessions for select to authenticated
            using ((select private.is_staff_member()))
        `);
        await transaction.unsafe(`
          create policy recovery_link_intents_staff_select
            on recovery_link_intents for select to authenticated
            using ((select private.is_staff_member()))
        `);
        await transaction.unsafe(`
          grant execute on function private.emit_realtime_invalidation(text, text, text, uuid)
            to public, anon, authenticated
        `);
        await transaction.unsafe(`
          alter default privileges in schema public
            grant select on tables to authenticated
        `);
        await transaction.unsafe(`
          alter default privileges
            grant execute on functions to public, anon, authenticated
        `);

        const legacy = await canonicalIdentityCatalog(transaction);
        expect(legacy.every((row) => row.authenticated_select)).toBe(true);
        const legacyFunction = await functionAuthority(transaction);
        expect(legacyFunction.emit_anon_execute).toBe(true);
        expect(legacyFunction.emit_authenticated_execute).toBe(true);

        await transaction.unsafe(canonicalIdentityAuthorityMigration);

        const repaired = await canonicalIdentityCatalog(transaction);
        expect(repaired).toHaveLength(canonicalIdentityTables.length);
        expect(repaired.every((row) => row.rls_enabled)).toBe(true);
        expect(repaired.every((row) => row.policy_count === 0)).toBe(true);
        expect(repaired.every((row) => !row.anon_select && !row.authenticated_select)).toBe(true);
        expect(repaired.every((row) => row.backend_select)).toBe(true);

        const repairedFunction = await functionAuthority(transaction);
        expect(repairedFunction).toEqual({
          emit_anon_execute: false,
          emit_authenticated_execute: false,
          emit_backend_execute: true,
          helper_anon_execute: false,
          helper_authenticated_execute: true
        });

        await transaction.unsafe(`
          create table public.data_api_default_table_probe (id integer)
        `);
        await transaction.unsafe(`
          create function private.data_api_default_function_probe()
          returns integer language sql as 'select 1'
        `);
        const defaults = await transaction<
          Array<{
            function_anon_execute: boolean;
            function_authenticated_execute: boolean;
            table_anon_select: boolean;
            table_authenticated_select: boolean;
          }>
        >`
          select
            has_table_privilege('anon', 'public.data_api_default_table_probe', 'select')
              as table_anon_select,
            has_table_privilege(
              'authenticated', 'public.data_api_default_table_probe', 'select'
            ) as table_authenticated_select,
            has_function_privilege(
              'anon', 'private.data_api_default_function_probe()', 'execute'
            ) as function_anon_execute,
            has_function_privilege(
              'authenticated', 'private.data_api_default_function_probe()', 'execute'
            ) as function_authenticated_execute
        `;
        expect(defaults).toEqual([{
          function_anon_execute: false,
          function_authenticated_execute: false,
          table_anon_select: false,
          table_authenticated_select: false
        }]);
        await transaction.unsafe(`drop function private.data_api_default_function_probe()`);
        await transaction.unsafe(`drop table public.data_api_default_table_probe`);
      });
    } finally {
      await sql.end({ timeout: 5 });
    }
  });
});

async function canonicalIdentityCatalog(transaction: PostgresTransaction): Promise<
  Array<{
    anon_select: boolean;
    authenticated_select: boolean;
    backend_select: boolean;
    policy_count: number;
    rls_enabled: boolean;
    table_name: string;
  }>
> {
  return transaction`
    select
      relation.relname as table_name,
      relation.relrowsecurity as rls_enabled,
      (
        select count(*)::integer
        from pg_policies policy
        where policy.schemaname = 'public' and policy.tablename = relation.relname
      ) as policy_count,
      has_table_privilege('anon', relation.oid, 'select') as anon_select,
      has_table_privilege('authenticated', relation.oid, 'select') as authenticated_select,
      has_table_privilege(current_user, relation.oid, 'select') as backend_select
    from pg_class relation
    join pg_namespace namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'public'
      and relation.relname = any(${canonicalIdentityTables}::text[])
    order by relation.relname
  `;
}

async function functionAuthority(transaction: PostgresTransaction): Promise<{
  emit_anon_execute: boolean;
  emit_authenticated_execute: boolean;
  emit_backend_execute: boolean;
  helper_anon_execute: boolean;
  helper_authenticated_execute: boolean;
}> {
  const rows = await transaction<
    Array<{
      emit_anon_execute: boolean;
      emit_authenticated_execute: boolean;
      emit_backend_execute: boolean;
      helper_anon_execute: boolean;
      helper_authenticated_execute: boolean;
    }>
  >`
    select
      has_function_privilege(
        'anon', 'private.emit_realtime_invalidation(text,text,text,uuid)', 'execute'
      ) as emit_anon_execute,
      has_function_privilege(
        'authenticated', 'private.emit_realtime_invalidation(text,text,text,uuid)', 'execute'
      ) as emit_authenticated_execute,
      has_function_privilege(
        current_user, 'private.emit_realtime_invalidation(text,text,text,uuid)', 'execute'
      ) as emit_backend_execute,
      has_function_privilege('anon', 'private.current_app_user_id()', 'execute')
        as helper_anon_execute,
      has_function_privilege('authenticated', 'private.current_app_user_id()', 'execute')
        as helper_authenticated_execute
  `;
  const row = rows[0];
  if (!row) throw new Error("Function authority catalog probe returned no row");
  return row;
}

async function assumeBrowserRole(
  transaction: PostgresTransaction,
  role: "anon" | "authenticated",
  subject?: string
): Promise<void> {
  await transaction.unsafe(`set local role ${role}`);
  if (subject) {
    await transaction`select set_config('request.jwt.claim.sub', ${subject}, true)`;
  }
}
