import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createPostgresManagedCreatorRepository } from "../src/modules/managed-creator/managed-creator-repository";
import { createPostgresClient, type PostgresSql } from "../src/shared/postgres";
import { guardedIntegrationDatabaseUrl } from "./integration-database.js";

const enabled = ["1", "true"].includes(
  process.env.VEEL_ENABLE_REAL_API_INTEGRATION_TESTS ?? ""
);
const describeIntegration = enabled ? describe : describe.skip;

describeIntegration("managed creator reporting against migrated Postgres", () => {
  it("scopes organization reporting to allocations from agreements that granted analytics access", async () => {
    const databaseUrl = guardedIntegrationDatabaseUrl();
    const sql = createPostgresClient(databaseUrl);
    const repository = createPostgresManagedCreatorRepository(databaseUrl);
    const fixture = createFixtureIds();

    try {
      await seedReportingFixture(sql, fixture);

      const organizationReport = await repository.getReporting({
        supabaseUserId: fixture.organizationMemberUserId,
        relationshipId: fixture.relationshipId
      });
      expect(organizationReport?.totals).toEqual([
        {
          currency: "SOL",
          confirmedPaymentCount: 1,
          creatorSideProceedsMinor: 1_000,
          creatorNetMinor: 800,
          enterpriseManagementMinor: 200
        }
      ]);

      const creatorReport = await repository.getReporting({
        supabaseUserId: fixture.creatorUserId,
        relationshipId: fixture.relationshipId
      });
      expect(creatorReport?.totals).toEqual([
        {
          currency: "SOL",
          confirmedPaymentCount: 2,
          creatorSideProceedsMinor: 3_000,
          creatorNetMinor: 2_400,
          enterpriseManagementMinor: 600
        }
      ]);
    } finally {
      try {
        await cleanupReportingFixture(sql, fixture);
      } finally {
        await repository.close?.();
        await sql.end();
      }
    }
  });
});

interface ReportingFixtureIds {
  creatorUserId: string;
  organizationMemberUserId: string;
  organizationId: string;
  membershipId: string;
  relationshipId: string;
  analyticsAgreementId: string;
  laterAgreementId: string;
  historicalPaymentIntentId: string;
  laterPaymentIntentId: string;
  historicalAllocationId: string;
  laterAllocationId: string;
}

function createFixtureIds(): ReportingFixtureIds {
  return {
    creatorUserId: randomUUID(),
    organizationMemberUserId: randomUUID(),
    organizationId: randomUUID(),
    membershipId: randomUUID(),
    relationshipId: randomUUID(),
    analyticsAgreementId: randomUUID(),
    laterAgreementId: randomUUID(),
    historicalPaymentIntentId: randomUUID(),
    laterPaymentIntentId: randomUUID(),
    historicalAllocationId: randomUUID(),
    laterAllocationId: randomUUID()
  };
}

