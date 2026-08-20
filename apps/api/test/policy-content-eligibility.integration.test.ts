import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createPostgresClient } from "../src/shared/postgres";
import { createPostgresSubscriptionCollectionRepository } from "../../worker/src/subscription-collections";

const enabled = ["1", "true"].includes(
  process.env.VEEL_ENABLE_REAL_API_INTEGRATION_TESTS ?? ""
);
const describeIntegration = enabled ? describe : describe.skip;

describeIntegration("canonical policy and content eligibility against Postgres", () => {
  it("resolves risk-based KYC and applies one viewer-relative content gate", async () => {
    const databaseUrl = process.env.API_INTEGRATION_DATABASE_URL;
    if (!databaseUrl || !/^postgres(?:ql)?:\/\/(?:postgres(?::[^@]*)?@)?(?:127\.0\.0\.1|localhost):/u.test(databaseUrl)) {
      throw new Error("A loopback API_INTEGRATION_DATABASE_URL is required");
    }

    const sql = createPostgresClient(databaseUrl);
    const creatorId = randomUUID();
    const viewerId = randomUUID();
    const safeContentId = randomUUID();
    const adultContentId = randomUUID();
    const pendingContentId = randomUUID();
    const followerContentId = randomUUID();
    const subscriberContentId = randomUUID();
    const membershipId = randomUUID();
    const entitlementId = randomUUID();
    const creatorWalletId = randomUUID();
    const suffix = creatorId.replaceAll("-", "").slice(0, 12);
    const membershipPlanId = `eligibility-membership-${suffix}`;
    const policySnapshot = await sql<Array<{
      kyc_mode: "disabled" | "risk_based" | "required";
      policy_version: string;
      kyc_required_jurisdictions: string[];
      kyc_required_product_types: string[];
    }>>`
      select kyc_mode, policy_version, kyc_required_jurisdictions, kyc_required_product_types
      from recipient_monetisation_policies
      where policy_key = 'default'
    `;

    try {
      await sql`
        insert into users (id, supabase_user_id, state)
        values
          (${creatorId}, ${creatorId}, 'active'),
          (${viewerId}, ${viewerId}, 'active')
      `;
      await sql`
        insert into profiles (user_id, handle, display_name, visibility)
        values (${creatorId}, ${`eligibility_${suffix}`}, 'Eligibility creator', 'public')
      `;
      await sql`
        insert into verification_records (
          subject_type, subject_id, purpose, status, provider, provider_reference,
          method, threshold_age, result_over_threshold, assurance_level, verified_at, reusable
        ) values
          ('user', ${creatorId}, 'age_access', 'valid', 'internal',
            ${`creator-age-${suffix}`}, 'reusable_age', 18, true, 'high', now(), false),
          ('user', ${viewerId}, 'age_access', 'valid', 'internal',
            ${`viewer-age-${suffix}`}, 'reusable_age', 18, true, 'high', now(), false)
      `;

      const baseline = await sql<Array<{
        kyc_required: boolean;
        decision_reason: string;
      }>>`
        select kyc_required, decision_reason
        from private.resolve_recipient_monetisation_policy(${creatorId}, 'support')
      `;
      expect(baseline[0]).toMatchObject({
        kyc_required: false,
        decision_reason: "risk_policy_not_triggered"
      });

      await sql`
        update verification_records
        set jurisdiction = 'rs'
        where subject_type = 'user'
          and subject_id = ${creatorId}
          and purpose = 'age_access'
      `;
      await sql`
        update recipient_monetisation_policies
        set kyc_required_jurisdictions = array['  rs  ']
        where policy_key = 'default'
      `;
      const jurisdictionTriggered = await sql<Array<{
        kyc_required: boolean;
        decision_reason: string;
        jurisdiction: string;
      }>>`
        select kyc_required, decision_reason, jurisdiction
        from private.resolve_recipient_monetisation_policy(${creatorId}, 'support')
      `;
      expect(jurisdictionTriggered[0]).toMatchObject({
        kyc_required: true,
        decision_reason: "jurisdiction_policy_required",
        jurisdiction: "RS"
      });
      await sql`
        update recipient_monetisation_policies
        set kyc_required_jurisdictions = ${policySnapshot[0]?.kyc_required_jurisdictions ?? []}
        where policy_key = 'default'
      `;

      await sql`
        insert into recipient_monetisation_risk_assessments (
          user_id, product_type, risk_score, reason_codes, source, policy_version
        ) values (
          ${creatorId}, 'support', 90, array['velocity_threshold'],
          'deterministic_rules', 'integration-risk-v1'
        )
      `;
      const riskTriggered = await sql<Array<{
        kyc_required: boolean;
        decision_reason: string;
        risk_score: number;
      }>>`
        select kyc_required, decision_reason, risk_score
        from private.resolve_recipient_monetisation_policy(${creatorId}, 'support')
      `;
      expect(riskTriggered[0]).toMatchObject({
        kyc_required: true,
        decision_reason: "risk_threshold_required",
        risk_score: 90
      });

      await sql`
        insert into recipient_monetisation_overrides (
          user_id, kyc_requirement, reason_code, effective_at
        ) values (
          ${creatorId}, 'not_required', 'integration_override', now()
        )
      `;
      const override = await sql<Array<{
        kyc_required: boolean;
        decision_reason: string;
      }>>`
        select kyc_required, decision_reason
        from private.resolve_recipient_monetisation_policy(${creatorId}, 'support')
      `;
      expect(override[0]).toMatchObject({
        kyc_required: false,
        decision_reason: "account_override_not_required"
      });

      await sql`
        update recipient_monetisation_policies
        set kyc_mode = 'required', policy_version = 'integration-required-v2'
        where policy_key = 'default'
      `;
      const requiredPolicy = await sql<Array<{
        kyc_required: boolean;
        policy_version: string;
        decision_reason: string;
      }>>`
        select kyc_required, policy_version, decision_reason
        from private.resolve_recipient_monetisation_policy(${creatorId}, 'support')
      `;
      expect(requiredPolicy[0]).toMatchObject({
        kyc_required: true,
        policy_version: "integration-required-v2",
        decision_reason: "global_policy_required"
      });
      await sql`
        update recipient_monetisation_policies
        set kyc_mode = ${policySnapshot[0]?.kyc_mode ?? "risk_based"},
            policy_version = ${policySnapshot[0]?.policy_version ?? "recipient-risk-v1"},
            kyc_required_jurisdictions = ${policySnapshot[0]?.kyc_required_jurisdictions ?? []}
        where policy_key = 'default'
      `;

      await sql`
        update recipient_monetisation_overrides
        set kyc_requirement = 'required', reason_code = 'integration_required_override'
        where user_id = ${creatorId}
      `;
      const requiredOverride = await sql<Array<{
        kyc_required: boolean;
        decision_reason: string;
        decision_effective_at: Date;
        decision_expires_at: Date | null;
      }>>`
        select kyc_required, decision_reason, decision_effective_at, decision_expires_at
        from private.resolve_recipient_monetisation_policy(${creatorId}, 'support')
      `;
      expect(requiredOverride[0]).toMatchObject({
        kyc_required: true,
        decision_reason: "account_override_required"
      });
      expect(requiredOverride[0]?.decision_effective_at).toBeInstanceOf(Date);
      expect(requiredOverride[0]?.decision_expires_at).toBeNull();

      await sql`
        update recipient_monetisation_overrides
        set effective_at = now() - interval '2 days',
            expires_at = now() - interval '1 day'
        where user_id = ${creatorId}
      `;
      await sql`
        delete from recipient_monetisation_risk_assessments where user_id = ${creatorId}
      `;
      const expiredOverride = await sql<Array<{
        kyc_required: boolean;
        decision_reason: string;
      }>>`
        select kyc_required, decision_reason
        from private.resolve_recipient_monetisation_policy(${creatorId}, 'support')
      `;
      expect(expiredOverride[0]).toMatchObject({
        kyc_required: false,
        decision_reason: "risk_policy_not_triggered"
      });

      await sql`
        update recipient_monetisation_policies
        set kyc_mode = 'disabled', policy_version = 'integration-disabled-v2'
        where policy_key = 'default'
      `;
      const disabled = await sql<Array<{
        kyc_required: boolean;
        policy_version: string;
        decision_reason: string;
      }>>`
        select kyc_required, policy_version, decision_reason
        from private.resolve_recipient_monetisation_policy(${creatorId}, 'support')
      `;
      expect(disabled[0]).toMatchObject({
        kyc_required: false,
        policy_version: "integration-disabled-v2",
        decision_reason: "global_policy_disabled"
      });
      await sql`
        update recipient_monetisation_policies
        set kyc_mode = ${policySnapshot[0]?.kyc_mode ?? "risk_based"},
            policy_version = ${policySnapshot[0]?.policy_version ?? "recipient-risk-v1"},
            kyc_required_jurisdictions = ${policySnapshot[0]?.kyc_required_jurisdictions ?? []}
        where policy_key = 'default'
      `;

      await sql`
        insert into wallets (id, user_id, provider, address, chain, is_primary)
        values (
          ${creatorWalletId}, ${creatorId}, 'wallet_adapter',
          ${`integration-wallet-${suffix}`}, 'solana_devnet', true
        )
      `;
      await sql`
        insert into creator_monetisation_settings (
          user_id, state, earning_state, tax_profile_state,
          earnings_recipient_wallet_id, earnings_terms_version,
          earnings_terms_accepted_at, support_enabled, live_passes_enabled,
          subscriptions_enabled
        ) values (
          ${creatorId}, 'active', 'ready', 'not_required', ${creatorWalletId},
          'wevid-creator-earnings-v1', now(), true, true, true
        )
      `;
      await sql`
        update recipient_monetisation_policies
        set kyc_required_product_types = array['live_pass']
        where policy_key = 'default'
      `;
      const livePolicy = await sql<Array<{
        kyc_required: boolean;
        decision_reasons: string[];
      }>>`
        select kyc_required, decision_reasons
        from private.resolve_creator_monetisation_policy(${creatorId})
      `;
      expect(livePolicy[0]?.kyc_required).toBe(true);
      expect(livePolicy[0]?.decision_reasons).toContain("product_policy_required");
      await sql`
        update recipient_monetisation_policies
        set kyc_required_product_types = ${policySnapshot[0]?.kyc_required_product_types ?? []}
        where policy_key = 'default'
      `;
      const readiness = await sql<Array<{
        product_type: string;
        kyc_required: boolean;
        decision_reason: string;
      }>>`
        select 'support'::text as product_type, kyc_required, decision_reason
        from private.assert_recipient_monetisation_ready(
          ${creatorId}, 'support', 'solana_devnet', null
        )
        union all
        select 'creator_subscription', kyc_required, decision_reason
        from private.assert_recipient_monetisation_ready(
          ${creatorId}, 'creator_subscription', 'solana_devnet', null
        )
        order by product_type
      `;
      expect(readiness).toEqual([
        {
          product_type: "creator_subscription",
          kyc_required: false,
          decision_reason: "risk_policy_not_triggered"
        },
        {
          product_type: "support",
          kyc_required: false,
          decision_reason: "risk_policy_not_triggered"
        }
      ]);

      await sql`
        insert into recipient_monetisation_risk_assessments (
          user_id, product_type, risk_score, reason_codes, source, policy_version
        ) values
          (${creatorId}, 'support', 90, array['velocity_threshold'],
            'deterministic_rules', 'integration-risk-v2'),
          (${creatorId}, 'creator_subscription', 90, array['velocity_threshold'],
            'deterministic_rules', 'integration-risk-v2')
      `;
      await expect(sql`
        select * from private.assert_recipient_monetisation_ready(
          ${creatorId}, 'support', 'solana_devnet', null
        )
      `).rejects.toThrow(/recipient_creator_kyc_required/);
      await expect(sql`
        select * from private.assert_recipient_monetisation_ready(
          ${creatorId}, 'creator_subscription', 'solana_devnet', null
        )
      `).rejects.toThrow(/recipient_creator_kyc_required/);

      await sql`
        insert into verification_records (
          subject_type, subject_id, purpose, status, provider, provider_reference,
          method, assurance_level, verified_at, reusable
        ) values (
          'user', ${creatorId}, 'creator_kyc', 'valid', 'internal',
          ${`creator-kyc-${suffix}`}, 'manual_review', 'high', now(), false
        )
      `;
      const requiredReadiness = await sql<Array<{ product_type: string }>>`
        select 'support'::text as product_type
        from private.assert_recipient_monetisation_ready(
          ${creatorId}, 'support', 'solana_devnet', null
        )
        union all
        select 'creator_subscription'
        from private.assert_recipient_monetisation_ready(
          ${creatorId}, 'creator_subscription', 'solana_devnet', null
        )
        order by product_type
      `;
      expect(requiredReadiness.map((row) => row.product_type)).toEqual([
        "creator_subscription",
        "support"
      ]);

      // This fixture exercises the read gate in isolation. The main authenticated
      // integration journey separately proves the release-evidence write gate.
      await sql.begin(async (transaction) => {
        await transaction`set local session_replication_role = replica`;
        await transaction`
          insert into content_items (
            id, creator_user_id, media_type, state, visibility,
            nsfw_label, moderation_state, publish_state, published_at
          ) values
            (${safeContentId}, ${creatorId}, 'image', 'ready', 'public',
              'none', 'approved', 'published', now()),
            (${adultContentId}, ${creatorId}, 'image', 'ready', 'public',
              'explicit', 'approved', 'published', now()),
            (${pendingContentId}, ${creatorId}, 'image', 'ready', 'public',
              'none', 'pending', 'published', now()),
            (${followerContentId}, ${creatorId}, 'image', 'ready', 'followers',
              'none', 'approved', 'published', now()),
            (${subscriberContentId}, ${creatorId}, 'image', 'ready', 'subscribers',
              'none', 'approved', 'published', now())
        `;
      });

      const anonymous = await sql<Array<{ content_item_id: string }>>`
        select content_item_id from private.eligible_content(null, null)
        where content_item_id in (
          ${safeContentId}, ${adultContentId}, ${pendingContentId},
          ${followerContentId}, ${subscriberContentId}
        )
      `;
      expect(anonymous.map((row) => row.content_item_id)).toEqual([safeContentId]);

      await sql`
        insert into viewer_feed_preferences (user_id, default_feed_mode, nsfw_preference)
        values (${viewerId}, 'recommended', 'both')
      `;
      const both = await sql<Array<{ content_item_id: string }>>`
        select content_item_id from private.eligible_content(${viewerId}, null)
        where content_item_id in (
          ${safeContentId}, ${adultContentId}, ${pendingContentId},
          ${followerContentId}, ${subscriberContentId}
        )
        order by content_item_id
      `;
      expect(both.map((row) => row.content_item_id).sort()).toEqual(
        [safeContentId, adultContentId].sort()
      );

      await sql`
        insert into user_follows (follower_user_id, followed_user_id, state)
        values (${viewerId}, ${creatorId}, 'active')
      `;
      await sql`
        insert into subscription_plans (
          id, scope, creator_user_id, label, amount_minor, currency, period_days,
          provider_state, token_mint, token_program, state,
          amount_atomic, period_seconds, creator_amount_atomic
        ) values (
          ${membershipPlanId}, 'creator', ${creatorId}, 'Eligibility membership',
          1000000, 'USDC', 30, 'staging_required', 'integration-mint',
          'spl_token', 'disabled', 1000000, 2592000, 1000000
        )
      `;
      await sql`
        insert into subscriptions (
          id, subscriber_user_id, scope, plan_id, creator_user_id, state,
          token_mint, amount_atomic, period_seconds,
          current_period_starts_at, current_period_ends_at
        ) values (
          ${membershipId}, ${viewerId}, 'creator', ${membershipPlanId}, ${creatorId},
          'active', 'integration-mint', 1000000, 2592000,
          now() - interval '1 day', now() + interval '29 days'
        )
      `;
      const relationshipEligible = await sql<Array<{ content_item_id: string }>>`
        select content_item_id from private.eligible_content(${viewerId}, 'both')
        where content_item_id in (
          ${safeContentId}, ${adultContentId}, ${followerContentId}, ${subscriberContentId}
        )
        order by content_item_id
      `;
      expect(relationshipEligible.map((row) => row.content_item_id).sort()).toEqual(
        [safeContentId, adultContentId, followerContentId, subscriberContentId].sort()
      );

      await sql`
        update subscriptions
        set state = 'renewal_pending',
            current_period_starts_at = null,
            current_period_ends_at = null
        where id = ${membershipId}
      `;
      const authorizationOnly = await sql<Array<{ content_item_id: string }>>`
        select content_item_id from private.eligible_content(${viewerId}, 'both')
        where content_item_id = ${subscriberContentId}
      `;
      expect(authorizationOnly).toEqual([]);

      await sql`delete from subscriptions where id = ${membershipId}`;
      await sql`
        insert into entitlements (
          id, user_id, target_type, target_id, product_type, state
        ) values (
          ${entitlementId}, ${viewerId}, 'content', ${subscriberContentId},
          'content_unlock', 'active'
        )
      `;
      const entitled = await sql<Array<{ content_item_id: string }>>`
        select content_item_id from private.eligible_content(${viewerId}, 'both')
        where content_item_id = ${subscriberContentId}
      `;
      expect(entitled.map((row) => row.content_item_id)).toEqual([subscriberContentId]);

      await sql`
        delete from verification_records
        where subject_type = 'user'
          and subject_id = ${creatorId}
          and purpose = 'creator_kyc'
      `;
      await sql`
        update subscription_plans
        set state = 'active', provider_state = 'launch_approved'
        where id = ${membershipPlanId}
      `;
      await sql`
        insert into subscriptions (
          id, subscriber_user_id, scope, plan_id, creator_user_id, state,
          token_mint, amount_atomic, period_seconds,
          current_period_starts_at, current_period_ends_at, next_collection_at
        ) values (
          ${membershipId}, ${viewerId}, 'creator', ${membershipPlanId}, ${creatorId},
          'active', 'integration-mint', 1000000, 2592000,
          now() - interval '31 days', now() - interval '1 day', now() - interval '1 hour'
        )
      `;
      const collectionRepository = createPostgresSubscriptionCollectionRepository(databaseUrl);
      try {
        const leased = await collectionRepository.leaseDueCollections({
          now: new Date(),
          limit: 5,
          leaseDurationMs: 60_000,
          maxAttempts: 3
        });
        expect(leased).toEqual([]);
      } finally {
        await collectionRepository.close?.();
      }
      const suspended = await sql<Array<{
        state: string;
        action: string;
        reason: string;
      }>>`
        select subscription.state, event.action,
          event.metadata ->> 'kycDecisionReason' as reason
        from subscriptions subscription
        join subscription_events event on event.subscription_id = subscription.id
        where subscription.id = ${membershipId}
          and event.action = 'subscription.collection_policy_suspended'
      `;
      expect(suspended[0]).toMatchObject({
        state: "suspended",
        action: "subscription.collection_policy_suspended",
        reason: "risk_threshold_required"
      });

      await sql`
        update viewer_feed_preferences set nsfw_preference = 'nsfw'
        where user_id = ${viewerId}
      `;
      const adultOnly = await sql<Array<{ content_item_id: string }>>`
        select content_item_id from private.eligible_content(${viewerId}, null)
        where content_item_id in (${safeContentId}, ${adultContentId}, ${pendingContentId})
      `;
      expect(adultOnly.map((row) => row.content_item_id)).toEqual([adultContentId]);

      await sql`
        insert into viewer_hidden_creators (user_id, creator_user_id, idempotency_key)
        values (${viewerId}, ${creatorId}, ${`hide-${suffix}`})
      `;
      const hidden = await sql<Array<{ content_item_id: string }>>`
        select content_item_id from private.eligible_content(${viewerId}, 'both')
        where content_item_id in (${safeContentId}, ${adultContentId})
      `;
      expect(hidden).toEqual([]);
    } finally {
      await sql`
        update recipient_monetisation_policies
        set kyc_mode = ${policySnapshot[0]?.kyc_mode ?? "risk_based"},
            policy_version = ${policySnapshot[0]?.policy_version ?? "recipient-risk-v1"},
            kyc_required_jurisdictions = ${policySnapshot[0]?.kyc_required_jurisdictions ?? []},
            kyc_required_product_types = ${policySnapshot[0]?.kyc_required_product_types ?? []}
        where policy_key = 'default'
      `;
      await sql`
        delete from viewer_hidden_creators
        where user_id = ${viewerId} and creator_user_id = ${creatorId}
      `;
      await sql`
        delete from user_follows
        where follower_user_id = ${viewerId} and followed_user_id = ${creatorId}
      `;
      await sql`delete from entitlements where id = ${entitlementId}`;
      await sql`delete from subscription_events where subscription_id = ${membershipId}`;
      await sql`delete from subscriptions where id = ${membershipId}`;
      await sql`delete from subscription_plans where id = ${membershipPlanId}`;
      await sql`delete from viewer_feed_preferences where user_id = ${viewerId}`;
      await sql`
        delete from recipient_monetisation_overrides where user_id = ${creatorId}
      `;
      await sql`
        delete from recipient_monetisation_risk_assessments where user_id = ${creatorId}
      `;
      await sql`delete from creator_monetisation_settings where user_id = ${creatorId}`;
      await sql`
        delete from content_items
        where id in (
          ${safeContentId}, ${adultContentId}, ${pendingContentId},
          ${followerContentId}, ${subscriberContentId}
        )
      `;
      await sql`
        delete from verification_records
        where subject_type = 'user' and subject_id in (${viewerId}, ${creatorId})
      `;
      await sql`delete from wallets where id = ${creatorWalletId}`;
      await sql`delete from profiles where user_id = ${creatorId}`;
      await sql`delete from users where id in (${viewerId}, ${creatorId})`;
      await sql.end({ timeout: 5 });
    }
  });
});