async function seedReportingFixture(sql: PostgresSql, fixture: ReportingFixtureIds): Promise<void> {
  await sql.begin(async (tx) => {
    await tx`
      insert into users (id, supabase_user_id, state) values
        (${fixture.creatorUserId}::uuid, ${fixture.creatorUserId}::uuid, 'active'),
        (${fixture.organizationMemberUserId}::uuid, ${fixture.organizationMemberUserId}::uuid, 'active')
    `;
    await tx`
      insert into organizations (id, name, state, kyb_state)
      values (${fixture.organizationId}::uuid, 'Managed creator reporting fixture', 'active', 'verified')
    `;
    await tx`
      insert into organization_memberships (
        id, organization_id, user_id, role, state, invited_by_user_id, joined_at
      ) values (
        ${fixture.membershipId}::uuid, ${fixture.organizationId}::uuid,
        ${fixture.organizationMemberUserId}::uuid, 'owner', 'active',
        ${fixture.organizationMemberUserId}::uuid, now()
      )
    `;
    await tx`
      insert into managed_creator_relationships (
        id, organization_id, creator_user_id, invited_by_user_id,
        idempotency_key, state, accepted_at
      ) values (
        ${fixture.relationshipId}::uuid, ${fixture.organizationId}::uuid,
        ${fixture.creatorUserId}::uuid, ${fixture.organizationMemberUserId}::uuid,
        ${`reporting-relationship-${fixture.relationshipId}`}, 'active', now() - interval '3 hours'
      )
    `;
    await tx`
      insert into managed_creator_agreements (
        id, relationship_id, version_number, state, permissions,
        commercial_agreement_version, terms_hash, creator_share_bps,
        enterprise_management_share_bps, proposed_by_user_id, idempotency_key,
        accepted_by_user_id, proposed_at, accepted_at, effective_at, ends_at
      ) values
        (
          ${fixture.analyticsAgreementId}::uuid, ${fixture.relationshipId}::uuid, 1, 'superseded',
          array['analytics_view', 'revenue_allocation']::text[], 'managed-creator-v1',
          'analytics-agreement-terms', 8000, 2000, ${fixture.organizationMemberUserId}::uuid,
          ${`reporting-agreement-v1-${fixture.relationshipId}`}, ${fixture.creatorUserId}::uuid,
          now() - interval '3 hours', now() - interval '3 hours',
          now() - interval '3 hours', now() - interval '1 hour'
        ),
        (
          ${fixture.laterAgreementId}::uuid, ${fixture.relationshipId}::uuid, 2, 'accepted',
          array['revenue_allocation']::text[], 'managed-creator-v1',
          'later-agreement-terms', 8000, 2000, ${fixture.organizationMemberUserId}::uuid,
          ${`reporting-agreement-v2-${fixture.relationshipId}`}, ${fixture.creatorUserId}::uuid,
          now() - interval '1 hour', now() - interval '1 hour', now() - interval '1 hour', null
        )
    `;
    await tx`
      insert into payment_intents (
        id, user_id, product_type, target_id, amount_minor, currency, state,
        idempotency_key, request_hash, solana_cluster, treasury_wallet, reference_address,
        confirmed_at, expires_at, quoted_at, settlement_kind, creator_wallet,
        platform_fee_wallet, total_amount_minor, creator_amount_minor,
        creator_side_proceeds_minor, platform_fee_gross_minor,
        platform_fee_amount_minor, referral_amount_minor, enterprise_wallet,
        enterprise_management_amount_minor, managed_creator_relationship_id,
        managed_creator_agreement_id, enterprise_organization_id, withdrawal_waiver_required
      ) values
        (
          ${fixture.historicalPaymentIntentId}::uuid, ${fixture.organizationMemberUserId}::uuid,
          'content_unlock', ${randomUUID()}::uuid, 1000, 'SOL', 'confirmed',
          ${`reporting-payment-old-${fixture.relationshipId}`}, ${randomUUID()}, 'devnet',
          'treasury-wallet', ${randomUUID()}, now() - interval '2 hours',
          now() + interval '10 minutes', now(), 'platform_owned', 'creator-wallet',
          'platform-wallet', 1000, 800, 1000, 0, 0, 0, 'enterprise-wallet', 200,
          ${fixture.relationshipId}::uuid, ${fixture.analyticsAgreementId}::uuid,
          ${fixture.organizationId}::uuid, false
        ),
        (
          ${fixture.laterPaymentIntentId}::uuid, ${fixture.organizationMemberUserId}::uuid,
          'content_unlock', ${randomUUID()}::uuid, 2000, 'SOL', 'confirmed',
          ${`reporting-payment-later-${fixture.relationshipId}`}, ${randomUUID()}, 'devnet',
          'treasury-wallet', ${randomUUID()}, now(), now() + interval '10 minutes', now(),
          'platform_owned', 'creator-wallet', 'platform-wallet', 2000, 1600, 2000, 0,
          0, 0, 'enterprise-wallet', 400, ${fixture.relationshipId}::uuid,
          ${fixture.laterAgreementId}::uuid, ${fixture.organizationId}::uuid, false
        )
    `;
    await tx`
      insert into managed_creator_allocation_records (
        id, payment_intent_id, relationship_id, agreement_id, organization_id,
        creator_user_id, creator_side_proceeds_minor, creator_net_minor,
        enterprise_management_minor, currency, state, confirmed_at, created_at
      ) values
        (
          ${fixture.historicalAllocationId}::uuid, ${fixture.historicalPaymentIntentId}::uuid,
          ${fixture.relationshipId}::uuid, ${fixture.analyticsAgreementId}::uuid,
          ${fixture.organizationId}::uuid, ${fixture.creatorUserId}::uuid,
          1000, 800, 200, 'SOL', 'confirmed', now() - interval '2 hours',
          now() - interval '2 hours'
        ),
        (
          ${fixture.laterAllocationId}::uuid, ${fixture.laterPaymentIntentId}::uuid,
          ${fixture.relationshipId}::uuid, ${fixture.laterAgreementId}::uuid,
          ${fixture.organizationId}::uuid, ${fixture.creatorUserId}::uuid,
          2000, 1600, 400, 'SOL', 'confirmed', now(), now()
        )
    `;
  });
}

async function cleanupReportingFixture(
  sql: PostgresSql,
  fixture: ReportingFixtureIds
): Promise<void> {
  await sql.begin(async (tx) => {
    await tx`
      delete from managed_creator_allocation_records
      where id in (${fixture.historicalAllocationId}::uuid, ${fixture.laterAllocationId}::uuid)
    `;
    await tx`
      delete from payment_intents
      where id in (${fixture.historicalPaymentIntentId}::uuid, ${fixture.laterPaymentIntentId}::uuid)
    `;
    await tx`delete from managed_creator_agreements where relationship_id = ${fixture.relationshipId}::uuid`;
    await tx`delete from managed_creator_relationships where id = ${fixture.relationshipId}::uuid`;
    await tx`delete from organization_memberships where id = ${fixture.membershipId}::uuid`;
    await tx`delete from organizations where id = ${fixture.organizationId}::uuid`;
    await tx`
      delete from users
      where id in (${fixture.creatorUserId}::uuid, ${fixture.organizationMemberUserId}::uuid)
    `;
  });
}
