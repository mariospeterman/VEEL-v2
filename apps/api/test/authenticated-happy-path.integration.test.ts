import { createHash, createHmac, randomUUID } from "node:crypto";
import { TextEncoder } from "node:util";
import bs58 from "bs58";
import nacl from "tweetnacl";
import { describe, expect, it, vi } from "vitest";
import { buildApi } from "../src/app";
import type { AgeProviderWaterfall } from "../src/modules/age/types";
import { createPostgresAdminRepository } from "../src/modules/admin/admin-repository";
import type {
  PaymentSettlementInput,
  PaymentSettlementVerifier
} from "../src/modules/payment/types";
import { createPostgresLiveRepository } from "../src/modules/live/live-repository";
import type {
  ApplicationSessionVerifier,
  VerifiedApplicationSession
} from "../src/modules/session/types";
import {
  createPostgresWalletAuthRepository,
  hashToken,
  WalletAuthChallengeInvalidError,
  WalletRecoveryLinkConflictError
} from "../src/modules/auth/wallet-auth-repository";
import { grantAccessPass } from "../src/modules/event/event-access-pass-repository";
import type { SubscriptionAuthorizationVerifier } from "../src/modules/subscription/types";
import { createPostgresClient, type PostgresSql } from "../src/shared/postgres";
import {
  createPostgresProviderEventReplayRepository,
  processProviderEventReplays
} from "../../worker/src/provider-event-replay";
import {
  createPostgresSubscriptionCollectionRepository,
  processDueSubscriptionCollections
} from "../../worker/src/subscription-collections";

const enableRealApiIntegration =
  process.env.VEEL_ENABLE_REAL_API_INTEGRATION_TESTS === "1" ||
  process.env.VEEL_ENABLE_REAL_API_INTEGRATION_TESTS === "true";
const describeIntegration = enableRealApiIntegration ? describe : describe.skip;
const buyerSupabaseUserId = "10000000-0000-4000-8000-000000000001";
const creatorSupabaseUserId = "10000000-0000-4000-8000-000000000002";
const authToken = "integration-buyer-token";
const creatorAuthToken = "integration-creator-token";
const sumsubWebhookSecret = "sumsub-integration-webhook-secret";
const treasuryWallet = "1".repeat(32);
const subscriptionCollectorWallet = "1".repeat(32);
const subscriptionTokenMint = "3".repeat(32);
const subscriptionAuthorityAddress = "4".repeat(32);
const subscriptionDelegationAddress = "5".repeat(32);
const subscriptionTokenAccount = "6".repeat(32);
const subscriptionPlanPda = "7".repeat(32);
const subscriptionMerchantWallet = "8".repeat(32);
const subscriptionProgramId = "De1egAFMkMWZSN5rYXRj9CAdheBamobVNubTsi9avR44";
const creatorSettlementWallet = "2".repeat(32);
const validSolanaSignature =
  "5Pj5fCupXLUePYn18JkY8SrRaWFiUctuDTRwvUy2MLgVFG1FsCeezrWwZsmxkL5YJQFmQpAcY7rc5pN6vrXJt7Qp";
const validEventAccessSolanaSignature = deterministicBase58Signature(41);
const validPaidMessageSolanaSignature = deterministicBase58Signature(83);
const validDeclinedPaidMessageSolanaSignature = deterministicBase58Signature(97);
const validLivePassSolanaSignature = deterministicBase58Signature(127);
const validRemediationSolanaSignature = deterministicBase58Signature(139);
const invalidReservationSolanaSignature = deterministicBase58Signature(151);
const validSubscriptionAuthorizationSignature = deterministicBase58Signature(149);

describeIntegration("authenticated API happy path against Postgres", () => {
  it("links wallet, verifies age, creates content, unlocks content, buys Event Access, sends a paid message, buys paid live event access, and verifies subscriptions", async () => {
    const databaseUrl = integrationDatabaseUrl();
    assertIntegrationDatabaseIsAllowed(databaseUrl);

    const sql = createPostgresClient(databaseUrl);
    const runId = randomUUID();
    const shortRunId = runId.replaceAll("-", "").slice(0, 12);
    const buyerHandle = `buyer_${shortRunId}`;
    const creatorHandle = `creator_${shortRunId}`;
    const seededCreatorUserId = randomUUID();
    const seededContentId = randomUUID();
    const seededMediaAssetId = randomUUID();
    const seededAccessRuleId = randomUUID();
    const seededFreeContentId = randomUUID();
    const seededFreeMediaAssetId = randomUUID();
    const seededEventId = randomUUID();
    const seededAccessPassTypeId = randomUUID();
    const seededFreeAccessPassTypeId = randomUUID();
    const seededRemediationAccessPassTypeId = randomUUID();
    const seededInvalidAccessPassTypeId = randomUUID();
    const seededConversationId = randomUUID();
    const seededLiveRoomId = randomUUID();
    const seededSubscriptionPlanId = `integration-platform-${shortRunId}`;
    const seededProviderEventId = randomUUID();
    const seededProviderReplayRequestId = randomUUID();
    const seededOrganizationId = randomUUID();
    const seededOrganizationMembershipId = randomUUID();
    const seededEnterpriseWaiverId = randomUUID();
    const providerReference = `sumsub-${runId}`;
    const ageProviderWaterfall = createIntegrationAgeWaterfall(providerReference);
    const walletAuthRepository = createPostgresWalletAuthRepository(sql);
    const settlementInputs: PaymentSettlementInput[] = [];
    const settlementVerifier: PaymentSettlementVerifier = {
      async verifyTransfer(input) {
        settlementInputs.push(input);

        if (input.signature === invalidReservationSolanaSignature) {
          return { confirmed: false, failureCode: "invalid_signature" };
        }
        return {
          confirmed: true
        };
      }
    };

    vi.stubEnv("DATABASE_URL", databaseUrl);
    vi.stubEnv("SUMSUB_WEBHOOK_SECRET", sumsubWebhookSecret);
    vi.stubEnv("PAYMENT_PLATFORM_TREASURY_WALLET", treasuryWallet);
    vi.stubEnv("SOLANA_SUBSCRIPTION_COLLECTOR_WALLET", subscriptionCollectorWallet);
    vi.stubEnv("SUBSCRIPTIONS_ENABLED", "true");
    vi.stubEnv("SUBSCRIPTIONS_PROVIDER", "official_solana_subscription_program");
    vi.stubEnv("SUBSCRIPTIONS_SOLANA_RPC_URL", "https://api.devnet.solana.com");
    vi.stubEnv("SUBSCRIPTIONS_SUPPORTED_MINTS", subscriptionTokenMint);
    vi.stubEnv("SUBSCRIPTIONS_DEFAULT_MINT", subscriptionTokenMint);
    vi.stubEnv("SUBSCRIPTIONS_COLLECTOR_WALLET", subscriptionCollectorWallet);
    vi.stubEnv("SUBSCRIPTIONS_MERCHANT_WALLET", subscriptionMerchantWallet);

    const subscriptionVerificationInputs: Parameters<
      SubscriptionAuthorizationVerifier["verifyAuthorization"]
    >[0][] = [];
    const subscriptionAuthorizationVerifier: SubscriptionAuthorizationVerifier = {
      async verifyAuthorization(input) {
        subscriptionVerificationInputs.push(input);

        return {
          verified: true,
          facts: {
            subscriberWallet: input.subscriberWallet ?? "",
            authorityAddress: input.authorityAddress,
            delegationAddress: input.delegationAddress,
            subscriberTokenAccount: input.subscriberTokenAccount,
            tokenMint: input.tokenMint ?? "",
            subscriptionPda: input.subscriptionPda,
            delegationExpiresAt: input.delegationExpiresAt.toISOString(),
            planPda: input.planPda,
            programId: input.delegationProgramId,
            merchantWallet: input.merchantWallet,
            collectorWallet: input.collectorAddress,
            amountMinor: input.amountMinor,
            periodDays: input.periodDays,
            verifiedAt: new Date().toISOString()
          }
        };
      }
    };

    const liveRepository = createPostgresLiveRepository(sql);
    const app = await buildApi({
      authVerifier: integrationAuthVerifier,
      walletAuthRepository: {
        ...walletAuthRepository,
        async rotateSessionToken(input) {
          return { accessToken: input.sessionToken, expiresAt: new Date(Date.now() + 10 * 60 * 1000) };
        }
      },
      ageProviderWaterfall,
      settlementVerifier,
      subscriptionAuthorizationVerifier,
      subscriptionAuthorizationTransactionBuilder: async ({ context }) => {
        expect(context.setupReference).toBeTruthy();
        return {
          transaction: Buffer.from(`subscription-authorization:${context.setupReference}`).toString("base64"),
          authorityAddress: subscriptionAuthorityAddress,
          delegationAddress: subscriptionDelegationAddress,
          subscriberTokenAccount: subscriptionTokenAccount,
          delegationExpiresAt: new Date(Date.now() + 366 * 24 * 60 * 60 * 1000).toISOString()
        };
      },
      liveRepository,
      liveProvider: {
        async setRoomSuspended() {},
        async terminateRoom() {},
        isConfigured: () => true,
        async createRoom() {
          throw new Error("Integration test seeds the live room directly.");
        },
        async getRoomStatus() {
          throw new Error("Integration test does not sync provider status.");
        },
        async createPlaybackJwt(input) {
          expect(input).toEqual({
            playbackId: `livepeer-playback-${shortRunId}`,
            appUserId: buyerSupabaseUserId
          });
          return `integration-live-jwt-${shortRunId}`;
        }
      },
      postgresClient: sql
    });

    try {
      await app.ready();
      const acceptImmediateCheckout = async (paymentIntentId: string, suffix: string) => {
        const idempotencyKey = `checkout-consent-${suffix}-${runId}`;
        const response = await app.inject({
          method: "POST",
          url: `/v1/payments/intents/${paymentIntentId}/consent`,
          headers: authenticatedHeaders(idempotencyKey),
          payload: {
            termsVersion: "veel-terms-v1",
            withdrawalWaiverVersion: "instant-digital-access-v1",
            immediateAccessAcknowledged: true
          }
        });
        expect(response.statusCode, response.body).toBe(200);
        return { idempotencyKey, response };
      };
      await cleanupRun(sql, {
        buyerHandle,
        creatorHandle,
        buyerSupabaseUserId,
        creatorSupabaseUserId,
        providerReference,
        seededContentId,
        seededFreeContentId,
        seededEventId,
        seededConversationId,
        seededLiveRoomId,
        seededSubscriptionPlanId,
        seededProviderEventId,
        seededProviderReplayRequestId,
        seededOrganizationId
      });
      await seedCanonicalIntegrationUser(sql, {
        userId: buyerSupabaseUserId,
        supabaseUserId: buyerSupabaseUserId
      });
      await sql`
        insert into app_sessions (
          id, user_id, wallet_id, token_hash, expires_at, authentication_method, authenticated_at
        )
        values (
          ${randomUUID()}, ${buyerSupabaseUserId}, null, ${hashToken(authToken)},
          now() + interval '30 minutes', 'supabase_recovery', now()
        )
      `;
      await seedCreatorPaidContent(sql, {
        creatorUserId: seededCreatorUserId,
        creatorSupabaseUserId,
        creatorHandle,
        contentId: seededContentId,
        mediaAssetId: seededMediaAssetId,
        accessRuleId: seededAccessRuleId
      });
      await seedCreatorFreeVideo(sql, {
        creatorUserId: seededCreatorUserId,
        contentId: seededFreeContentId,
        mediaAssetId: seededFreeMediaAssetId
      });
      await seedCreatorPaidEvent(sql, {
        creatorUserId: seededCreatorUserId,
        eventId: seededEventId,
        accessPassTypeId: seededAccessPassTypeId,
        freeAccessPassTypeId: seededFreeAccessPassTypeId,
        remediationAccessPassTypeId: seededRemediationAccessPassTypeId,
        invalidAccessPassTypeId: seededInvalidAccessPassTypeId,
        idempotencyKey: `event-${runId}`
      });
      await seedCreatorLiveRoom(sql, {
        creatorUserId: seededCreatorUserId,
        liveRoomId: seededLiveRoomId,
        shortRunId,
        idempotencyKey: `live-room-${runId}`
      });
      await seedPlatformSubscriptionPlan(sql, {
        planId: seededSubscriptionPlanId
      });

      const walletKeypair = nacl.sign.keyPair();
      const walletAddress = bs58.encode(walletKeypair.publicKey);
      const challengeResponse = await app.inject({
        method: "POST",
        url: "/v1/wallets/link-challenges",
        headers: authenticatedHeaders(`wallet-challenge-${runId}`),
        payload: {
          chain: "solana_devnet",
          provider: "phantom",
          address: walletAddress
        }
      });

      expect(challengeResponse.statusCode, challengeResponse.body).toBe(201);
      const challenge = challengeResponse.json<{ id: string; message: string }>();
      const signature = nacl.sign.detached(
        new TextEncoder().encode(challenge.message),
        walletKeypair.secretKey
      );
      const linkResponse = await app.inject({
        method: "POST",
        url: "/v1/wallets/link",
        headers: authenticatedHeaders(`wallet-link-${runId}`),
        payload: {
          chain: "solana_devnet",
          provider: "phantom",
          address: walletAddress,
          proof: {
            challengeId: challenge.id,
            message: challenge.message,
            signature: bs58.encode(signature),
            signatureEncoding: "base58"
          }
        }
      });

      expect(linkResponse.statusCode, linkResponse.body).toBe(201);
      expect(linkResponse.json()).toMatchObject({
        chain: "solana_devnet",
        provider: "phantom",
        address: walletAddress,
        isPrimary: true
      });
      const linkedWallet = linkResponse.json<{ id: string }>();

      const ageSessionResponse = await app.inject({
        method: "POST",
        url: "/v1/age/sessions",
        headers: authenticatedHeaders(`age-session-${runId}`),
        payload: {
          providerPreference: "sumsub"
        }
      });

      expect(ageSessionResponse.statusCode, ageSessionResponse.body).toBe(201);
      expect(ageSessionResponse.json()).toMatchObject({
        id: providerReference,
        provider: "sumsub"
      });

      const webhookPayload = JSON.stringify({
        type: "applicantReviewed",
        applicantId: providerReference,
        correlationId: `sumsub-event-${runId}`,
        reviewResult: {
          reviewAnswer: "GREEN"
        },
        createdAt: new Date().toISOString()
      });
      const ageWebhookResponse = await app.inject({
        method: "POST",
        url: "/v1/webhooks/age/sumsub",
        headers: {
          "content-type": "application/json",
          "x-payload-digest": sumsubDigest(webhookPayload),
          "x-payload-digest-alg": "HMAC_SHA256_HEX"
        },
        payload: webhookPayload
      });

      expect(ageWebhookResponse.statusCode, ageWebhookResponse.body).toBe(202);
      expect(ageWebhookResponse.json()).toEqual({
        provider: "sumsub",
        received: 1,
        processed: 1
      });

      const ageStatusResponse = await app.inject({
        method: "GET",
        url: "/v1/age/status",
        headers: authenticatedHeaders(`age-status-${runId}`)
      });

      expect(ageStatusResponse.statusCode, ageStatusResponse.body).toBe(200);
      expect(ageStatusResponse.json()).toMatchObject({ state: "verified", provider: "sumsub" });

      const profileResponse = await app.inject({
        method: "PATCH",
        url: "/v1/profiles/me",
        headers: authenticatedHeaders(`profile-${runId}`),
        payload: {
          handle: buyerHandle,
          displayName: "Integration Buyer",
          bio: "Real API integration coverage"
        }
      });

      expect(profileResponse.statusCode, profileResponse.body).toBe(200);
      expect(profileResponse.json()).toMatchObject({
        handle: buyerHandle,
        displayName: "Integration Buyer"
      });

      // Blank legacy display metadata must never override canonical handle readiness.
      await sql`
        update profiles
        set display_name = ''
        where handle = ${buyerHandle}
      `;

      await sql`
        insert into creator_monetisation_settings (user_id)
        select id from users where supabase_user_id = ${buyerSupabaseUserId}
        on conflict (user_id) do nothing
      `;
      await expect(
        sql`
          update creator_monetisation_settings cms
          set earning_state = 'ready'
          from users u
          where cms.user_id = u.id
            and u.supabase_user_id = ${buyerSupabaseUserId}
        `
      ).rejects.toThrow(/creator_monetisation_settings_ready_terms_check/);

      const creatorOnboardingPayload = {
        recipientWalletId: linkedWallet.id,
        earningsTermsVersion: "wevid-creator-earnings-v1" as const,
        earningsTermsAccepted: true as const,
        products: {
          support: true,
          contentUnlocks: true,
          eventAccessAndLive: true,
          paidMessages: true,
          memberships: true
        }
      };
      const creatorOnboardingRequest = {
        method: "PATCH" as const,
        url: "/v1/profiles/me/creator-onboarding",
        headers: authenticatedHeaders(`creator-onboarding-${runId}`),
        payload: creatorOnboardingPayload
      };
      const creatorOnboardingResponse = await app.inject(creatorOnboardingRequest);

      expect(creatorOnboardingResponse.statusCode, creatorOnboardingResponse.body).toBe(200);
      expect(creatorOnboardingResponse.json()).toMatchObject({
        state: "ready",
        canStartEarning: true,
        configuration: {
          recipientWalletId: linkedWallet.id,
          earningsTermsVersion: "wevid-creator-earnings-v1",
          products: creatorOnboardingPayload.products
        }
      });
      const repeatedCreatorOnboardingResponse = await app.inject(creatorOnboardingRequest);
      expect(repeatedCreatorOnboardingResponse.statusCode, repeatedCreatorOnboardingResponse.body).toBe(200);
      expect(repeatedCreatorOnboardingResponse.json()).toEqual(creatorOnboardingResponse.json());

      const conflictingCreatorOnboardingResponse = await app.inject({
        ...creatorOnboardingRequest,
        payload: {
          ...creatorOnboardingPayload,
          products: { ...creatorOnboardingPayload.products, paidMessages: false }
        }
      });
      expect(conflictingCreatorOnboardingResponse.statusCode, conflictingCreatorOnboardingResponse.body).toBe(409);

      await sql`
        update profiles
        set display_name = 'Integration Buyer'
        where handle = ${buyerHandle}
      `;

      const creatorOnboardingRows = await sql<{
        settings_count: string;
        receipt_count: string;
        audit_count: string;
      }[]>`
        select
          (
            select count(*)
            from creator_monetisation_settings cms
            join users u on u.id = cms.user_id
            where u.supabase_user_id = ${buyerSupabaseUserId}
              and cms.earnings_recipient_wallet_id = ${linkedWallet.id}
              and cms.earnings_terms_version = 'wevid-creator-earnings-v1'
              and cms.earnings_terms_accepted_at is not null
              and cms.earning_state = 'ready'
              and cms.support_enabled
              and cms.content_unlocks_enabled
              and cms.live_passes_enabled
              and cms.paid_messages_enabled
          ) as settings_count,
          (
            select count(*)
            from creator_onboarding_action_receipts coar
            join users u on u.id = coar.actor_user_id
            where u.supabase_user_id = ${buyerSupabaseUserId}
              and coar.idempotency_key = ${`creator-onboarding-${runId}`}
          ) as receipt_count,
          (
            select count(*)
            from audit_events ae
            join users u on u.id = ae.actor_user_id
            where u.supabase_user_id = ${buyerSupabaseUserId}
              and ae.action = 'creator_earnings_configuration_updated'
              and ae.idempotency_key = ${`creator-onboarding-${runId}`}
          ) as audit_count
      `;
      expect(creatorOnboardingRows[0]).toEqual({
        settings_count: "1",
        receipt_count: "1",
        audit_count: "1"
      });

      const preferenceRequest = {
        method: "PATCH" as const,
        url: "/v1/notifications/preferences",
        headers: authenticatedHeaders(`notification-preferences-${runId}`),
        payload: { messagesEnabled: false, pushEnabled: false }
      };
      const [preferenceResponse, concurrentPreferenceResponse] = await Promise.all([
        app.inject(preferenceRequest),
        app.inject(preferenceRequest)
      ]);
      expect(preferenceResponse.statusCode, preferenceResponse.body).toBe(200);
      expect(concurrentPreferenceResponse.statusCode, concurrentPreferenceResponse.body).toBe(200);
      expect(concurrentPreferenceResponse.json()).toEqual(preferenceResponse.json());
      const conflictingPreferenceResponse = await app.inject({
        ...preferenceRequest,
        payload: { messagesEnabled: true }
      });
      expect(conflictingPreferenceResponse.statusCode, conflictingPreferenceResponse.body).toBe(409);

      const selfFollowTargetRows = await sql<{ id: string }[]>`
        select id from users where supabase_user_id = ${buyerSupabaseUserId} limit 1
      `;
      const selfFollowStateResponse = await app.inject({
        method: "GET",
        url: `/v1/follows/${selfFollowTargetRows[0]!.id}`,
        headers: authenticatedHeaders(`self-follow-read-${runId}`)
      });
      expect(selfFollowStateResponse.statusCode, selfFollowStateResponse.body).toBe(404);

      const feedFixtureIds = await seedFeedVolumeFixtures(sql, {
        creatorUserId: seededCreatorUserId,
        count: 24,
        runId
      });

      const projectionRaceContentId = feedFixtureIds.at(-1)!;
      await Promise.all([
        sql`
          insert into content_reactions (
            user_id, content_item_id, reaction_key, state, last_idempotency_key
          ) values (
            ${selfFollowTargetRows[0]!.id}, ${projectionRaceContentId}, 'like', 'active',
            ${`projection-race-buyer-${runId}`}
          )
        `,
        sql`
          insert into content_reactions (
            user_id, content_item_id, reaction_key, state, last_idempotency_key
          ) values (
            ${seededCreatorUserId}, ${projectionRaceContentId}, 'like', 'active',
            ${`projection-race-creator-${runId}`}
          )
        `
      ]);
      const projectionRaceRows = await sql<{ like_count: string }[]>`
        select like_count
        from content_engagement_counters
        where content_item_id = ${projectionRaceContentId}
      `;
      expect(projectionRaceRows[0]?.like_count).toBe("2");
      await sql`
        delete from content_reactions
        where content_item_id = ${projectionRaceContentId}
          and user_id in (${selfFollowTargetRows[0]!.id}, ${seededCreatorUserId})
      `;
      const projectionAfterDeleteRows = await sql<{ like_count: string }[]>`
        select like_count
        from content_engagement_counters
        where content_item_id = ${projectionRaceContentId}
      `;
      expect(projectionAfterDeleteRows[0]?.like_count).toBe("0");

      const followIdempotencyKey = `follow-${runId}`;
      const concurrentFollowResponses = await Promise.all([
        app.inject({
          method: "POST",
          url: `/v1/follows/${seededCreatorUserId}`,
          headers: authenticatedHeaders(followIdempotencyKey)
        }),
        app.inject({
          method: "POST",
          url: `/v1/follows/${seededCreatorUserId}`,
          headers: authenticatedHeaders(followIdempotencyKey)
        })
      ]);
      expect(concurrentFollowResponses.map((response) => response.statusCode)).toEqual([200, 200]);
      expect(concurrentFollowResponses[0]?.json()).toMatchObject({
        userId: seededCreatorUserId,
        following: true,
        followerCount: 1
      });

      const followStateResponse = await app.inject({
        method: "GET",
        url: `/v1/follows/${seededCreatorUserId}`,
        headers: authenticatedHeaders(`follow-read-${runId}`)
      });
      expect(followStateResponse.statusCode, followStateResponse.body).toBe(200);
      expect(followStateResponse.json()).toMatchObject({ following: true, followerCount: 1 });

      await sql`
        update profiles set visibility = 'private' where user_id = ${seededCreatorUserId}
      `;
      const privateCreatorFeedResponse = await app.inject({
        method: "GET",
        url: "/v1/content/feed?mode=following&surface=home",
        headers: authenticatedHeaders(`private-creator-feed-${runId}`)
      });
      expect(privateCreatorFeedResponse.statusCode, privateCreatorFeedResponse.body).toBe(200);
      expect(privateCreatorFeedResponse.json()).toMatchObject({ items: [] });

      const hiddenTargetFollowReplay = await app.inject({
        method: "POST",
        url: `/v1/follows/${seededCreatorUserId}`,
        headers: authenticatedHeaders(followIdempotencyKey)
      });
      expect(hiddenTargetFollowReplay.statusCode, hiddenTargetFollowReplay.body).toBe(200);
      expect(hiddenTargetFollowReplay.json()).toMatchObject({ following: true, followerCount: 1 });

      const hiddenTargetUnfollowResponse = await app.inject({
        method: "DELETE",
        url: `/v1/follows/${seededCreatorUserId}`,
        headers: authenticatedHeaders(`hidden-target-unfollow-${runId}`)
      });
      expect(hiddenTargetUnfollowResponse.statusCode, hiddenTargetUnfollowResponse.body).toBe(200);
      expect(hiddenTargetUnfollowResponse.json()).toMatchObject({
        following: false,
        followerCount: 0
      });
      await sql`
        update profiles set visibility = 'public' where user_id = ${seededCreatorUserId}
      `;
      const refollowResponse = await app.inject({
        method: "POST",
        url: `/v1/follows/${seededCreatorUserId}`,
        headers: authenticatedHeaders(`refollow-${runId}`)
      });
      expect(refollowResponse.statusCode, refollowResponse.body).toBe(200);
      expect(refollowResponse.json()).toMatchObject({ following: true, followerCount: 1 });

      const followingFeedResponse = await app.inject({
        method: "GET",
        url: "/v1/content/feed?mode=following&surface=home",
        headers: authenticatedHeaders(`following-feed-${runId}`)
      });
      expect(followingFeedResponse.statusCode, followingFeedResponse.body).toBe(200);
      expect(followingFeedResponse.json()).toMatchObject({
        mode: "following",
        surface: "home",
        rankingVersion: "deterministic_v1"
      });
      const staleFollowingPage = followingFeedResponse.json<{
        items: Array<{ id: string; creator: { id: string }; viewerFollowingCreator: boolean }>;
        nextCursor: string | null;
      }>();
      expect(staleFollowingPage.nextCursor).toEqual(expect.any(String));
      await sql`
        update content_engagement_counters
        set like_count = like_count + 1, updated_at = now()
        where content_item_id = ${feedFixtureIds[0]!}
      `;
      const staleRankingCursorResponse = await app.inject({
        method: "GET",
        url: `/v1/content/feed?mode=following&surface=home&cursor=${encodeURIComponent(staleFollowingPage.nextCursor!)}`,
        headers: authenticatedHeaders(`following-feed-stale-${runId}`)
      });
      expect(staleRankingCursorResponse.statusCode, staleRankingCursorResponse.body).toBe(409);
      expect(staleRankingCursorResponse.json()).toMatchObject({ code: "feed_cursor_stale" });

      const refreshedFollowingFeedResponse = await app.inject({
        method: "GET",
        url: "/v1/content/feed?mode=following&surface=home",
        headers: authenticatedHeaders(`following-feed-refreshed-${runId}`)
      });
      expect(refreshedFollowingFeedResponse.statusCode, refreshedFollowingFeedResponse.body).toBe(200);
      const firstFollowingPage = refreshedFollowingFeedResponse.json<{
        items: Array<{ id: string; creator: { id: string }; viewerFollowingCreator: boolean }>;
        nextCursor: string | null;
      }>();
      expect(firstFollowingPage.items).toHaveLength(20);
      expect(firstFollowingPage.items.every((item) =>
        item.creator.id === seededCreatorUserId && item.viewerFollowingCreator
      )).toBe(true);
      expect(firstFollowingPage.nextCursor).toEqual(expect.any(String));

      const crossSurfaceCursorResponse = await app.inject({
        method: "GET",
        url: `/v1/content/feed?mode=following&surface=bits&cursor=${encodeURIComponent(firstFollowingPage.nextCursor!)}`,
        headers: authenticatedHeaders(`following-feed-cross-surface-${runId}`)
      });
      expect(crossSurfaceCursorResponse.statusCode, crossSurfaceCursorResponse.body).toBe(400);

      const paginationImpressionResponse = await app.inject({
        method: "POST",
        url: "/v1/feed/impressions",
        headers: authenticatedHeaders(`feed-page-impression-${runId}`),
        payload: { contentId: firstFollowingPage.items[0]!.id }
      });
      expect(paginationImpressionResponse.statusCode, paginationImpressionResponse.body).toBe(202);

      const secondFollowingFeedResponse = await app.inject({
        method: "GET",
        url: `/v1/content/feed?mode=following&surface=home&cursor=${encodeURIComponent(firstFollowingPage.nextCursor!)}`,
        headers: authenticatedHeaders(`following-feed-next-${runId}`)
      });
      expect(secondFollowingFeedResponse.statusCode, secondFollowingFeedResponse.body).toBe(200);
      const secondFollowingPage = secondFollowingFeedResponse.json<{ items: Array<{ id: string }> }>();
      const firstPageIds = new Set(firstFollowingPage.items.map((item) => item.id));
      expect(secondFollowingPage.items.some((item) => firstPageIds.has(item.id))).toBe(false);
      expect(new Set([
        ...firstFollowingPage.items.map((item) => item.id),
        ...secondFollowingPage.items.map((item) => item.id)
      ]).size).toBeGreaterThanOrEqual(feedFixtureIds.length);

      const bitsFeedResponse = await app.inject({
        method: "GET",
        url: "/v1/content/feed?mode=following&surface=bits",
        headers: authenticatedHeaders(`bits-feed-${runId}`)
      });
      expect(bitsFeedResponse.statusCode, bitsFeedResponse.body).toBe(200);
      expect(bitsFeedResponse.json().items).toHaveLength(20);
      expect(bitsFeedResponse.json().items.every((item: { mediaType: string }) =>
        item.mediaType === "bit" || item.mediaType === "clip"
      )).toBe(true);

      const malformedFeedCursorResponse = await app.inject({
        method: "GET",
        url: "/v1/content/feed?mode=following&surface=home&cursor=not-a-cursor",
        headers: authenticatedHeaders(`following-feed-invalid-${runId}`)
      });
      expect(malformedFeedCursorResponse.statusCode, malformedFeedCursorResponse.body).toBe(400);

      const [impressionBaseline] = await sql<{ impression_count: number | string }[]>`
        select coalesce(impression.impression_count, 0) as impression_count
        from users viewer
        left join viewer_content_impressions impression
          on impression.user_id = viewer.id
         and impression.content_item_id = ${seededFreeContentId}
        where viewer.supabase_user_id = ${buyerSupabaseUserId}
      `;
      const impressionIdempotencyKey = `feed-impression-${runId}`;
      const impressionResponses = await Promise.all([
        app.inject({
          method: "POST",
          url: "/v1/feed/impressions",
          headers: authenticatedHeaders(impressionIdempotencyKey),
          payload: { contentId: seededFreeContentId }
        }),
        app.inject({
          method: "POST",
          url: "/v1/feed/impressions",
          headers: authenticatedHeaders(impressionIdempotencyKey),
          payload: { contentId: seededFreeContentId }
        })
      ]);
      expect(impressionResponses.map((response) => response.statusCode)).toEqual([202, 202]);

      const secondImpressionKey = `feed-impression-second-${runId}`;
      const secondImpressionResponse = await app.inject({
        method: "POST",
        url: "/v1/feed/impressions",
        headers: authenticatedHeaders(secondImpressionKey),
        payload: { contentId: seededFreeContentId }
      });
      expect(secondImpressionResponse.statusCode, secondImpressionResponse.body).toBe(202);

      const oldImpressionReplayResponse = await app.inject({
        method: "POST",
        url: "/v1/feed/impressions",
        headers: authenticatedHeaders(impressionIdempotencyKey),
        payload: { contentId: seededFreeContentId }
      });
      expect(oldImpressionReplayResponse.statusCode, oldImpressionReplayResponse.body).toBe(202);

      const impressionCountRows = await sql<{ impression_count: number }[]>`
        select impression.impression_count
        from viewer_content_impressions impression
        join users viewer on viewer.id = impression.user_id
        where viewer.supabase_user_id = ${buyerSupabaseUserId}
          and impression.content_item_id = ${seededFreeContentId}
      `;
      expect(Number(impressionCountRows[0]?.impression_count)).toBe(
        Number(impressionBaseline?.impression_count) + 2
      );

      const conflictingImpressionResponse = await app.inject({
        method: "POST",
        url: "/v1/feed/impressions",
        headers: authenticatedHeaders(impressionIdempotencyKey),
        payload: { contentId: feedFixtureIds[0] }
      });
      expect(conflictingImpressionResponse.statusCode, conflictingImpressionResponse.body).toBe(409);

      await sql`
        update feed_impression_receipts receipt
        set expires_at = now() - interval '1 second'
        from users viewer
        where viewer.id = receipt.user_id
          and viewer.supabase_user_id = ${buyerSupabaseUserId}
          and receipt.idempotency_key = ${impressionIdempotencyKey}
      `;
      const receiptCleanupResponse = await app.inject({
        method: "POST",
        url: "/v1/feed/impressions",
        headers: authenticatedHeaders(`feed-impression-cleanup-${runId}`),
        payload: { contentId: seededFreeContentId }
      });
      expect(receiptCleanupResponse.statusCode, receiptCleanupResponse.body).toBe(202);
      const expiredReceiptRows = await sql<{ receipt_count: string }[]>`
        select count(*) as receipt_count
        from feed_impression_receipts receipt
        join users viewer on viewer.id = receipt.user_id
        where viewer.supabase_user_id = ${buyerSupabaseUserId}
          and receipt.idempotency_key = ${impressionIdempotencyKey}
      `;
      expect(expiredReceiptRows[0]?.receipt_count).toBe("0");

      await seedDirectConversation(sql, {
        conversationId: seededConversationId,
        buyerSupabaseUserId,
        creatorSupabaseUserId,
        creatorUserId: seededCreatorUserId
      });

      const likeIdempotencyKey = `engagement-like-${runId}`;
      const concurrentLikeResponses = await Promise.all([
        app.inject({
          method: "POST",
          url: `/v1/engagement/${seededFreeContentId}/like`,
          headers: authenticatedHeaders(likeIdempotencyKey)
        }),
        app.inject({
          method: "POST",
          url: `/v1/engagement/${seededFreeContentId}/like`,
          headers: authenticatedHeaders(likeIdempotencyKey)
        })
      ]);
      expect(concurrentLikeResponses.map((response) => response.statusCode)).toEqual([200, 200]);
      expect(concurrentLikeResponses[0]?.json()).toMatchObject({ liked: true, likeCount: 1 });
      expect(concurrentLikeResponses[1]?.json()).toMatchObject({ liked: true, likeCount: 1 });

      const conflictingLikeResponse = await app.inject({
        method: "POST",
        url: `/v1/engagement/${seededContentId}/like`,
        headers: authenticatedHeaders(likeIdempotencyKey)
      });
      expect(conflictingLikeResponse.statusCode, conflictingLikeResponse.body).toBe(409);

      const commentIdempotencyKey = `engagement-comment-${runId}`;
      const commentPayload = { body: "Real Postgres engagement comment" };
      const concurrentCommentResponses = await Promise.all([
        app.inject({
          method: "POST",
          url: `/v1/engagement/${seededFreeContentId}/comments`,
          headers: authenticatedHeaders(commentIdempotencyKey),
          payload: commentPayload
        }),
        app.inject({
          method: "POST",
          url: `/v1/engagement/${seededFreeContentId}/comments`,
          headers: authenticatedHeaders(commentIdempotencyKey),
          payload: commentPayload
        })
      ]);
      expect(concurrentCommentResponses.map((response) => response.statusCode)).toEqual([201, 201]);
      expect(concurrentCommentResponses[0]?.json()).toEqual(concurrentCommentResponses[1]?.json());

      const conflictingCommentResponse = await app.inject({
        method: "POST",
        url: `/v1/engagement/${seededFreeContentId}/comments`,
        headers: authenticatedHeaders(commentIdempotencyKey),
        payload: { body: "Different comment" }
      });
      expect(conflictingCommentResponse.statusCode, conflictingCommentResponse.body).toBe(409);

      const shareIdempotencyKey = `engagement-share-${runId}`;
      const sharePayload = {
        targetType: "content",
        targetId: seededFreeContentId,
        mode: "copy_link"
      } as const;
      const firstShareResponse = await app.inject({
        method: "POST",
        url: "/v1/shares",
        headers: authenticatedHeaders(shareIdempotencyKey),
        payload: sharePayload
      });
      const replayedShareResponse = await app.inject({
        method: "POST",
        url: "/v1/shares",
        headers: authenticatedHeaders(shareIdempotencyKey),
        payload: sharePayload
      });
      expect(firstShareResponse.statusCode, firstShareResponse.body).toBe(201);
      expect(replayedShareResponse.statusCode, replayedShareResponse.body).toBe(201);
      expect(replayedShareResponse.json()).toEqual(firstShareResponse.json());

      const conflictingShareResponse = await app.inject({
        method: "POST",
        url: "/v1/shares",
        headers: authenticatedHeaders(shareIdempotencyKey),
        payload: { ...sharePayload, mode: "external_referral_link" }
      });
      expect(conflictingShareResponse.statusCode, conflictingShareResponse.body).toBe(409);

      const reportIdempotencyKey = `engagement-report-${runId}`;
      const reportPayload = {
        subjectType: "content",
        subjectId: seededFreeContentId,
        reason: "Integration safety review"
      } as const;
      const firstReportResponse = await app.inject({
        method: "POST",
        url: "/v1/reports",
        headers: authenticatedHeaders(reportIdempotencyKey),
        payload: reportPayload
      });
      const replayedReportResponse = await app.inject({
        method: "POST",
        url: "/v1/reports",
        headers: authenticatedHeaders(reportIdempotencyKey),
        payload: reportPayload
      });
      expect(firstReportResponse.statusCode, firstReportResponse.body).toBe(201);
      expect(replayedReportResponse.statusCode, replayedReportResponse.body).toBe(201);
      expect(replayedReportResponse.json()).toEqual(firstReportResponse.json());

      const conflictingReportResponse = await app.inject({
        method: "POST",
        url: "/v1/reports",
        headers: authenticatedHeaders(reportIdempotencyKey),
        payload: { ...reportPayload, reason: "A different safety reason" }
      });
      expect(conflictingReportResponse.statusCode, conflictingReportResponse.body).toBe(409);

      const engagementRows = await sql<{
        comment_count: string;
        like_count: string;
        report_count: string;
        report_audit_count: string;
        share_count: string;
        share_audit_count: string;
      }[]>`
        select
          (select count(*) from comments where content_item_id = ${seededFreeContentId}) as comment_count,
          (
            select count(*) from content_reactions
            where content_item_id = ${seededFreeContentId} and state = 'active'
          ) as like_count,
          (select count(*) from reports where subject_id = ${seededFreeContentId}) as report_count,
          (
            select count(*)
            from audit_events audit
            join users actor on actor.id = audit.actor_user_id
            where actor.supabase_user_id = ${buyerSupabaseUserId}
              and audit.action = 'report.created'
              and audit.idempotency_key = ${reportIdempotencyKey}
          ) as report_audit_count,
          (select count(*) from share_records where target_id = ${seededFreeContentId}) as share_count,
          (
            select count(*)
            from audit_events audit
            join users actor on actor.id = audit.actor_user_id
            where actor.supabase_user_id = ${buyerSupabaseUserId}
              and audit.action = 'share.created'
              and audit.idempotency_key = ${shareIdempotencyKey}
          ) as share_audit_count
      `;
      expect(engagementRows[0]).toEqual({
        comment_count: "1",
        like_count: "1",
        report_count: "1",
        report_audit_count: "1",
        share_count: "1",
        share_audit_count: "1"
      });

      const [engagementProjection] = await sql<{
        comment_count: string;
        like_count: string;
        share_count: string;
      }[]>`
        select like_count, comment_count, share_count
        from content_engagement_counters
        where content_item_id = ${seededFreeContentId}
      `;
      expect(engagementProjection).toEqual({
        comment_count: "1",
        like_count: "1",
        share_count: "1"
      });

      const adultDraftResponse = await app.inject({
        method: "POST",
        url: "/v1/content",
        headers: creatorAuthenticatedHeaders(`adult-content-create-${runId}`),
        payload: {
          mediaType: "image",
          visibility: "public",
          nsfwLabel: "adult",
          representationMode: "self_only",
          contentSafetyPolicyAccepted: true,
          caption: `Adult integration draft ${runId}`
        }
      });

      expect(adultDraftResponse.statusCode, adultDraftResponse.body).toBe(201);
      expect(adultDraftResponse.json()).toMatchObject({ nsfwLabel: "adult" });
      const adultContentId = adultDraftResponse.json().id as string;
      const adultSafetyRows = await sql<
        {
          representation_mode: string;
          case_state: string;
          provider_release_allowed: boolean;
          consent_count: string;
        }[]
      >`
        select
          csd.representation_mode,
          msc.state as case_state,
          msc.provider_release_allowed,
          (select count(*) from performer_consents pc where pc.content_item_id = ci.id) as consent_count
        from content_items ci
        join content_safety_declarations csd on csd.content_item_id = ci.id
        join media_safety_cases msc on msc.content_item_id = ci.id
        where ci.id = ${adultContentId}
      `;
      expect(adultSafetyRows[0]).toEqual({
        representation_mode: "self_only",
        case_state: "quarantined",
        provider_release_allowed: false,
        consent_count: "1"
      });

      const moderationRepository = createPostgresAdminRepository(sql);
      const moderatedAdultDraft = await moderationRepository.updateContentModeration({
        supabaseUserId: creatorSupabaseUserId,
        contentId: adultContentId,
        body: {
          action: "restrict",
          reason: "integration_media_safety_review"
        },
        idempotencyKey: `adult-content-restrict-${runId}`
      });
      expect(moderatedAdultDraft).toMatchObject({
        id: adultContentId,
        moderationState: "review_required"
      });

      const adultChangesRequested = await moderationRepository.updateContentModeration({
        supabaseUserId: creatorSupabaseUserId,
        contentId: adultContentId,
        body: {
          action: "request_changes",
          reason: "Please clarify the uploader rights declaration."
        },
        idempotencyKey: `adult-content-request-changes-${runId}`
      });
      expect(adultChangesRequested).toMatchObject({
        id: adultContentId,
        moderationState: "changes_requested"
      });

      await sql`
        update verification_records
        set expires_at = now() - interval '1 minute'
        where subject_type = 'user'
          and subject_id = ${seededCreatorUserId}
          and purpose = 'adult_publisher_eligibility'
      `;
      const expiredAdultRepresentationEdit = await app.inject({
        method: "PATCH",
        url: `/v1/content/${adultContentId}`,
        headers: creatorAuthenticatedHeaders(`adult-representation-expired-${runId}`),
        payload: {
          representationMode: "self_only",
          contentSafetyPolicyAccepted: true
        }
      });
      expect(expiredAdultRepresentationEdit.statusCode, expiredAdultRepresentationEdit.body).toBe(403);
      await sql`
        update verification_records
        set expires_at = null
        where subject_type = 'user'
          and subject_id = ${seededCreatorUserId}
          and purpose = 'adult_publisher_eligibility'
      `;

      await expect(moderationRepository.updateContentModeration({
        supabaseUserId: creatorSupabaseUserId,
        contentId: adultContentId,
        body: {
          action: "request_changes",
          reason: "A duplicate transition must fail."
        },
        idempotencyKey: `adult-content-request-changes-repeat-${runId}`
      })).rejects.toThrow("invalid while the safety case is changes_requested");

      const createContentResponse = await app.inject({
        method: "POST",
        url: "/v1/content",
        headers: authenticatedHeaders(`content-create-${runId}`),
        payload: {
          mediaType: "image",
          visibility: "public",
          nsfwLabel: "none",
          representationMode: "self_only",
          contentSafetyPolicyAccepted: true,
          caption: `Integration draft ${runId}`
        }
      });

      expect(createContentResponse.statusCode, createContentResponse.body).toBe(201);
      expect(createContentResponse.json()).toMatchObject({
        mediaType: "image",
        accessState: "free",
        caption: `Integration draft ${runId}`
      });
      const sfwContentId = createContentResponse.json().id as string;

      const contentCreateReceipt = await sql<{ expires_at: string }[]>`
        select receipt.expires_at::text as expires_at
        from idempotency_keys receipt
        join users actor on actor.id = receipt.actor_user_id
        where receipt.scope = 'content.create'
          and actor.supabase_user_id = ${buyerSupabaseUserId}
          and receipt.key = 'content:create:' || actor.id || ':' || ${`content-create-${runId}`}
      `;
      expect(contentCreateReceipt).toEqual([{ expires_at: "infinity" }]);

      const replayedContentResponse = await app.inject({
        method: "POST",
        url: "/v1/content",
        headers: authenticatedHeaders(`content-create-${runId}`),
        payload: {
          mediaType: "image",
          visibility: "public",
          nsfwLabel: "none",
          representationMode: "self_only",
          contentSafetyPolicyAccepted: true,
          caption: `Integration draft ${runId}`
        }
      });
      expect(replayedContentResponse.statusCode, replayedContentResponse.body).toBe(201);
      expect(replayedContentResponse.json().id).toBe(sfwContentId);

      const conflictingContentResponse = await app.inject({
        method: "POST",
        url: "/v1/content",
        headers: authenticatedHeaders(`content-create-${runId}`),
        payload: {
          mediaType: "image",
          visibility: "public",
          nsfwLabel: "none",
          representationMode: "self_only",
          contentSafetyPolicyAccepted: true,
          caption: `Changed integration draft ${runId}`
        }
      });
      expect(conflictingContentResponse.statusCode, conflictingContentResponse.body).toBe(409);
      expect(conflictingContentResponse.json()).toMatchObject({ code: "conflict" });

      const contentDraftCount = await sql<{ count: number }[]>`
        select count(*)::integer as count
        from content_items content
        join users creator on creator.id = content.creator_user_id
        where creator.supabase_user_id = ${buyerSupabaseUserId}
          and content.caption = ${`Integration draft ${runId}`}
      `;
      expect(contentDraftCount).toEqual([{ count: 1 }]);

      const ownedMediaResponse = await app.inject({
        method: "GET",
        url: "/v1/content/mine",
        headers: authenticatedHeaders(`owned-media-${runId}`)
      });
      expect(ownedMediaResponse.statusCode, ownedMediaResponse.body).toBe(200);
      expect(ownedMediaResponse.json().items).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: sfwContentId, publicationState: "upload_pending" })
      ]));

      await sql`
        update profiles
        set visibility = 'public'
        where lower(handle) = lower(${buyerHandle})
      `;

      const publicProfileBeforeApproval = await app.inject({
        method: "GET",
        url: `/v1/profiles/${buyerHandle}`
      });
      expect(publicProfileBeforeApproval.statusCode, publicProfileBeforeApproval.body).toBe(200);
      expect(publicProfileBeforeApproval.json().recentContent).not.toEqual(
        expect.arrayContaining([expect.objectContaining({ id: sfwContentId })])
      );

      const sfwMediaAssetId = randomUUID();
      await sql`
        insert into media_assets (
          id, content_item_id, provider, provider_asset_id, provider_state,
          provider_playable, ready_at, provider_checked_at
        )
        values (
          ${sfwMediaAssetId}, ${sfwContentId}, 'bunny', ${`sfw-review-${runId}`}, 'ready',
          true, now(), now()
        )
      `;
      await sql`
        update media_safety_cases
        set
          state = 'rejected',
          decision_source = 'staff',
          reason_code = 'policy_rejected',
          decision_message = 'Please clarify the rights declaration.',
          decided_at = now(),
          updated_at = now()
        where content_item_id = ${sfwContentId}
      `;
      await sql`
        update content_items
        set state = 'blocked', moderation_state = 'blocked', publish_state = 'blocked', updated_at = now()
        where id = ${sfwContentId}
      `;

      const rejectedOwnerMediaResponse = await app.inject({
        method: "GET",
        url: "/v1/content/mine",
        headers: authenticatedHeaders(`owned-media-rejected-${runId}`)
      });
      expect(rejectedOwnerMediaResponse.statusCode, rejectedOwnerMediaResponse.body).toBe(200);
      expect(rejectedOwnerMediaResponse.json().items).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: sfwContentId, publicationState: "rejected" })
      ]));

      const appealResponse = await app.inject({
        method: "POST",
        url: `/v1/content/${sfwContentId}/moderation-appeals`,
        headers: authenticatedHeaders(`sfw-appeal-${runId}`),
        payload: { reason: "I confirm that I own the recording and appear alone." }
      });
      expect(appealResponse.statusCode, appealResponse.body).toBe(201);
      expect(appealResponse.json()).toMatchObject({ contentId: sfwContentId, state: "submitted" });

      const replayedAppealResponse = await app.inject({
        method: "POST",
        url: `/v1/content/${sfwContentId}/moderation-appeals`,
        headers: authenticatedHeaders(`sfw-appeal-${runId}`),
        payload: { reason: "I confirm that I own the recording and appear alone." }
      });
      expect(replayedAppealResponse.statusCode, replayedAppealResponse.body).toBe(201);
      expect(replayedAppealResponse.json().id).toBe(appealResponse.json().id);

      const conflictingAppealResponse = await app.inject({
        method: "POST",
        url: `/v1/content/${sfwContentId}/moderation-appeals`,
        headers: authenticatedHeaders(`sfw-appeal-${runId}`),
        payload: { reason: "This is a different appeal request." }
      });
      expect(conflictingAppealResponse.statusCode, conflictingAppealResponse.body).toBe(409);

      const appealedOwnerMediaResponse = await app.inject({
        method: "GET",
        url: "/v1/content/mine",
        headers: authenticatedHeaders(`owned-media-appealed-${runId}`)
      });
      expect(appealedOwnerMediaResponse.statusCode, appealedOwnerMediaResponse.body).toBe(200);
      expect(appealedOwnerMediaResponse.json().items).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: sfwContentId, publicationState: "appeal_pending" })
      ]));

      const approvedAppeal = await moderationRepository.updateContentModeration({
        supabaseUserId: creatorSupabaseUserId,
        contentId: sfwContentId,
        body: {
          action: "approve",
          reason: "Appeal accepted after staff review."
        },
        idempotencyKey: `sfw-appeal-approve-${runId}`
      });
      expect(approvedAppeal).toMatchObject({
        id: sfwContentId,
        state: "ready",
        moderationState: "approved"
      });
      const approvedAppealRows = await sql<{
        publish_state: string;
        appeal_state: string;
        reviewed_at: Date | null;
      }[]>`
        select ci.publish_state, mma.state as appeal_state, mma.reviewed_at
        from content_items ci
        join media_safety_cases msc on msc.content_item_id = ci.id and msc.state <> 'superseded'
        join media_moderation_appeals mma on mma.media_safety_case_id = msc.id
        where ci.id = ${sfwContentId}
      `;
      expect(approvedAppealRows[0]).toMatchObject({
        publish_state: "published",
        appeal_state: "overturned",
        reviewed_at: expect.any(Date)
      });

      const playbackSessionResponse = await app.inject({
        method: "POST",
        url: "/v1/platform-usage/playback-sessions",
        headers: authenticatedHeaders(`playback-session-${runId}`),
        payload: {
          targetType: "content",
          targetId: seededFreeContentId
        }
      });

      expect(playbackSessionResponse.statusCode, playbackSessionResponse.body).toBe(201);
      const playbackSession = playbackSessionResponse.json<{ id: string }>();
      expect(playbackSessionResponse.json()).toMatchObject({
        state: "active",
        consumedSeconds: 0,
        usage: {
          publicMediaSeconds: 0,
          limitReached: false
        }
      });

      const heartbeatPayload = { sequence: 1, playedSeconds: 1 };
      const playbackHeartbeatResponse = await app.inject({
        method: "POST",
        url: `/v1/platform-usage/playback-sessions/${playbackSession.id}/heartbeats`,
        headers: authenticatedHeaders(`playback-heartbeat-${runId}`),
        payload: heartbeatPayload
      });

      expect(playbackHeartbeatResponse.statusCode, playbackHeartbeatResponse.body).toBe(200);
      expect(playbackHeartbeatResponse.json()).toMatchObject({
        id: playbackSession.id,
        state: "active",
        consumedSeconds: 1,
        usage: {
          publicMediaSeconds: 1
        }
      });

      const replayedHeartbeatResponse = await app.inject({
        method: "POST",
        url: `/v1/platform-usage/playback-sessions/${playbackSession.id}/heartbeats`,
        headers: authenticatedHeaders(`playback-heartbeat-${runId}`),
        payload: heartbeatPayload
      });

      expect(replayedHeartbeatResponse.statusCode, replayedHeartbeatResponse.body).toBe(200);
      expect(replayedHeartbeatResponse.json()).toMatchObject({
        consumedSeconds: 1,
        usage: { publicMediaSeconds: 1 }
      });

      const persistedPlaybackRows = await sql<{
        heartbeat_count: string;
        session_count: string;
        usage_seconds: string;
      }[]>`
        select
          (
            select count(*)
            from platform_playback_sessions
            where id = ${playbackSession.id}
          ) as session_count,
          (
            select count(*)
            from platform_playback_heartbeats
            where session_id = ${playbackSession.id}
          ) as heartbeat_count,
          (
            select public_media_seconds
            from platform_usage_windows usage
            join users actor on actor.id = usage.user_id
            where actor.supabase_user_id = ${buyerSupabaseUserId}
            order by usage.window_starts_at desc
            limit 1
          ) as usage_seconds
      `;

      expect(persistedPlaybackRows[0]).toEqual({
        heartbeat_count: "1",
        session_count: "1",
        usage_seconds: "1"
      });

      const buyerRows = await sql<{ id: string }[]>`
        select id from users where supabase_user_id = ${buyerSupabaseUserId}
      `;
      const buyerUserId = buyerRows[0]?.id;
      expect(buyerUserId).toBeTruthy();
      const adminRepository = createPostgresAdminRepository(sql);
      const provisionBody = {
        name: `Provisioned Organization ${runId}`,
        ownerHandle: creatorHandle,
        reason: "Approved integration onboarding"
      };
      const provisionRequest = {
        supabaseUserId: buyerSupabaseUserId,
        body: provisionBody,
        idempotencyKey: `organization-provision-${runId}`,
        requestHash: createHash("sha256").update(JSON.stringify(provisionBody)).digest("hex")
      };
      const provisionedOrganization = await adminRepository.provisionOrganization(provisionRequest);
      expect(provisionedOrganization).toMatchObject({
        name: provisionBody.name,
        state: "pending_kyb",
        plan: "enterprise",
        kybState: "not_started"
      });
      expect(await adminRepository.provisionOrganization(provisionRequest)).toEqual(provisionedOrganization);
      await expect(adminRepository.provisionOrganization({
        ...provisionRequest,
        requestHash: "f".repeat(64)
      })).rejects.toThrow(/Idempotency key/);
      const provisionedOrganizationId = provisionedOrganization?.id;
      expect(provisionedOrganizationId).toBeTruthy();
      const provisionedMembershipRows = await sql<Array<{ id: string; role: string; state: string }>>`
        select id, role, state from organization_memberships
        where organization_id = ${provisionedOrganizationId!}
      `;
      expect(provisionedMembershipRows).toMatchObject([{ role: "owner", state: "invited" }]);
      const provisionedMembershipId = provisionedMembershipRows[0]?.id;
      await sql`
        delete from notifications
        where related_resource_type = 'organization_membership'
          and related_resource_id = ${provisionedMembershipId!}
      `;
      await sql`delete from enterprise_action_receipts where organization_id = ${provisionedOrganizationId!}`;
      await sql`delete from organization_memberships where organization_id = ${provisionedOrganizationId!}`;
      await sql`delete from audit_events where subject_type = 'organization' and subject_id = ${provisionedOrganizationId!}`;
      await sql`delete from organizations where id = ${provisionedOrganizationId!}`;

      await sql`
        insert into organizations (id, name, state, kyb_state)
        values (${seededOrganizationId}, ${`Integration Organization ${runId}`}, 'active', 'verified')
      `;
      await sql`
        insert into organization_memberships (id, organization_id, user_id, role, state, joined_at)
        values (
          ${seededOrganizationMembershipId},
          ${seededOrganizationId},
          ${buyerUserId!},
          'owner',
          'active',
          now()
        )
      `;
      await sql`
        insert into verification_records (
          subject_type, subject_id, purpose, status, provider, provider_reference,
          method, assurance_level, verified_at, reusable
        ) values (
          'organization', ${seededOrganizationId}, 'org_kyb', 'valid', 'manual',
          ${`integration-org-kyb-${runId}`}, 'manual_review', 'business_verified', now(), false
        )
      `;

      const kybOnlyAccessResponse = await app.inject({
        method: "GET",
        url: "/v1/platform-access",
        headers: authenticatedHeaders(`platform-access-kyb-${runId}`)
      });

      expect(kybOnlyAccessResponse.statusCode, kybOnlyAccessResponse.body).toBe(200);
      expect(kybOnlyAccessResponse.json()).toMatchObject({
        currentTier: { key: "free_verified" }
      });

      const kybOnlyOrganizationResponse = await app.inject({
        method: "GET",
        url: "/v1/organizations",
        headers: authenticatedHeaders(`organization-kyb-only-${runId}`)
      });
      expect(kybOnlyOrganizationResponse.statusCode, kybOnlyOrganizationResponse.body).toBe(200);
      expect(kybOnlyOrganizationResponse.json()).toMatchObject({
        items: [
          {
            capabilities: {
              rbacEnabled: false,
              teamPublishingEnabled: false,
              consolidatedReportingEnabled: false,
              complianceExportsEnabled: false
            },
            rolePermissions: expect.arrayContaining([
              expect.objectContaining({
                key: "publish_team_content",
                allowed: false,
                reason: "enterprise_entitlement_required"
              })
            ])
          }
        ]
      });

      await sql`
        insert into tier_waivers (
          id,
          subject_type,
          subject_id,
          tier_key,
          state,
          starts_at
        )
        values (
          ${seededEnterpriseWaiverId},
          'organization',
          ${seededOrganizationId},
          'enterprise',
          'active',
          now()
        )
      `;

      const contractedEnterpriseAccessResponse = await app.inject({
        method: "GET",
        url: "/v1/platform-access",
        headers: authenticatedHeaders(`platform-access-enterprise-${runId}`)
      });

      expect(contractedEnterpriseAccessResponse.statusCode, contractedEnterpriseAccessResponse.body).toBe(200);
      expect(contractedEnterpriseAccessResponse.json()).toMatchObject({
        currentTier: { key: "enterprise" }
      });

      const enterpriseOrganizationResponse = await app.inject({
        method: "GET",
        url: "/v1/organizations",
        headers: authenticatedHeaders(`organization-enterprise-${runId}`)
      });
      expect(enterpriseOrganizationResponse.statusCode, enterpriseOrganizationResponse.body).toBe(200);
      expect(enterpriseOrganizationResponse.json()).toMatchObject({
        items: [
          {
            capabilities: {
              rbacEnabled: true,
              teamPublishingEnabled: true,
              consolidatedReportingEnabled: true,
              complianceExportsEnabled: true
            },
            rolePermissions: expect.arrayContaining([
              expect.objectContaining({
                key: "publish_team_content",
                allowed: true,
                reason: "allowed"
              })
            ])
          }
        ]
      });

      const managedCreatorInviteRequest = {
        method: "POST" as const,
        url: `/v1/organizations/${seededOrganizationId}/managed-creators`,
        headers: authenticatedHeaders(`managed-creator-invite-${runId}`),
        payload: {
          creatorHandle,
          permissions: ["revenue_allocation", "analytics_view"],
          enterpriseManagementShareBps: 1_750,
          settlementWalletId: linkedWallet.id
        }
      };
      const managedCreatorInviteResponse = await app.inject(managedCreatorInviteRequest);
      expect(managedCreatorInviteResponse.statusCode, managedCreatorInviteResponse.body).toBe(201);
      expect(managedCreatorInviteResponse.json()).toMatchObject({
        state: "invited",
        agreementState: "proposed",
        creatorShareBps: 8_250,
        enterpriseManagementShareBps: 1_750,
        organizationKybReady: true,
        enterpriseEntitlementReady: true,
        settlementWalletReady: true
      });
      const invitedRelationship = managedCreatorInviteResponse.json<{ id: string; agreementId: string }>();

      const managedCreatorInviteReplay = await app.inject(managedCreatorInviteRequest);
      expect(managedCreatorInviteReplay.statusCode, managedCreatorInviteReplay.body).toBe(201);
      expect(managedCreatorInviteReplay.json()).toEqual(managedCreatorInviteResponse.json());
      const managedCreatorInviteConflict = await app.inject({
        ...managedCreatorInviteRequest,
        payload: { ...managedCreatorInviteRequest.payload, enterpriseManagementShareBps: 2_000 }
      });
      expect(managedCreatorInviteConflict.statusCode, managedCreatorInviteConflict.body).toBe(409);

      const managedCreatorAcceptResponse = await app.inject({
        method: "POST",
        url: `/v1/managed-creator-relationships/${invitedRelationship.id}/responses`,
        headers: creatorAuthenticatedHeaders(`managed-creator-accept-${runId}`),
        payload: { decision: "accept" }
      });
      expect(managedCreatorAcceptResponse.statusCode, managedCreatorAcceptResponse.body).toBe(200);
      expect(managedCreatorAcceptResponse.json()).toMatchObject({
        state: "active",
        agreementState: "accepted",
        viewerRole: "creator",
        availableActions: expect.arrayContaining(["terminate_relationship"])
      });

      const initialAllocation = await sql<Array<{
        enterprise_wallet: string;
        enterprise_management_share_bps: number;
      }>>`
        select enterprise_wallet, enterprise_management_share_bps
        from private.resolve_managed_creator_allocation(${seededCreatorUserId}, 'solana_devnet'::wallet_chain)
      `;
      expect(initialAllocation).toEqual([{
        enterprise_wallet: walletAddress,
        enterprise_management_share_bps: 1_750
      }]);

      const changedAgreementResponse = await app.inject({
        method: "POST",
        url: `/v1/managed-creator-relationships/${invitedRelationship.id}/agreements`,
        headers: authenticatedHeaders(`managed-agreement-change-${runId}`),
        payload: {
          permissions: ["analytics_view", "revenue_allocation"],
          enterpriseManagementShareBps: 2_000
        }
      });
      expect(changedAgreementResponse.statusCode, changedAgreementResponse.body).toBe(201);
      expect(changedAgreementResponse.json()).toMatchObject({ agreementState: "proposed" });
      const changedAgreement = changedAgreementResponse.json<{ agreementId: string }>();

      const unchangedAllocation = await sql<Array<{ enterprise_management_share_bps: number }>>`
        select enterprise_management_share_bps
        from private.resolve_managed_creator_allocation(${seededCreatorUserId}, 'solana_devnet'::wallet_chain)
      `;
      expect(unchangedAllocation[0]?.enterprise_management_share_bps).toBe(1_750);

      const changedAgreementAcceptResponse = await app.inject({
        method: "POST",
        url: `/v1/managed-creator-relationships/${invitedRelationship.id}/agreements/${changedAgreement.agreementId}/responses`,
        headers: creatorAuthenticatedHeaders(`managed-agreement-accept-${runId}`),
        payload: { decision: "accept" }
      });
      expect(changedAgreementAcceptResponse.statusCode, changedAgreementAcceptResponse.body).toBe(200);
      expect(changedAgreementAcceptResponse.json()).toMatchObject({
        agreementState: "accepted",
        creatorShareBps: 8_000,
        enterpriseManagementShareBps: 2_000
      });

      const changedAllocation = await sql<Array<{ enterprise_management_share_bps: number }>>`
        select enterprise_management_share_bps
        from private.resolve_managed_creator_allocation(${seededCreatorUserId}, 'solana_devnet'::wallet_chain)
      `;
      expect(changedAllocation[0]?.enterprise_management_share_bps).toBe(2_000);

      const managedReportingResponse = await app.inject({
        method: "GET",
        url: `/v1/managed-creator-relationships/${invitedRelationship.id}/reporting`,
        headers: authenticatedHeaders(`managed-reporting-${runId}`)
      });
      expect(managedReportingResponse.statusCode, managedReportingResponse.body).toBe(200);
      expect(managedReportingResponse.json()).toMatchObject({
        totals: [],
        financeBoundary: "confirmed_allocations_only_no_balance_no_withdrawal_no_payout_queue"
      });

      const managedCreatorTerminationResponse = await app.inject({
        method: "POST",
        url: `/v1/managed-creator-relationships/${invitedRelationship.id}/termination`,
        headers: creatorAuthenticatedHeaders(`managed-creator-termination-${runId}`),
        payload: { reason: "Integration journey completed" }
      });
      expect(managedCreatorTerminationResponse.statusCode, managedCreatorTerminationResponse.body).toBe(200);
      expect(managedCreatorTerminationResponse.json()).toMatchObject({
        state: "terminated",
        agreementState: "terminated"
      });

      const managedAuthorityEvidence = await sql<Array<{ receipt_count: string; audit_count: string }>>`
        select
          (select count(*) from enterprise_action_receipts where relationship_id = ${invitedRelationship.id}) as receipt_count,
          (select count(*) from audit_events where subject_type = 'managed_creator_relationship' and subject_id = ${invitedRelationship.id}) as audit_count
      `;
      expect(managedAuthorityEvidence[0]).toEqual({ receipt_count: "5", audit_count: "5" });

      await sql`
        update creator_monetisation_settings
        set earning_state = 'held', updated_at = now()
        where user_id = ${seededCreatorUserId}
      `;
      const heldCreatorUnlockResponse = await app.inject({
        method: "POST",
        url: `/v1/content/${seededContentId}/unlock-intents`,
        headers: authenticatedHeaders(`content-unlock-held-${runId}`)
      });
      expect(heldCreatorUnlockResponse.statusCode, heldCreatorUnlockResponse.body).toBe(409);
      expect(heldCreatorUnlockResponse.json()).toMatchObject({
        code: "conflict",
        message: "This creator cannot receive payments yet"
      });
      await sql`
        update creator_monetisation_settings
        set earning_state = 'ready', updated_at = now()
        where user_id = ${seededCreatorUserId}
      `;

      const unlockResponse = await app.inject({
        method: "POST",
        url: `/v1/content/${seededContentId}/unlock-intents`,
        headers: authenticatedHeaders(`content-unlock-${runId}`)
      });

      expect(unlockResponse.statusCode, unlockResponse.body).toBe(201);
      expect(unlockResponse.json()).toMatchObject({
        state: "payment_required",
        contentId: seededContentId,
        paymentIntent: {
          productType: "content_unlock",
          amountMinor: 25000000,
          currency: "SOL",
          state: "pending"
        }
      });
      const unlock = unlockResponse.json<{
        paymentIntent: {
          id: string;
          amountMinor: number;
        };
      }>();

      await sql`
        update creator_monetisation_settings
        set earning_state = 'held', updated_at = now()
        where user_id = ${seededCreatorUserId}
      `;
      const heldCreatorRetryResponse = await app.inject({
        method: "POST",
        url: `/v1/content/${seededContentId}/unlock-intents`,
        headers: authenticatedHeaders(`content-unlock-${runId}`)
      });
      expect(heldCreatorRetryResponse.statusCode, heldCreatorRetryResponse.body).toBe(409);
      expect(heldCreatorRetryResponse.json()).toMatchObject({
        code: "conflict",
        message: "This creator cannot receive payments yet"
      });
      await sql`
        update creator_monetisation_settings
        set earning_state = 'ready', updated_at = now()
        where user_id = ${seededCreatorUserId}
      `;

      await expect(
        sql`
          update payment_intents
          set state = 'confirmed', confirmed_at = now(), updated_at = now()
          where id = ${unlock.paymentIntent.id}
        `
      ).rejects.toThrow(/explicit_checkout_consent_required/);

      const contentUnlockConsent = await acceptImmediateCheckout(
        unlock.paymentIntent.id,
        "content-unlock"
      );
      const consentReceiptRows = await sql<{ expires_at: string }[]>`
        select expires_at::text as expires_at
        from idempotency_keys
        where key = ${contentUnlockConsent.idempotencyKey}
      `;
      expect(consentReceiptRows).toEqual([{ expires_at: "infinity" }]);

      const checkoutConsentReplay = await app.inject({
        method: "POST",
        url: `/v1/payments/intents/${unlock.paymentIntent.id}/consent`,
        headers: authenticatedHeaders(contentUnlockConsent.idempotencyKey),
        payload: {
          termsVersion: "veel-terms-v1",
          withdrawalWaiverVersion: "instant-digital-access-v1",
          immediateAccessAcknowledged: true
        }
      });
      expect(checkoutConsentReplay.statusCode, checkoutConsentReplay.body).toBe(200);
      expect(checkoutConsentReplay.json()).toMatchObject({ id: unlock.paymentIntent.id });

      const changedCheckoutConsentReplay = await app.inject({
        method: "POST",
        url: `/v1/payments/intents/${unlock.paymentIntent.id}/consent`,
        headers: authenticatedHeaders(contentUnlockConsent.idempotencyKey),
        payload: {
          termsVersion: "veel-terms-v2",
          withdrawalWaiverVersion: "instant-digital-access-v1",
          immediateAccessAcknowledged: true
        }
      });
      expect(changedCheckoutConsentReplay.statusCode, changedCheckoutConsentReplay.body).toBe(409);

      const crossActorConsentReplay = await app.inject({
        method: "POST",
        url: `/v1/payments/intents/${unlock.paymentIntent.id}/consent`,
        headers: creatorAuthenticatedHeaders(`checkout-consent-content-unlock-${runId}`),
        payload: {
          termsVersion: "veel-terms-v1",
          withdrawalWaiverVersion: "instant-digital-access-v1",
          immediateAccessAcknowledged: true
        }
      });
      expect(crossActorConsentReplay.statusCode, crossActorConsentReplay.body).toBe(409);

      const submissionResponse = await app.inject({
        method: "POST",
        url: `/v1/payments/intents/${unlock.paymentIntent.id}/submissions`,
        headers: authenticatedHeaders(`payment-submission-${runId}`),
        payload: {
          signature: validSolanaSignature
        }
      });

      expect(submissionResponse.statusCode, submissionResponse.body).toBe(202);
      const confirmedIntentResponse = await app.inject({
        method: "GET",
        url: `/v1/payments/intents/${unlock.paymentIntent.id}`,
        headers: authenticatedHeaders(`payment-intent-${runId}`)
      });

      expect(confirmedIntentResponse.statusCode, confirmedIntentResponse.body).toBe(200);
      expect(confirmedIntentResponse.json()).toMatchObject({
        id: unlock.paymentIntent.id,
        state: "confirmed"
      });

      const confirmedCheckoutConsentReplay = await app.inject({
        method: "POST",
        url: `/v1/payments/intents/${unlock.paymentIntent.id}/consent`,
        headers: authenticatedHeaders(contentUnlockConsent.idempotencyKey),
        payload: {
          termsVersion: "veel-terms-v1",
          withdrawalWaiverVersion: "instant-digital-access-v1",
          immediateAccessAcknowledged: true
        }
      });
      expect(confirmedCheckoutConsentReplay.statusCode, confirmedCheckoutConsentReplay.body).toBe(200);
      expect(confirmedCheckoutConsentReplay.json()).toMatchObject({
        id: unlock.paymentIntent.id,
        state: "confirmed"
      });
      expect(settlementInputs).toHaveLength(1);
      expect(settlementInputs[0]).toEqual(
        expect.objectContaining({
          signature: validSolanaSignature,
          treasuryWallet,
          totalAmountMinor: unlock.paymentIntent.amountMinor
        })
      );
      expect(settlementInputs[0]?.referenceAddress).toMatch(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/);

      const unlockedContentResponse = await app.inject({
        method: "GET",
        url: `/v1/content/${seededContentId}`,
        headers: authenticatedHeaders(`content-detail-${runId}`)
      });

      expect(unlockedContentResponse.statusCode, unlockedContentResponse.body).toBe(200);
      expect(unlockedContentResponse.json()).toMatchObject({
        id: seededContentId,
        accessState: "unlocked"
      });

      const alreadyUnlockedResponse = await app.inject({
        method: "POST",
        url: `/v1/content/${seededContentId}/unlock-intents`,
        headers: authenticatedHeaders(`content-already-unlocked-${runId}`)
      });

      expect(alreadyUnlockedResponse.statusCode, alreadyUnlockedResponse.body).toBe(201);
      expect(alreadyUnlockedResponse.json()).toMatchObject({
        state: "already_unlocked",
        contentId: seededContentId,
        entitlement: {
          targetId: seededContentId,
          productType: "content_unlock",
          state: "active"
        }
      });

      const persistedRows = await sql<{
        wallet_count: string;
        payment_intent_count: string;
        wallet_transaction_count: string;
        settlement_attempt_count: string;
        entitlement_count: string;
        entitlement_event_count: string;
        receipt_count: string;
        compliance_ledger_count: string;
        confirmation_delivery_count: string;
        sent_in_app_confirmation_count: string;
        email_provider_pending_count: string;
        notification_count: string;
        durable_confirmation_audit_count: string;
      }[]>`
        select
          (
            select count(*)
            from wallets w
            join users u on u.id = w.user_id
            where u.supabase_user_id = ${buyerSupabaseUserId}
          ) as wallet_count,
          (
            select count(*)
            from payment_intents pi
            join users u on u.id = pi.user_id
            where u.supabase_user_id = ${buyerSupabaseUserId}
              and pi.target_id = ${seededContentId}
              and pi.product_type = 'content_unlock'
          ) as payment_intent_count,
          (
            select count(*)
            from wallet_transaction_records wtr
            join users u on u.id = wtr.user_id
            where u.supabase_user_id = ${buyerSupabaseUserId}
              and wtr.payment_intent_id = ${unlock.paymentIntent.id}
              and wtr.state = 'confirmed'
          ) as wallet_transaction_count,
          (
            select count(*)
            from payment_settlement_attempts psa
            where psa.payment_intent_id = ${unlock.paymentIntent.id}
              and psa.state = 'confirmed'
          ) as settlement_attempt_count,
          (
            select count(*)
            from entitlements e
            join users u on u.id = e.user_id
            where u.supabase_user_id = ${buyerSupabaseUserId}
              and e.target_id = ${seededContentId}
              and e.product_type = 'content_unlock'
              and e.state = 'active'
          ) as entitlement_count,
          (
            select count(*)
            from entitlement_events ee
            where ee.payment_intent_id = ${unlock.paymentIntent.id}
              and ee.action = 'granted'
          ) as entitlement_event_count,
          (
            select count(*)
            from receipts r
            where r.payment_intent_id = ${unlock.paymentIntent.id}
              and r.state = 'issued'
          ) as receipt_count,
          (
            select count(*)
            from compliance_ledger_entries cle
            where cle.payment_intent_id = ${unlock.paymentIntent.id}
              and cle.event_type = 'payment_settled'
              and cle.receipt_id is not null
              and cle.metadata->>'withdrawalWaiverVersion' = 'instant-digital-access-v1'
          ) as compliance_ledger_count,
          (
            select count(*)
            from payment_confirmation_deliveries pcd
            where pcd.payment_intent_id = ${unlock.paymentIntent.id}
              and pcd.confirmation_version = 'payment-confirmation-v1'
              and pcd.terms_version = 'veel-terms-v1'
              and pcd.withdrawal_waiver_version = 'instant-digital-access-v1'
          ) as confirmation_delivery_count,
          (
            select count(*)
            from payment_confirmation_deliveries pcd
            where pcd.payment_intent_id = ${unlock.paymentIntent.id}
              and pcd.channel = 'in_app'
              and pcd.state = 'sent'
              and pcd.delivered_at is not null
          ) as sent_in_app_confirmation_count,
          (
            select count(*)
            from payment_confirmation_deliveries pcd
            where pcd.payment_intent_id = ${unlock.paymentIntent.id}
              and pcd.channel = 'email'
              and pcd.state = 'provider_not_configured'
              and pcd.payload->>'nextStep' = 'configure_launch_approved_email_provider'
          ) as email_provider_pending_count,
          (
            select count(*)
            from notifications n
            join receipts r on r.id = n.related_resource_id
            where r.payment_intent_id = ${unlock.paymentIntent.id}
              and n.kind = 'payment'
              and n.idempotency_key = ${`payment-confirmation:${unlock.paymentIntent.id}`}
          ) as notification_count,
          (
            select count(*)
            from audit_events ae
            where ae.subject_id = ${unlock.paymentIntent.id}
              and ae.subject_type = 'payment_intent'
              and ae.action = 'payment_durable_confirmation_recorded'
          ) as durable_confirmation_audit_count
      `;

      expect(persistedRows[0]).toEqual({
        wallet_count: "1",
        payment_intent_count: "1",
        wallet_transaction_count: "1",
        settlement_attempt_count: "1",
        entitlement_count: "1",
        entitlement_event_count: "1",
        receipt_count: "1",
        compliance_ledger_count: "1",
        confirmation_delivery_count: "2",
        sent_in_app_confirmation_count: "1",
        email_provider_pending_count: "1",
        notification_count: "1",
        durable_confirmation_audit_count: "1"
      });

      const refundRequestBody = {
        paymentIntentId: unlock.paymentIntent.id,
        kind: "refund_request",
        requestedAction: "creator_refund",
        reason: "Confirmed transaction did not provide expected access during support review"
      };
      const refundRequestResponse = await app.inject({
        method: "POST",
        url: "/v1/refunds/requests",
        headers: authenticatedHeaders(`refund-request-${runId}`),
        payload: refundRequestBody
      });

      expect(refundRequestResponse.statusCode, refundRequestResponse.body).toBe(201);
      expect(refundRequestResponse.json()).toMatchObject({
        paymentIntentId: unlock.paymentIntent.id,
        entitlementId: expect.any(String),
        kind: "refund_request",
        requestedAction: "creator_refund",
        state: "opened",
        custodyBoundary: "no_platform_custody_no_payout_queue"
      });
      const refundRequest = refundRequestResponse.json<{ id: string }>();

      const repeatedRefundRequestResponse = await app.inject({
        method: "POST",
        url: "/v1/refunds/requests",
        headers: authenticatedHeaders(`refund-request-${runId}`),
        payload: refundRequestBody
      });

      expect(repeatedRefundRequestResponse.statusCode, repeatedRefundRequestResponse.body).toBe(201);
      expect(repeatedRefundRequestResponse.json()).toMatchObject({
        id: refundRequest.id,
        paymentIntentId: unlock.paymentIntent.id,
        custodyBoundary: "no_platform_custody_no_payout_queue"
      });

      const conflictingRefundRequestResponse = await app.inject({
        method: "POST",
        url: "/v1/refunds/requests",
        headers: authenticatedHeaders(`refund-request-${runId}`),
        payload: {
          ...refundRequestBody,
          requestedAction: "replacement_access",
          reason: "Same idempotency key with a different requested remedy should conflict"
        }
      });

      expect(conflictingRefundRequestResponse.statusCode, conflictingRefundRequestResponse.body).toBe(409);

      const refundRows = await sql<{
        refund_request_count: string;
        refund_audit_count: string;
        active_entitlement_count: string;
        confirmed_payment_count: string;
      }[]>`
        select
          (
            select count(*)
            from refunds_and_disputes rd
            join users u on u.id = rd.reporter_user_id
            where u.supabase_user_id = ${buyerSupabaseUserId}
              and rd.payment_intent_id = ${unlock.paymentIntent.id}
              and rd.id = ${refundRequest.id}
              and rd.idempotency_key = ${`refund-request-${runId}`}
              and rd.state = 'opened'
              and rd.custody_boundary = 'no_platform_custody_no_payout_queue'
          ) as refund_request_count,
          (
            select count(*)
            from audit_events ae
            where ae.subject_id = ${refundRequest.id}
              and ae.subject_type = 'refund_dispute'
              and ae.action = 'refund_dispute_requested'
          ) as refund_audit_count,
          (
            select count(*)
            from entitlements e
            where e.payment_intent_id = ${unlock.paymentIntent.id}
              and e.state = 'active'
          ) as active_entitlement_count,
          (
            select count(*)
            from payment_intents pi
            where pi.id = ${unlock.paymentIntent.id}
              and pi.state = 'confirmed'
          ) as confirmed_payment_count
      `;

      expect(refundRows[0]).toEqual({
        refund_request_count: "1",
        refund_audit_count: "1",
        active_entitlement_count: "1",
        confirmed_payment_count: "1"
      });

      const paymentActivityResponse = await app.inject({
        method: "GET",
        url: "/v1/activity/payments",
        headers: authenticatedHeaders(`payment-activity-${runId}`)
      });

      expect(paymentActivityResponse.statusCode, paymentActivityResponse.body).toBe(200);
      expect(paymentActivityResponse.json()).toMatchObject({
        items: expect.arrayContaining([
          expect.objectContaining({
            paymentIntentId: unlock.paymentIntent.id,
            productType: "content_unlock",
            state: "confirmed",
            receiptNumber: expect.stringMatching(/^VEEL-/),
            receiptState: "issued",
            inAppConfirmationState: "sent",
            emailConfirmationState: "provider_not_configured",
            withdrawalRightStatus: "waived_after_immediate_access",
            supportReviewAvailable: true,
            latestRefundRequestState: "opened"
          })
        ])
      });
      expect(
        `${refundRequestResponse.body}${repeatedRefundRequestResponse.body}${conflictingRefundRequestResponse.body}${paymentActivityResponse.body}`
      ).not.toMatch(/automaticRefund|platformBalance|creatorBalance|withdrawalRequest|payoutQueue|escrow|privateKey|serviceRole/i);

      const accessPassIntentResponses = await Promise.all([
        app.inject({
          method: "POST",
          url: `/v1/events/${seededEventId}/access-passes/intents`,
          headers: authenticatedHeaders(`event-access-pass-a-${runId}`),
          payload: {
            accessPassTypeId: seededAccessPassTypeId
          }
        }),
        app.inject({
          method: "POST",
          url: `/v1/events/${seededEventId}/access-passes/intents`,
          headers: authenticatedHeaders(`event-access-pass-b-${runId}`),
          payload: {
            accessPassTypeId: seededAccessPassTypeId
          }
        })
      ]);
      expect(accessPassIntentResponses.map((response) => response.statusCode).sort()).toEqual([201, 409]);
      const accessPassIntentResponse = accessPassIntentResponses.find((response) => response.statusCode === 201);
      const rejectedAccessPassIntentResponse = accessPassIntentResponses.find((response) => response.statusCode === 409);

      expect(accessPassIntentResponse).toBeDefined();
      expect(rejectedAccessPassIntentResponse?.json()).toMatchObject({
        code: "conflict",
        message: "Access Pass inventory is no longer available"
      });

      if (!accessPassIntentResponse) {
        throw new Error("Concurrent Event Access reservation did not produce a successful checkout");
      }

      expect(accessPassIntentResponse.statusCode, accessPassIntentResponse.body).toBe(201);
      expect(accessPassIntentResponse.json()).toMatchObject({
        state: "payment_required",
        paymentIntent: {
          productType: "event_access_pass",
          amountMinor: 15000000,
          currency: "SOL",
          state: "pending"
        }
      });
      const accessPassIntent = accessPassIntentResponse.json<{
        paymentIntent: {
          id: string;
          amountMinor: number;
        };
      }>();

      const reservationRows = await sql<{
        active_reservation_count: string;
        cancelled_orphan_count: string;
      }[]>`
        select
          (
            select count(*)
            from event_access_purchase_requests eapr
            where eapr.event_id = ${seededEventId}
              and eapr.access_pass_type_id = ${seededAccessPassTypeId}
              and eapr.state = 'pending_payment'
              and eapr.reserved_until > now()
          ) as active_reservation_count,
          (
            select count(*)
            from payment_intents pi
            join users u on u.id = pi.user_id
            where u.supabase_user_id = ${buyerSupabaseUserId}
              and pi.product_type = 'event_access_pass'
              and pi.target_id = ${seededEventId}
              and pi.state = 'cancelled'
          ) as cancelled_orphan_count
      `;

      expect(reservationRows[0]).toEqual({
        active_reservation_count: "1",
        cancelled_orphan_count: "1"
      });

      await acceptImmediateCheckout(accessPassIntent.paymentIntent.id, "event-access");

      const accessPassSubmissionResponse = await app.inject({
        method: "POST",
        url: `/v1/payments/intents/${accessPassIntent.paymentIntent.id}/submissions`,
        headers: authenticatedHeaders(`event-access-pass-submission-${runId}`),
        payload: {
          signature: validEventAccessSolanaSignature
        }
      });

      expect(accessPassSubmissionResponse.statusCode, accessPassSubmissionResponse.body).toBe(202);
      const confirmedAccessPassIntentResponse = await app.inject({
        method: "GET",
        url: `/v1/payments/intents/${accessPassIntent.paymentIntent.id}`,
        headers: authenticatedHeaders(`event-access-pass-intent-${runId}`)
      });

      expect(confirmedAccessPassIntentResponse.statusCode, confirmedAccessPassIntentResponse.body).toBe(200);
      expect(confirmedAccessPassIntentResponse.json()).toMatchObject({
        id: accessPassIntent.paymentIntent.id,
        state: "confirmed",
        productType: "event_access_pass"
      });
      expect(settlementInputs).toHaveLength(2);
      expect(settlementInputs[1]).toEqual(
        expect.objectContaining({
          signature: validEventAccessSolanaSignature,
          treasuryWallet,
          totalAmountMinor: accessPassIntent.paymentIntent.amountMinor
        })
      );
      expect(settlementInputs[1]?.referenceAddress).toMatch(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/);

      const accessPassActivityResponse = await app.inject({
        method: "GET",
        url: "/v1/activity/access-passes",
        headers: authenticatedHeaders(`event-access-pass-activity-${runId}`)
      });

      expect(accessPassActivityResponse.statusCode, accessPassActivityResponse.body).toBe(200);
      expect(accessPassActivityResponse.json()).toMatchObject({
        items: [
          {
            eventId: seededEventId,
            accessPassTypeId: seededAccessPassTypeId,
            paymentIntentId: accessPassIntent.paymentIntent.id,
            state: "active"
          }
        ]
      });

      const eventAccessRows = await sql<{
        payment_intent_count: string;
        wallet_transaction_count: string;
        settlement_attempt_count: string;
        purchase_request_count: string;
        access_pass_count: string;
        audit_event_count: string;
      }[]>`
        select
          (
            select count(*)
            from payment_intents pi
            join users u on u.id = pi.user_id
            where u.supabase_user_id = ${buyerSupabaseUserId}
              and pi.id = ${accessPassIntent.paymentIntent.id}
              and pi.target_id = ${seededEventId}
              and pi.product_type = 'event_access_pass'
              and pi.state = 'confirmed'
          ) as payment_intent_count,
          (
            select count(*)
            from wallet_transaction_records wtr
            join users u on u.id = wtr.user_id
            where u.supabase_user_id = ${buyerSupabaseUserId}
              and wtr.payment_intent_id = ${accessPassIntent.paymentIntent.id}
              and wtr.state = 'confirmed'
          ) as wallet_transaction_count,
          (
            select count(*)
            from payment_settlement_attempts psa
            where psa.payment_intent_id = ${accessPassIntent.paymentIntent.id}
              and psa.state = 'confirmed'
          ) as settlement_attempt_count,
          (
            select count(*)
            from event_access_purchase_requests eapr
            join users u on u.id = eapr.buyer_user_id
            where u.supabase_user_id = ${buyerSupabaseUserId}
              and eapr.payment_intent_id = ${accessPassIntent.paymentIntent.id}
              and eapr.event_id = ${seededEventId}
              and eapr.access_pass_type_id = ${seededAccessPassTypeId}
              and eapr.state = 'access_pass_granted'
          ) as purchase_request_count,
          (
            select count(*)
            from event_access_passes eap
            join users u on u.id = eap.holder_user_id
            where u.supabase_user_id = ${buyerSupabaseUserId}
              and eap.payment_intent_id = ${accessPassIntent.paymentIntent.id}
              and eap.event_id = ${seededEventId}
              and eap.access_pass_type_id = ${seededAccessPassTypeId}
              and eap.state = 'active'
          ) as access_pass_count,
          (
            select count(*)
            from audit_events ae
            join users u on u.id = ae.actor_user_id
            where u.supabase_user_id = ${buyerSupabaseUserId}
              and ae.subject_id = ${seededEventId}
              and ae.action = 'event_access_pass_granted'
          ) as audit_event_count
      `;

      expect(eventAccessRows[0]).toEqual({
        payment_intent_count: "1",
        wallet_transaction_count: "1",
        settlement_attempt_count: "1",
        purchase_request_count: "1",
        access_pass_count: "1",
        audit_event_count: "1"
      });

      const concurrentFreeGrants = await Promise.all([
        grantAccessPass(sql, {
          supabaseUserId: buyerSupabaseUserId,
          eventId: seededEventId,
          accessPassTypeId: seededFreeAccessPassTypeId,
          paymentIntentId: null
        }),
        grantAccessPass(sql, {
          supabaseUserId: creatorSupabaseUserId,
          eventId: seededEventId,
          accessPassTypeId: seededFreeAccessPassTypeId,
          paymentIntentId: null
        })
      ]);
      expect(concurrentFreeGrants.filter((rows) => rows[0])).toHaveLength(1);

      const freeAccessPassRows = await sql<{ access_pass_count: string }[]>`
        select count(*) as access_pass_count
        from event_access_passes
        where event_id = ${seededEventId}
          and access_pass_type_id = ${seededFreeAccessPassTypeId}
          and state in ('active', 'checked_in')
      `;
      expect(freeAccessPassRows[0]).toEqual({ access_pass_count: "1" });

      const normalMessageBody = `Normal integration hello ${shortRunId}`;
      const normalMessageIdempotencyKey = `normal-message-${runId}`;
      const normalMessageRequest = {
        method: "POST" as const,
        url: `/v1/messages/conversations/${seededConversationId}/messages`,
        headers: authenticatedHeaders(normalMessageIdempotencyKey),
        payload: { body: normalMessageBody }
      };
      const [normalMessageResponse, concurrentNormalMessageResponse] = await Promise.all([
        app.inject(normalMessageRequest),
        app.inject(normalMessageRequest)
      ]);
      const replayedNormalMessageResponse = await app.inject(normalMessageRequest);

      expect(normalMessageResponse.statusCode, normalMessageResponse.body).toBe(201);
      expect(concurrentNormalMessageResponse.statusCode, concurrentNormalMessageResponse.body).toBe(201);
      expect(replayedNormalMessageResponse.statusCode, replayedNormalMessageResponse.body).toBe(201);
      expect(concurrentNormalMessageResponse.json()).toEqual(normalMessageResponse.json());
      expect(replayedNormalMessageResponse.json()).toEqual(normalMessageResponse.json());

      const conflictingNormalMessageResponse = await app.inject({
        ...normalMessageRequest,
        payload: { body: `${normalMessageBody} changed` }
      });
      expect(conflictingNormalMessageResponse.statusCode, conflictingNormalMessageResponse.body).toBe(409);

      const normalMessageRows = await sql<{ message_count: string }[]>`
        select count(*) as message_count
        from messages m
        join users u on u.id = m.sender_user_id
        where u.supabase_user_id = ${buyerSupabaseUserId}
          and m.conversation_id = ${seededConversationId}
          and m.idempotency_key = ${normalMessageIdempotencyKey}
      `;
      expect(normalMessageRows[0]?.message_count).toBe("1");

      const paidMessageBody = `Paid integration hello ${shortRunId}`;
      const paidMessageIntentResponse = await app.inject({
        method: "POST",
        url: `/v1/messages/conversations/${seededConversationId}/paid-message-intents`,
        headers: authenticatedHeaders(`paid-message-${runId}`),
        payload: {
          body: paidMessageBody
        }
      });

      expect(paidMessageIntentResponse.statusCode, paidMessageIntentResponse.body).toBe(201);
      expect(paidMessageIntentResponse.json()).toMatchObject({
        state: "payment_required",
        conversationId: seededConversationId,
        paymentIntent: {
          productType: "paid_message",
          targetId: seededConversationId,
          amountMinor: 10000000,
          currency: "SOL",
          state: "pending"
        }
      });
      const paidMessageIntent = paidMessageIntentResponse.json<{
        paymentIntent: {
          id: string;
          amountMinor: number;
        };
      }>();

      await acceptImmediateCheckout(paidMessageIntent.paymentIntent.id, "paid-message");

      const paidMessageSubmissionResponse = await app.inject({
        method: "POST",
        url: `/v1/payments/intents/${paidMessageIntent.paymentIntent.id}/submissions`,
        headers: authenticatedHeaders(`paid-message-submission-${runId}`),
        payload: {
          signature: validPaidMessageSolanaSignature
        }
      });

      expect(paidMessageSubmissionResponse.statusCode, paidMessageSubmissionResponse.body).toBe(202);
      const confirmedPaidMessageIntentResponse = await app.inject({
        method: "GET",
        url: `/v1/payments/intents/${paidMessageIntent.paymentIntent.id}`,
        headers: authenticatedHeaders(`paid-message-intent-${runId}`)
      });

      expect(confirmedPaidMessageIntentResponse.statusCode, confirmedPaidMessageIntentResponse.body).toBe(200);
      expect(confirmedPaidMessageIntentResponse.json()).toMatchObject({
        id: paidMessageIntent.paymentIntent.id,
        state: "confirmed",
        productType: "paid_message"
      });
      expect(settlementInputs).toHaveLength(3);
      expect(settlementInputs[2]).toEqual(
        expect.objectContaining({
          signature: validPaidMessageSolanaSignature,
          treasuryWallet,
          totalAmountMinor: paidMessageIntent.paymentIntent.amountMinor
        })
      );
      expect(settlementInputs[2]?.referenceAddress).toMatch(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/);

      const paidMessagesResponse = await app.inject({
        method: "GET",
        url: `/v1/messages/conversations/${seededConversationId}/messages`,
        headers: authenticatedHeaders(`paid-message-list-${runId}`)
      });

      expect(paidMessagesResponse.statusCode, paidMessagesResponse.body).toBe(200);
      expect(paidMessagesResponse.json()).toMatchObject({
        items: [
          {
            conversationId: seededConversationId,
            body: normalMessageBody,
            deliveryState: "visible",
            paymentIntentId: null
          },
          {
            conversationId: seededConversationId,
            body: paidMessageBody,
            deliveryState: "visible",
            paymentIntentId: paidMessageIntent.paymentIntent.id
          }
        ]
      });

      const paidMessageRows = await sql<{
        payment_intent_count: string;
        wallet_transaction_count: string;
        settlement_attempt_count: string;
        delivery_request_count: string;
        message_count: string;
        audit_event_count: string;
      }[]>`
        select
          (
            select count(*)
            from payment_intents pi
            join users u on u.id = pi.user_id
            where u.supabase_user_id = ${buyerSupabaseUserId}
              and pi.id = ${paidMessageIntent.paymentIntent.id}
              and pi.target_id = ${seededConversationId}
              and pi.product_type = 'paid_message'
              and pi.state = 'confirmed'
          ) as payment_intent_count,
          (
            select count(*)
            from wallet_transaction_records wtr
            join users u on u.id = wtr.user_id
            where u.supabase_user_id = ${buyerSupabaseUserId}
              and wtr.payment_intent_id = ${paidMessageIntent.paymentIntent.id}
              and wtr.state = 'confirmed'
          ) as wallet_transaction_count,
          (
            select count(*)
            from payment_settlement_attempts psa
            where psa.payment_intent_id = ${paidMessageIntent.paymentIntent.id}
              and psa.state = 'confirmed'
          ) as settlement_attempt_count,
          (
            select count(*)
            from paid_message_delivery_requests pmdr
            join users u on u.id = pmdr.sender_user_id
            where u.supabase_user_id = ${buyerSupabaseUserId}
              and pmdr.payment_intent_id = ${paidMessageIntent.paymentIntent.id}
              and pmdr.conversation_id = ${seededConversationId}
              and pmdr.state = 'delivered'
              and pmdr.delivered_at is not null
          ) as delivery_request_count,
          (
            select count(*)
            from messages m
            join users u on u.id = m.sender_user_id
            where u.supabase_user_id = ${buyerSupabaseUserId}
              and m.payment_intent_id = ${paidMessageIntent.paymentIntent.id}
              and m.conversation_id = ${seededConversationId}
              and m.delivery_state = 'visible'
              and m.body = ${paidMessageBody}
          ) as message_count,
          (
            select count(*)
            from audit_events ae
            join messages m on m.id = ae.subject_id
            where m.payment_intent_id = ${paidMessageIntent.paymentIntent.id}
              and ae.action = 'paid_message_delivered'
          ) as audit_event_count
      `;

      expect(paidMessageRows[0]).toEqual({
        payment_intent_count: "1",
        wallet_transaction_count: "1",
        settlement_attempt_count: "1",
        delivery_request_count: "1",
        message_count: "1",
        audit_event_count: "1"
      });

      await sql`
        insert into direct_message_requests (
          conversation_id, initiator_user_id, recipient_user_id, state, requester_message_count
        ) values (
          ${seededConversationId}, ${buyerUserId!}, ${seededCreatorUserId}, 'pending', 0
        )
        on conflict (conversation_id) do update
        set state = 'pending', requester_message_count = 0, responded_at = null, updated_at = now()
      `;

      const conversationRequestIdempotencyKey = `conversation-request-${runId}`;
      const requestConversationResponse = await app.inject({
        method: "POST",
        url: "/v1/messages/conversations",
        headers: authenticatedHeaders(conversationRequestIdempotencyKey),
        payload: { targetUserId: seededCreatorUserId }
      });
      expect(requestConversationResponse.statusCode, requestConversationResponse.body).toBe(201);
      expect(requestConversationResponse.json()).toMatchObject({
        id: seededConversationId,
        requestState: "pending",
        requestRole: "initiator",
        canSend: true
      });

      const declinedPaidIntentResponse = await app.inject({
        method: "POST",
        url: `/v1/messages/conversations/${seededConversationId}/paid-message-intents`,
        headers: authenticatedHeaders(`paid-message-decline-${runId}`),
        payload: { body: `Must not deliver after decline ${shortRunId}` }
      });
      expect(declinedPaidIntentResponse.statusCode, declinedPaidIntentResponse.body).toBe(201);
      const declinedPaidIntent = declinedPaidIntentResponse.json<{ paymentIntent: { id: string } }>();

      const declineBeforeSettlementResponse = await app.inject({
        method: "PATCH",
        url: `/v1/messages/conversations/${seededConversationId}/request`,
        headers: creatorAuthenticatedHeaders(`request-decline-before-settlement-${runId}`),
        payload: { action: "decline" }
      });
      expect(declineBeforeSettlementResponse.statusCode, declineBeforeSettlementResponse.body).toBe(200);

      await acceptImmediateCheckout(declinedPaidIntent.paymentIntent.id, "declined-paid-message");

      const declinedPaidSubmissionResponse = await app.inject({
        method: "POST",
        url: `/v1/payments/intents/${declinedPaidIntent.paymentIntent.id}/submissions`,
        headers: authenticatedHeaders(`paid-message-decline-submission-${runId}`),
        payload: { signature: validDeclinedPaidMessageSolanaSignature }
      });
      expect(declinedPaidSubmissionResponse.statusCode, declinedPaidSubmissionResponse.body).toBe(202);
      const declinedDeliveryRows = await sql<{
        delivery_state: string;
        message_count: string;
        recipient_notification_count: string;
        remediation_count: string;
      }[]>`
        select
          request.state as delivery_state,
          (select count(*) from messages where payment_intent_id = request.payment_intent_id)::text as message_count,
          (
            select count(*) from notifications
            where user_id = request.recipient_user_id
              and related_resource_id = request.payment_intent_id
          )::text as recipient_notification_count,
          (
            select count(*) from notifications
            where user_id = request.sender_user_id
              and idempotency_key = 'paid-message-remediation:' || request.payment_intent_id
          )::text as remediation_count
        from paid_message_delivery_requests request
        where request.payment_intent_id = ${declinedPaidIntent.paymentIntent.id}
      `;
      expect(declinedDeliveryRows[0]).toEqual({
        delivery_state: "cancelled",
        message_count: "0",
        recipient_notification_count: "0",
        remediation_count: "1"
      });

      await sql`
        update direct_message_requests
        set state = 'pending', requester_message_count = 0, responded_at = null, updated_at = now()
        where conversation_id = ${seededConversationId}
      `;

      const concurrentRequestMessages = await Promise.all(
        [1, 2, 3].map((index) => app.inject({
          method: "POST",
          url: `/v1/messages/conversations/${seededConversationId}/messages`,
          headers: authenticatedHeaders(`request-message-${index}-${runId}`),
          payload: { body: `Request message ${index} ${shortRunId}` }
        }))
      );
      expect(concurrentRequestMessages.map((response) => response.statusCode).sort()).toEqual([
        201,
        201,
        409
      ]);
      const requestCeilingRows = await sql<{
        message_count: string;
        requester_message_count: number;
      }[]>`
        select
          count(m.id)::text as message_count,
          request.requester_message_count
        from direct_message_requests request
        left join messages m
          on m.conversation_id = request.conversation_id
          and m.idempotency_key like ${`request-message-%-${runId}`}
        where request.conversation_id = ${seededConversationId}
        group by request.requester_message_count
      `;
      expect(requestCeilingRows[0]).toEqual({
        message_count: "2",
        requester_message_count: 2
      });

      await sql`
        insert into user_follows (follower_user_id, followed_user_id, state)
        values (${seededCreatorUserId}, ${buyerUserId!}, 'active')
        on conflict (follower_user_id, followed_user_id) do update
        set state = 'active', updated_at = now()
      `;
      const trustedRelationshipConversation = await app.inject({
        method: "POST",
        url: "/v1/messages/conversations",
        headers: authenticatedHeaders(`conversation-trusted-${runId}`),
        payload: { targetUserId: seededCreatorUserId }
      });
      expect(
        trustedRelationshipConversation.statusCode,
        trustedRelationshipConversation.body
      ).toBe(201);
      expect(trustedRelationshipConversation.json()).toMatchObject({
        id: seededConversationId,
        requestState: "accepted",
        canSend: true
      });
      await sql`
        update direct_message_requests
        set state = 'pending', responded_at = null, updated_at = now()
        where conversation_id = ${seededConversationId}
      `;
      await sql`
        update user_follows
        set state = 'inactive', updated_at = now()
        where follower_user_id = ${seededCreatorUserId}
          and followed_user_id = ${buyerUserId!}
      `;

      const acceptedRequest = await app.inject({
        method: "PATCH",
        url: `/v1/messages/conversations/${seededConversationId}/request`,
        headers: creatorAuthenticatedHeaders(`request-accept-${runId}`),
        payload: { action: "accept" }
      });
      expect(acceptedRequest.statusCode, acceptedRequest.body).toBe(200);
      expect(acceptedRequest.json()).toMatchObject({ requestState: "accepted", canSend: true });

      const acceptedRequestReplay = await app.inject({
        method: "PATCH",
        url: `/v1/messages/conversations/${seededConversationId}/request`,
        headers: creatorAuthenticatedHeaders(`request-accept-${runId}`),
        payload: { action: "accept" }
      });
      expect(acceptedRequestReplay.statusCode, acceptedRequestReplay.body).toBe(200);
      expect(acceptedRequestReplay.json()).toEqual(acceptedRequest.json());

      const terminalRequestResponse = await app.inject({
        method: "PATCH",
        url: `/v1/messages/conversations/${seededConversationId}/request`,
        headers: creatorAuthenticatedHeaders(`request-decline-after-accept-${runId}`),
        payload: { action: "decline" }
      });
      expect(terminalRequestResponse.statusCode, terminalRequestResponse.body).toBe(403);

      const originalConversationReplay = await app.inject({
        method: "POST",
        url: "/v1/messages/conversations",
        headers: authenticatedHeaders(conversationRequestIdempotencyKey),
        payload: { targetUserId: seededCreatorUserId }
      });
      expect(originalConversationReplay.statusCode, originalConversationReplay.body).toBe(201);
      expect(originalConversationReplay.json()).toEqual(requestConversationResponse.json());

      const postAcceptanceMessage = await app.inject({
        method: "POST",
        url: `/v1/messages/conversations/${seededConversationId}/messages`,
        headers: authenticatedHeaders(`request-message-after-accept-${runId}`),
        payload: { body: `Accepted request message ${shortRunId}` }
      });
      expect(postAcceptanceMessage.statusCode, postAcceptanceMessage.body).toBe(201);

      const readConversationResponse = await app.inject({
        method: "PATCH",
        url: `/v1/messages/conversations/${seededConversationId}/read`,
        headers: creatorAuthenticatedHeaders(`conversation-read-${runId}`),
        payload: {}
      });
      expect(readConversationResponse.statusCode, readConversationResponse.body).toBe(200);
      expect(readConversationResponse.json()).toMatchObject({
        conversationId: seededConversationId,
        unreadCount: 0
      });
      const readConversationReplay = await app.inject({
        method: "PATCH",
        url: `/v1/messages/conversations/${seededConversationId}/read`,
        headers: creatorAuthenticatedHeaders(`conversation-read-${runId}`),
        payload: {}
      });
      expect(readConversationReplay.statusCode, readConversationReplay.body).toBe(200);
      expect(readConversationReplay.json()).toEqual(readConversationResponse.json());

      const creatorNotifications = await app.inject({
        method: "GET",
        url: "/v1/notifications",
        headers: creatorAuthenticatedHeaders(`notification-list-${runId}`)
      });
      expect(creatorNotifications.statusCode, creatorNotifications.body).toBe(200);
      const notificationItems = creatorNotifications.json<{ items: Array<{ id: string; state: string }> }>().items;
      expect(notificationItems.length).toBeGreaterThanOrEqual(2);
      const notificationReadRequest = {
        method: "PATCH" as const,
        url: `/v1/notifications/${notificationItems[0]!.id}/read`,
        headers: creatorAuthenticatedHeaders(`notification-read-${runId}`),
        payload: {}
      };
      const [notificationRead, concurrentNotificationRead] = await Promise.all([
        app.inject(notificationReadRequest),
        app.inject(notificationReadRequest)
      ]);
      expect(notificationRead.statusCode, notificationRead.body).toBe(200);
      expect(concurrentNotificationRead.statusCode, concurrentNotificationRead.body).toBe(200);
      expect(concurrentNotificationRead.json()).toEqual(notificationRead.json());
      const conflictingNotificationRead = await app.inject({
        ...notificationReadRequest,
        url: `/v1/notifications/${notificationItems[1]!.id}/read`
      });
      expect(conflictingNotificationRead.statusCode, conflictingNotificationRead.body).toBe(409);

      const lockedLiveRoomResponse = await app.inject({
        method: "GET",
        url: `/v1/live/rooms/${seededLiveRoomId}`,
        headers: authenticatedHeaders(`live-room-before-pass-${runId}`)
      });

      expect(lockedLiveRoomResponse.statusCode, lockedLiveRoomResponse.body).toBe(200);
      expect(lockedLiveRoomResponse.json()).toMatchObject({
        id: seededLiveRoomId,
        state: "live",
        accessMode: "paid_event",
        accessState: "event_access_required",
        playback: {
          state: "blocked",
          url: null,
          provider: "livepeer"
        },
        chat: {
          enabled: true,
          accessState: "members_only"
        }
      });

      const livePassIntentResponse = await app.inject({
        method: "POST",
        url: `/v1/live/rooms/${seededLiveRoomId}/event-access-intents`,
        headers: authenticatedHeaders(`live-event-access-${runId}`)
      });

      expect(livePassIntentResponse.statusCode, livePassIntentResponse.body).toBe(201);
      expect(livePassIntentResponse.json()).toMatchObject({
        productType: "live_pass",
        amountMinor: 50000000,
        currency: "SOL",
        state: "pending"
      });
      const livePassIntent = livePassIntentResponse.json<{
        id: string;
        amountMinor: number;
      }>();

      await acceptImmediateCheckout(livePassIntent.id, "live-pass");

      const livePassSubmissionResponse = await app.inject({
        method: "POST",
        url: `/v1/payments/intents/${livePassIntent.id}/submissions`,
        headers: authenticatedHeaders(`live-pass-submission-${runId}`),
        payload: {
          signature: validLivePassSolanaSignature
        }
      });

      expect(livePassSubmissionResponse.statusCode, livePassSubmissionResponse.body).toBe(202);
      const confirmedLivePassIntentResponse = await app.inject({
        method: "GET",
        url: `/v1/payments/intents/${livePassIntent.id}`,
        headers: authenticatedHeaders(`live-pass-intent-${runId}`)
      });

      expect(confirmedLivePassIntentResponse.statusCode, confirmedLivePassIntentResponse.body).toBe(200);
      expect(confirmedLivePassIntentResponse.json()).toMatchObject({
        id: livePassIntent.id,
        state: "confirmed",
        productType: "live_pass"
      });
      expect(settlementInputs).toHaveLength(5);
      expect(settlementInputs[4]).toEqual(
        expect.objectContaining({
          signature: validLivePassSolanaSignature,
          treasuryWallet,
          totalAmountMinor: livePassIntent.amountMinor
        })
      );
      expect(settlementInputs[4]?.referenceAddress).toMatch(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/);

      const activeLiveRoomResponse = await app.inject({
        method: "GET",
        url: `/v1/live/rooms/${seededLiveRoomId}`,
        headers: authenticatedHeaders(`live-room-after-pass-${runId}`)
      });

      expect(activeLiveRoomResponse.statusCode, activeLiveRoomResponse.body).toBe(200);
      expect(activeLiveRoomResponse.json()).toMatchObject({
        id: seededLiveRoomId,
        state: "live",
        accessState: "allowed",
        playback: {
          state: "full",
          provider: "livepeer",
          resourceType: "hls"
        },
        chat: {
          enabled: true,
          accessState: "allowed"
        }
      });
      expect(activeLiveRoomResponse.json().playback.url).toContain(
        `https://livepeercdn.studio/hls/livepeer-playback-${shortRunId}/index.m3u8`
      );
      expect(activeLiveRoomResponse.json().playback.url).not.toContain("jwt=");
      expect(activeLiveRoomResponse.json().playback.jwt).toBe(
        `integration-live-jwt-${shortRunId}`
      );

      const liveChatBody = `Live integration hello ${shortRunId}`;
      const liveChatResponse = await app.inject({
        method: "POST",
        url: `/v1/live/rooms/${seededLiveRoomId}/messages`,
        headers: authenticatedHeaders(`live-chat-${runId}`),
        payload: {
          body: liveChatBody
        }
      });

      expect(liveChatResponse.statusCode, liveChatResponse.body).toBe(201);
      expect(liveChatResponse.json()).toMatchObject({
        roomId: seededLiveRoomId,
        body: liveChatBody
      });

      const liveChatListResponse = await app.inject({
        method: "GET",
        url: `/v1/live/rooms/${seededLiveRoomId}/messages`,
        headers: authenticatedHeaders(`live-chat-list-${runId}`)
      });

      expect(liveChatListResponse.statusCode, liveChatListResponse.body).toBe(200);
      expect(liveChatListResponse.json()).toMatchObject({
        items: [
          {
            roomId: seededLiveRoomId,
            body: liveChatBody
          }
        ]
      });

      const livePassRows = await sql<{
        payment_intent_count: string;
        wallet_transaction_count: string;
        settlement_attempt_count: string;
        purchase_request_count: string;
        live_pass_count: string;
        entitlement_count: string;
        audit_event_count: string;
        chat_message_count: string;
      }[]>`
        select
          (
            select count(*)
            from payment_intents pi
            join users u on u.id = pi.user_id
            where u.supabase_user_id = ${buyerSupabaseUserId}
              and pi.id = ${livePassIntent.id}
              and pi.target_id = ${seededLiveRoomId}
              and pi.product_type = 'live_pass'
              and pi.state = 'confirmed'
          ) as payment_intent_count,
          (
            select count(*)
            from wallet_transaction_records wtr
            join users u on u.id = wtr.user_id
            where u.supabase_user_id = ${buyerSupabaseUserId}
              and wtr.payment_intent_id = ${livePassIntent.id}
              and wtr.state = 'confirmed'
          ) as wallet_transaction_count,
          (
            select count(*)
            from payment_settlement_attempts psa
            where psa.payment_intent_id = ${livePassIntent.id}
              and psa.state = 'confirmed'
          ) as settlement_attempt_count,
          (
            select count(*)
            from live_pass_purchase_requests lppr
            join users u on u.id = lppr.buyer_user_id
            where u.supabase_user_id = ${buyerSupabaseUserId}
              and lppr.payment_intent_id = ${livePassIntent.id}
              and lppr.room_id = ${seededLiveRoomId}
          ) as purchase_request_count,
          (
            select count(*)
            from live_passes lp
            join users u on u.id = lp.user_id
            where u.supabase_user_id = ${buyerSupabaseUserId}
              and lp.payment_intent_id = ${livePassIntent.id}
              and lp.room_id = ${seededLiveRoomId}
              and lp.state = 'active'
              and lp.starts_at <= now()
              and lp.expires_at is null
          ) as live_pass_count,
          (
            select count(*)
            from entitlements e
            join users u on u.id = e.user_id
            where u.supabase_user_id = ${buyerSupabaseUserId}
              and e.payment_intent_id = ${livePassIntent.id}
              and e.target_type = 'live_room'
              and e.target_id = ${seededLiveRoomId}
              and e.product_type = 'live_pass'
              and e.state = 'active'
              and e.ends_at is null
          ) as entitlement_count,
          (
            select count(*)
            from audit_events ae
            join users u on u.id = ae.actor_user_id
            where u.supabase_user_id = ${buyerSupabaseUserId}
              and ae.subject_id = ${seededLiveRoomId}
              and ae.action = 'live_event_access_entitlement_granted'
          ) as audit_event_count,
          (
            select count(*)
            from live_chat_messages lcm
            join users u on u.id = lcm.user_id
            where u.supabase_user_id = ${buyerSupabaseUserId}
              and lcm.room_id = ${seededLiveRoomId}
              and lcm.body = ${liveChatBody}
              and lcm.state = 'visible'
          ) as chat_message_count
      `;

      expect(livePassRows[0]).toEqual({
        payment_intent_count: "1",
        wallet_transaction_count: "1",
        settlement_attempt_count: "1",
        purchase_request_count: "1",
        live_pass_count: "1",
        entitlement_count: "1",
        audit_event_count: "1",
        chat_message_count: "1"
      });

      const remediationIntentResponse = await app.inject({
        method: "POST",
        url: `/v1/events/${seededEventId}/access-passes/intents`,
        headers: authenticatedHeaders(`event-access-remediation-${runId}`),
        payload: { accessPassTypeId: seededRemediationAccessPassTypeId }
      });
      expect(remediationIntentResponse.statusCode, remediationIntentResponse.body).toBe(201);
      const remediationIntent = remediationIntentResponse.json<{
        paymentIntent: { id: string };
      }>();

      await sql`
        insert into event_access_passes (
          id, event_id, access_pass_type_id, holder_user_id,
          payment_intent_id, qr_token, qr_token_hash
        ) values (
          ${randomUUID()}, ${seededEventId}, ${seededRemediationAccessPassTypeId},
          ${seededCreatorUserId}, null, ${`occupied-${runId}`}, ${`occupied-hash-${runId}`}
        )
      `;
      await acceptImmediateCheckout(remediationIntent.paymentIntent.id, "event-access-remediation");
      const remediationSubmissionResponse = await app.inject({
        method: "POST",
        url: `/v1/payments/intents/${remediationIntent.paymentIntent.id}/submissions`,
        headers: authenticatedHeaders(`event-access-remediation-submission-${runId}`),
        payload: { signature: validRemediationSolanaSignature }
      });
      expect(remediationSubmissionResponse.statusCode, remediationSubmissionResponse.body).toBe(202);

      const remediationRows = await sql<{
        payment_state: string;
        buyer_pass_count: string;
        support_case_count: string;
        audit_count: string;
      }[]>`
        select
          (select state from payment_intents where id = ${remediationIntent.paymentIntent.id}) as payment_state,
          (
            select count(*) from event_access_passes eap
            join users u on u.id = eap.holder_user_id
            where eap.payment_intent_id = ${remediationIntent.paymentIntent.id}
              and u.supabase_user_id = ${buyerSupabaseUserId}
          ) as buyer_pass_count,
          (
            select count(*) from support_cases
            where subject_type = 'payment'
              and subject_id = ${remediationIntent.paymentIntent.id}
              and state = 'pending_internal'
          ) as support_case_count,
          (
            select count(*) from audit_events
            where subject_id = ${remediationIntent.paymentIntent.id}
              and action = 'event_access_delivery_remediation_required'
          ) as audit_count
      `;
      expect(remediationRows[0]).toEqual({
        payment_state: "confirmed",
        buyer_pass_count: "0",
        support_case_count: "1",
        audit_count: "1"
      });

      const invalidReservationIntentResponse = await app.inject({
        method: "POST",
        url: `/v1/events/${seededEventId}/access-passes/intents`,
        headers: authenticatedHeaders(`event-access-invalid-reservation-${runId}`),
        payload: { accessPassTypeId: seededInvalidAccessPassTypeId }
      });
      expect(
        invalidReservationIntentResponse.statusCode,
        invalidReservationIntentResponse.body
      ).toBe(201);
      const invalidReservationIntent = invalidReservationIntentResponse.json<{
        paymentIntent: { id: string };
      }>();
      await acceptImmediateCheckout(
        invalidReservationIntent.paymentIntent.id,
        "event-access-invalid-reservation"
      );
      const reservationBeforeRows = await sql<{ reserved_until: Date }[]>`
        select reserved_until
        from event_access_purchase_requests
        where payment_intent_id = ${invalidReservationIntent.paymentIntent.id}
      `;
      const invalidSubmissionResponse = await app.inject({
        method: "POST",
        url: `/v1/payments/intents/${invalidReservationIntent.paymentIntent.id}/submissions`,
        headers: authenticatedHeaders(`event-access-invalid-submission-${runId}`),
        payload: { signature: invalidReservationSolanaSignature }
      });
      expect(invalidSubmissionResponse.statusCode, invalidSubmissionResponse.body).toBe(202);
      const reservationAfterRows = await sql<{ reserved_until: Date }[]>`
        select reserved_until
        from event_access_purchase_requests
        where payment_intent_id = ${invalidReservationIntent.paymentIntent.id}
      `;
      expect(reservationAfterRows[0]?.reserved_until.toISOString()).toBe(
        reservationBeforeRows[0]?.reserved_until.toISOString()
      );

      await liveRepository.updateRoomStatus({
        roomId: seededLiveRoomId,
        status: {
          providerStreamId: `livepeer-stream-${shortRunId}`,
          providerPlaybackId: `livepeer-playback-${shortRunId}`,
          providerState: "idle",
          state: "ended",
          playbackUrl: null
        }
      });

      const [closedLiveAccess] = await sql<{
        room_ended: boolean;
        pass_matches_entitlement: boolean;
        replay_window_is_48_hours: boolean;
      }[]>`
        select
          lr.state = 'ended' and lr.ended_at is not null as room_ended,
          lp.expires_at = e.ends_at as pass_matches_entitlement,
          lp.expires_at = lr.ended_at + interval '48 hours' as replay_window_is_48_hours
        from live_rooms lr
        join live_passes lp on lp.room_id = lr.id
        join entitlements e on e.payment_intent_id = lp.payment_intent_id
        where lr.id = ${seededLiveRoomId}
          and lp.payment_intent_id = ${livePassIntent.id}
          and e.product_type = 'live_pass'
      `;

      expect(closedLiveAccess).toEqual({
        room_ended: true,
        pass_matches_entitlement: true,
        replay_window_is_48_hours: true
      });

      const subscriptionPlansResponse = await app.inject({
        method: "GET",
        url: "/v1/subscriptions/plans",
        headers: authenticatedHeaders(`subscription-plans-${runId}`)
      });

      expect(subscriptionPlansResponse.statusCode, subscriptionPlansResponse.body).toBe(200);
      expect(subscriptionPlansResponse.json()).toMatchObject({
        items: expect.arrayContaining([
          expect.objectContaining({
            id: seededSubscriptionPlanId,
            scope: "platform",
            amountMinor: 19000000,
            currency: "USDC",
            periodDays: 30,
            billingMode: "delegated_solana_subscription",
            tokenMint: subscriptionTokenMint,
            tokenProgram: "spl_token"
          })
        ])
      });

      const subscriptionIntentResponse = await app.inject({
        method: "POST",
        url: "/v1/subscriptions/intents",
        headers: authenticatedHeaders(`subscription-intent-${runId}`),
        payload: {
          planId: seededSubscriptionPlanId
        }
      });

      expect(subscriptionIntentResponse.statusCode, subscriptionIntentResponse.body).toBe(201);
      expect(subscriptionIntentResponse.json()).toMatchObject({
        subscription: {
          scope: "platform",
          planId: seededSubscriptionPlanId,
          state: "authorization_pending",
          renewalMode: "delegated_solana_subscription"
        },
        authorizationMode: "delegated_solana_subscription",
        providerReadiness: {
          activeMode: "delegated_solana_subscription"
        }
      });
      const subscriptionIntent = subscriptionIntentResponse.json<{
        id: string;
        setupReference: string;
        subscription: {
          id: string;
        };
      }>();

      const subscriptionTransactionResponse = await app.inject({
        method: "GET",
        url: `/v1/subscriptions/authorizations/${subscriptionIntent.id}/transaction`,
        headers: authenticatedHeaders(`subscription-transaction-${runId}`)
      });

      expect(subscriptionTransactionResponse.statusCode, subscriptionTransactionResponse.body).toBe(200);
      expect(subscriptionTransactionResponse.json()).toMatchObject({
        transaction: expect.any(String),
        authorityAddress: subscriptionAuthorityAddress,
        delegationAddress: subscriptionDelegationAddress,
        subscriberTokenAccount: subscriptionTokenAccount
      });

      const subscriptionAuthorizationResponse = await app.inject({
        method: "POST",
        url: `/v1/subscriptions/authorizations/${subscriptionIntent.id}/submissions`,
        headers: authenticatedHeaders(`subscription-authorization-${runId}`),
        payload: {
          signature: validSubscriptionAuthorizationSignature
        }
      });

      expect(subscriptionAuthorizationResponse.statusCode, subscriptionAuthorizationResponse.body).toBe(202);
      expect(subscriptionAuthorizationResponse.json()).toMatchObject({
        id: subscriptionIntent.subscription.id,
        scope: "platform",
        planId: seededSubscriptionPlanId,
        state: "renewal_pending",
        renewalMode: "delegated_solana_subscription",
        authorityAddress: subscriptionAuthorityAddress,
        delegationAddress: subscriptionDelegationAddress
      });
      expect(subscriptionVerificationInputs).toEqual([
        expect.objectContaining({
          signature: validSubscriptionAuthorizationSignature,
          setupReference: subscriptionIntent.setupReference,
          authorityAddress: subscriptionAuthorityAddress,
          delegationAddress: subscriptionDelegationAddress,
          subscriberTokenAccount: subscriptionTokenAccount,
          collectorAddress: subscriptionCollectorWallet,
          tokenMint: subscriptionTokenMint,
          tokenProgram: "spl_token",
          amountMinor: 19000000,
          periodDays: 30
        })
      ]);

      const initialCollectionRepository = createPostgresSubscriptionCollectionRepository(databaseUrl);
      try {
        const initialCollectionResult = await processDueSubscriptionCollections({
          repository: initialCollectionRepository,
          now: new Date(),
          limit: 5,
          provider: {
            async reconcile() {
              return { state: "not_found" };
            },
            async collect(input) {
              expect(input.subscriptionId).toBe(subscriptionIntent.subscription.id);
              return {
                state: "confirmed",
                collectionSignature: deterministicBase58Signature(170)
              };
            }
          }
        });
        expect(initialCollectionResult).toEqual({
          expired: 0,
          leased: 1,
          confirmed: 1,
          failed: 0,
          revoked: 0
        });
      } finally {
        await initialCollectionRepository.close?.();
      }

      const subscriptionsResponse = await app.inject({
        method: "GET",
        url: "/v1/subscriptions",
        headers: authenticatedHeaders(`subscriptions-list-${runId}`)
      });

      expect(subscriptionsResponse.statusCode, subscriptionsResponse.body).toBe(200);
      expect(subscriptionsResponse.json()).toMatchObject({
        items: [
          {
            id: subscriptionIntent.subscription.id,
            state: "active",
            planId: seededSubscriptionPlanId,
            authorityAddress: subscriptionAuthorityAddress,
            delegationAddress: subscriptionDelegationAddress
          }
        ]
      });

      const subscriptionRows = await sql<{
        subscription_count: string;
        authorization_intent_count: string;
        initial_collection_count: string;
        authorization_event_count: string;
      }[]>`
        select
          (
            select count(*)
            from subscriptions s
            join users u on u.id = s.subscriber_user_id
            where u.supabase_user_id = ${buyerSupabaseUserId}
              and s.id = ${subscriptionIntent.subscription.id}
              and s.plan_id = ${seededSubscriptionPlanId}
              and s.state = 'active'
              and s.authority_address = ${subscriptionAuthorityAddress}
              and s.delegation_address = ${subscriptionDelegationAddress}
              and s.subscriber_token_account = ${subscriptionTokenAccount}
              and s.collector_address = ${subscriptionCollectorWallet}
              and s.next_collection_at is not null
          ) as subscription_count,
          (
            select count(*)
            from subscription_authorization_intents sai
            where sai.id = ${subscriptionIntent.id}
              and sai.subscription_id = ${subscriptionIntent.subscription.id}
              and sai.state = 'verified'
              and sai.verified_signature = ${validSubscriptionAuthorizationSignature}
          ) as authorization_intent_count,
          (
            select count(*)
            from subscription_collections sc
            where sc.subscription_id = ${subscriptionIntent.subscription.id}
              and sc.state = 'confirmed'
          ) as initial_collection_count,
          (
            select count(*)
            from subscription_events se
            where se.subscription_id = ${subscriptionIntent.subscription.id}
              and se.authorization_intent_id = ${subscriptionIntent.id}
              and se.action in (
                'subscription.authorization_intent_created',
                'subscription.authorization_verified'
              )
          ) as authorization_event_count
      `;

      expect(subscriptionRows[0]).toEqual({
        subscription_count: "1",
        authorization_intent_count: "1",
        initial_collection_count: "1",
        authorization_event_count: "2"
      });

      await sql`
        update subscriptions
        set
          current_period_ends_at = now() - interval '1 second',
          next_collection_at = now() - interval '1 second'
        where id = ${subscriptionIntent.subscription.id}
      `;

      const collectionRepository = createPostgresSubscriptionCollectionRepository(databaseUrl);
      try {
        const collectionResult = await processDueSubscriptionCollections({
          repository: collectionRepository,
          now: new Date(),
          limit: 5,
          provider: {
            async reconcile() {
              return { state: "not_found" };
            },
            async collect(input) {
              expect(input).toEqual(
                expect.objectContaining({
                  subscriptionId: subscriptionIntent.subscription.id,
                  planId: seededSubscriptionPlanId,
                  amountMinor: 19000000n,
                  currency: "USDC",
                  authorityAddress: subscriptionAuthorityAddress,
                  delegationAddress: subscriptionDelegationAddress,
                  subscriberTokenAccount: subscriptionTokenAccount,
                  collectorAddress: subscriptionCollectorWallet,
                  tokenMint: subscriptionTokenMint,
                  tokenProgram: "spl_token"
                })
              );

              return {
                state: "confirmed",
                collectionSignature: deterministicBase58Signature(171)
              };
            }
          }
        });

        expect(collectionResult).toEqual({
          expired: 0,
          leased: 1,
          confirmed: 1,
          failed: 0,
          revoked: 0
        });
      } finally {
        await collectionRepository.close?.();
      }

      const subscriptionCollectionRows = await sql<{
        confirmed_collection_count: string;
        submitted_event_count: string;
        confirmed_event_count: string;
        active_subscription_count: string;
      }[]>`
        select
          (
            select count(*)
            from subscription_collections sc
            where sc.subscription_id = ${subscriptionIntent.subscription.id}
              and sc.state = 'confirmed'
              and sc.collection_signature = ${deterministicBase58Signature(171)}
              and sc.confirmed_at is not null
          ) as confirmed_collection_count,
          (
            select count(*)
            from subscription_events se
            where se.subscription_id = ${subscriptionIntent.subscription.id}
              and se.action = 'subscription.collection_submitted'
          ) as submitted_event_count,
          (
            select count(*)
            from subscription_events se
            where se.subscription_id = ${subscriptionIntent.subscription.id}
              and se.action = 'subscription.collection_confirmed'
          ) as confirmed_event_count,
          (
            select count(*)
            from subscriptions s
            where s.id = ${subscriptionIntent.subscription.id}
              and s.state = 'active'
              and s.next_collection_at > now()
          ) as active_subscription_count
      `;

      expect(subscriptionCollectionRows[0]).toEqual({
        confirmed_collection_count: "1",
        submitted_event_count: "2",
        confirmed_event_count: "2",
        active_subscription_count: "1"
      });

      await seedProviderReplayRequest(sql, {
        providerEventId: seededProviderEventId,
        replayRequestId: seededProviderReplayRequestId,
        runId
      });

      const replayRepository = createPostgresProviderEventReplayRepository(databaseUrl);
      try {
        const replayResult = await processProviderEventReplays({
          repository: replayRepository,
          now: new Date(),
          limit: 5,
          adapter: {
            async replay(input) {
              expect(input).toEqual({
                replayRequestId: seededProviderReplayRequestId,
                leaseToken: expect.any(String),
                attemptCount: 1,
                providerEventId: seededProviderEventId,
                provider: "solana_indexer",
                eventType: "payment.confirmed",
                replayPayload: {}
              });

              return {
                state: "replayed"
              };
            }
          }
        });

        expect(replayResult).toEqual({
          leased: 1,
          replayed: 1,
          failed: 0
        });
      } finally {
        await replayRepository.close?.();
      }

      const replayRows = await sql<{
        replay_request_count: string;
        provider_event_count: string;
      }[]>`
        select
          (
            select count(*)
            from provider_event_replay_requests perr
            where perr.id = ${seededProviderReplayRequestId}
              and perr.provider_event_id = ${seededProviderEventId}
              and perr.state = 'replayed'
              and perr.attempt_count = 1
              and perr.processed_at is not null
          ) as replay_request_count,
          (
            select count(*)
            from provider_events pe
            where pe.id = ${seededProviderEventId}
              and pe.normalized_state = 'replayed'
              and pe.processed_at is not null
          ) as provider_event_count
      `;

      expect(replayRows[0]).toEqual({
        replay_request_count: "1",
        provider_event_count: "1"
      });

      const preBlockUnfollowResponse = await app.inject({
        method: "DELETE",
        url: `/v1/follows/${seededCreatorUserId}`,
        headers: authenticatedHeaders(`pre-block-unfollow-${runId}`)
      });
      expect(preBlockUnfollowResponse.statusCode, preBlockUnfollowResponse.body).toBe(200);

      const blockIdempotencyKey = `engagement-block-${runId}`;
      const [concurrentFollowDuringBlock, ...concurrentBlockResponses] = await Promise.all([
        app.inject({
          method: "POST",
          url: `/v1/follows/${seededCreatorUserId}`,
          headers: authenticatedHeaders(`concurrent-follow-block-${runId}`)
        }),
        app.inject({
          method: "POST",
          url: `/v1/blocks/${seededCreatorUserId}`,
          headers: authenticatedHeaders(blockIdempotencyKey)
        }),
        app.inject({
          method: "POST",
          url: `/v1/blocks/${seededCreatorUserId}`,
          headers: authenticatedHeaders(blockIdempotencyKey)
        })
      ]);
      // The ordered pair lock permits either mutation to win the race. If the
      // block commits first, the follow must fail closed; if the follow commits
      // first, the block trigger removes it before the final state is observed.
      expect([200, 403, 409]).toContain(concurrentFollowDuringBlock.statusCode);
      if (concurrentFollowDuringBlock.statusCode === 403) {
        expect(concurrentFollowDuringBlock.json()).toEqual({
          code: "forbidden",
          message: "Follow is unavailable for this profile"
        });
      }
      expect(concurrentBlockResponses.map((response) => response.statusCode)).toEqual([200, 200]);
      expect(concurrentBlockResponses[0]?.json()).toEqual(concurrentBlockResponses[1]?.json());

      const conflictingBlockResponse = await app.inject({
        method: "POST",
        url: `/v1/blocks/${buyerUserId!}`,
        headers: authenticatedHeaders(blockIdempotencyKey)
      });
      expect(conflictingBlockResponse.statusCode, conflictingBlockResponse.body).toBe(409);

      const [blockRows] = await sql<{
        audit_count: string;
        block_count: string;
      }[]>`
        select
          (select count(*) from blocks where blocker_user_id = ${buyerUserId!}) as block_count,
          (
            select count(*)
            from audit_events
            where actor_user_id = ${buyerUserId!}
              and action = 'user.blocked'
              and idempotency_key = ${blockIdempotencyKey}
          ) as audit_count
      `;
      expect(blockRows).toEqual({ audit_count: "1", block_count: "1" });
      const [blockedFollowRows] = await sql<{
        follower_count: string;
        follow_state: string;
        following_count: string;
      }[]>`
        select
          follow.state as follow_state,
          creator_counts.follower_count,
          buyer_counts.following_count
        from user_follows follow
        join user_social_counts creator_counts on creator_counts.user_id = follow.followed_user_id
        join user_social_counts buyer_counts on buyer_counts.user_id = follow.follower_user_id
        where follow.follower_user_id = ${buyerUserId!}
          and follow.followed_user_id = ${seededCreatorUserId}
      `;
      expect(blockedFollowRows).toEqual({
        follower_count: "0",
        follow_state: "inactive",
        following_count: "0"
      });
    } finally {
      await cleanupRun(sql, {
        buyerHandle,
        creatorHandle,
        buyerSupabaseUserId,
        creatorSupabaseUserId,
        providerReference,
        seededContentId,
        seededFreeContentId,
        seededEventId,
        seededConversationId,
        seededLiveRoomId,
        seededSubscriptionPlanId,
        seededProviderEventId,
        seededProviderReplayRequestId,
        seededOrganizationId
      });
      await app.close();
      vi.unstubAllEnvs();
    }
  }, 180_000);

  it("fails closed when a link intent targets a blocked recovery identity", async () => {
    const databaseUrl = integrationDatabaseUrl();
    assertIntegrationDatabaseIsAllowed(databaseUrl);

    const sql = createPostgresClient(databaseUrl);
    const userId = randomUUID();
    const providerSubject = randomUUID();
    const providerIdentityId = randomUUID();
    const sessionId = randomUUID();
    const intentId = randomUUID();
    const sessionToken = `wevid_session_${randomUUID()}`;
    const linkIntentToken = `wevid_recovery_link_${randomUUID()}`;
    const repository = createPostgresWalletAuthRepository(sql);

    try {
      await sql`
        insert into users (id, supabase_user_id)
        values (${userId}, ${providerSubject})
      `;
      await sql`
        insert into user_provider_identities (
          id, provider, provider_subject, user_id, status, linked_at, last_used_at
        )
        values (
          ${providerIdentityId}, 'supabase', ${providerSubject}, ${userId}, 'blocked', now(), now()
        )
      `;
      await sql`
        insert into app_sessions (
          id, user_id, wallet_id, provider_identity_id, token_hash, expires_at,
          authentication_method, authenticated_at
        )
        values (
          ${sessionId}, ${userId}, null, ${providerIdentityId}, ${hashToken(sessionToken)},
          now() + interval '10 minutes', 'supabase_recovery', now()
        )
      `;
      await sql`
        insert into recovery_link_intents (
          id, user_id, session_id, token_hash, expires_at
        )
        values (
          ${intentId}, ${userId}, ${sessionId}, ${hashToken(linkIntentToken)},
          now() + interval '10 minutes'
        )
      `;

      await expect(
        repository.exchangeRecoveryIdentity({
          provider: "supabase",
          providerSubject,
          linkIntentToken,
          sessionExpiresAt: new Date(Date.now() + 10 * 60 * 1000)
        })
      ).rejects.toBeInstanceOf(WalletRecoveryLinkConflictError);

      const identityRows = await sql<{ status: string }[]>`
        select status
        from user_provider_identities
        where id = ${providerIdentityId}
      `;
      expect(identityRows[0]?.status).toBe("blocked");
    } finally {
      await sql`delete from recovery_link_intents where id = ${intentId}`;
      await sql`delete from app_sessions where id = ${sessionId}`;
      await sql`delete from user_provider_identities where id = ${providerIdentityId}`;
      await sql`delete from users where id = ${userId}`;
      await sql.end();
    }
  }, 30_000);

  it("preserves authentication freshness and lifetime when rotating a session", async () => {
    const databaseUrl = integrationDatabaseUrl();
    assertIntegrationDatabaseIsAllowed(databaseUrl);

    const sql = createPostgresClient(databaseUrl);
    const userId = randomUUID();
    const supabaseUserId = randomUUID();
    const walletId = randomUUID();
    const sessionId = randomUUID();
    const intentId = randomUUID();
    const sessionToken = `wevid_session_${randomUUID()}`;
    const linkIntentToken = `wevid_recovery_link_${randomUUID()}`;
    const authenticatedAt = new Date(Date.now() - 20 * 60 * 1000);
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000);
    const repository = createPostgresWalletAuthRepository(sql);

    try {
      await sql`insert into users (id, supabase_user_id) values (${userId}, ${supabaseUserId})`;
      await sql`
        insert into wallets (id, user_id, provider, address, chain, is_primary)
        values (${walletId}, ${userId}, 'phantom', ${randomUUID()}, 'solana_devnet', true)
      `;
      await sql`
        insert into app_sessions (
          id, user_id, wallet_id, token_hash, expires_at, authentication_method, authenticated_at
        )
        values (
          ${sessionId}, ${userId}, ${walletId}, ${hashToken(sessionToken)}, ${expiresAt},
          'wallet', ${authenticatedAt}
        )
      `;
      await sql`
        insert into recovery_link_intents (id, user_id, session_id, token_hash, expires_at)
        values (
          ${intentId}, ${userId}, ${sessionId}, ${hashToken(linkIntentToken)},
          now() + interval '10 minutes'
        )
      `;

      const rotated = await repository.rotateSessionToken({ sessionToken });
      expect(rotated.expiresAt.getTime()).toBe(expiresAt.getTime());

      const activeSessions = await sql<{ authenticated_at: Date; expires_at: Date }[]>`
        select authenticated_at, expires_at
        from app_sessions
        where user_id = ${userId}
          and revoked_at is null
      `;
      expect(activeSessions).toHaveLength(1);
      expect(activeSessions[0]?.authenticated_at.getTime()).toBe(authenticatedAt.getTime());
      expect(activeSessions[0]?.expires_at.getTime()).toBe(expiresAt.getTime());

      await expect(
        repository.exchangeRecoveryIdentity({
          provider: "supabase",
          providerSubject: randomUUID(),
          linkIntentToken,
          sessionExpiresAt: new Date(Date.now() + 10 * 60 * 1000)
        })
      ).rejects.toBeInstanceOf(WalletAuthChallengeInvalidError);

      await repository.revokeSessionToken(rotated.accessToken);
      const activeAfterLogout = await sql<{ count: string }[]>`
        select count(*)::text as count
        from app_sessions
        where user_id = ${userId}
          and revoked_at is null
      `;
      expect(activeAfterLogout[0]?.count).toBe("0");
    } finally {
      await sql`delete from recovery_link_intents where id = ${intentId}`;
      await sql`delete from app_sessions where user_id = ${userId}`;
      await sql`delete from wallets where id = ${walletId}`;
      await sql`delete from users where id = ${userId}`;
      await sql.end();
    }
  }, 30_000);

  it("keeps device sessions independent, logs out all devices, and makes account-security revocation idempotent", async () => {
    const databaseUrl = integrationDatabaseUrl();
    assertIntegrationDatabaseIsAllowed(databaseUrl);

    const sql = createPostgresClient(databaseUrl);
    const repository = createPostgresWalletAuthRepository(sql);
    const address = `session-scope-${randomUUID()}`;
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
    let userId: string | null = null;

    try {
      const challengeA = await repository.createChallenge({
        chain: "solana_devnet",
        provider: "phantom",
        address,
        message: `device-a-${randomUUID()}`,
        nonceHash: randomUUID(),
        expiresAt
      });
      const sessionA = await repository.createSessionFromChallenge({
        challengeId: challengeA.id,
        expiresAt
      });
      const verifiedA = await repository.verifySessionToken(sessionA.accessToken);
      expect(verifiedA).not.toBeNull();
      userId = verifiedA?.userId ?? null;

      const challengeB = await repository.createChallenge({
        chain: "solana_devnet",
        provider: "phantom",
        address,
        message: `device-b-${randomUUID()}`,
        nonceHash: randomUUID(),
        expiresAt
      });
      const sessionB = await repository.createSessionFromChallenge({
        challengeId: challengeB.id,
        expiresAt
      });

      expect(await repository.verifySessionToken(sessionA.accessToken)).not.toBeNull();
      expect(await repository.verifySessionToken(sessionB.accessToken)).not.toBeNull();

      const rotatedA = await repository.rotateSessionToken({ sessionToken: sessionA.accessToken });
      expect(await repository.verifySessionToken(sessionA.accessToken)).toBeNull();
      expect(await repository.verifySessionToken(rotatedA.accessToken)).not.toBeNull();
      expect(await repository.verifySessionToken(sessionB.accessToken)).not.toBeNull();
      await expect(
        repository.rotateSessionToken({ sessionToken: sessionA.accessToken })
      ).rejects.toBeInstanceOf(WalletAuthChallengeInvalidError);

      await repository.revokeSessionToken(rotatedA.accessToken);
      expect(await repository.verifySessionToken(rotatedA.accessToken)).toBeNull();
      expect(await repository.verifySessionToken(sessionB.accessToken)).not.toBeNull();

      expect(userId).not.toBeNull();
      const challengeC = await repository.createChallenge({
        chain: "solana_devnet",
        provider: "phantom",
        address,
        message: `device-c-${randomUUID()}`,
        nonceHash: randomUUID(),
        expiresAt
      });
      const sessionC = await repository.createSessionFromChallenge({
        challengeId: challengeC.id,
        expiresAt
      });

      const logoutAllCount = await repository.revokeAllSessions({
        userId: userId as string,
        actorUserId: userId as string,
        reason: "user_logout_all"
      });
      expect(logoutAllCount).toBe(2);
      expect(await repository.verifySessionToken(sessionB.accessToken)).toBeNull();
      expect(await repository.verifySessionToken(sessionC.accessToken)).toBeNull();

      const challengeD = await repository.createChallenge({
        chain: "solana_devnet",
        provider: "phantom",
        address,
        message: `device-d-${randomUUID()}`,
        nonceHash: randomUUID(),
        expiresAt
      });
      const sessionD = await repository.createSessionFromChallenge({
        challengeId: challengeD.id,
        expiresAt
      });
      const accountSecurityCount = await repository.revokeAllSessions({
        userId: userId as string,
        actorUserId: userId as string,
        reason: "account_security"
      });
      expect(accountSecurityCount).toBe(1);
      expect(await repository.verifySessionToken(sessionD.accessToken)).toBeNull();

      const replayedRevocationCount = await repository.revokeAllSessions({
        userId: userId as string,
        actorUserId: userId as string,
        reason: "account_security"
      });
      expect(replayedRevocationCount).toBe(0);

      const audits = await sql<{ count: string }[]>`
        select count(*)::text as count
        from audit_events
        where actor_user_id = ${userId}
          and subject_id = ${userId}
          and action = 'auth.sessions_revoked_all'
      `;
      expect(audits[0]?.count).toBe("2");
    } finally {
      if (userId) {
        await sql`delete from audit_events where actor_user_id = ${userId}`;
        await sql`delete from recovery_link_intents where user_id = ${userId}`;
        await sql`delete from app_sessions where user_id = ${userId}`;
        await sql`delete from wallets where user_id = ${userId}`;
        await sql`delete from users where id = ${userId}`;
      }
      await sql`delete from wallet_auth_challenges where address = ${address}`;
      await sql.end();
    }
  }, 30_000);
});

function integrationDatabaseUrl(): string {
  const databaseUrl =
    process.env.API_INTEGRATION_DATABASE_URL ??
    process.env.TEST_DATABASE_URL ??
    process.env.DATABASE_URL;

  if (!databaseUrl) {
    throw new Error(
      "Set API_INTEGRATION_DATABASE_URL, TEST_DATABASE_URL, or DATABASE_URL for real API integration tests."
    );
  }

  return databaseUrl;
}

function assertIntegrationDatabaseIsAllowed(databaseUrl: string): void {
  if (process.env.NODE_ENV === "production") {
    throw new Error("Refusing to run real API integration tests with NODE_ENV=production.");
  }

  const host = new URL(databaseUrl).hostname;
  const isLocal = host === "localhost" || host === "127.0.0.1" || host === "::1";

  if (!isLocal && process.env.VEEL_ALLOW_REMOTE_API_INTEGRATION_TESTS !== "1") {
    throw new Error(
      "Refusing to run real API integration tests against a remote database unless VEEL_ALLOW_REMOTE_API_INTEGRATION_TESTS=1 is set."
    );
  }
}

function authenticatedHeaders(idempotencyKey: string): Record<string, string> {
  return {
    authorization: `Bearer ${authToken}`,
    "idempotency-key": idempotencyKey
  };
}

function creatorAuthenticatedHeaders(idempotencyKey: string): Record<string, string> {
  return {
    authorization: `Bearer ${creatorAuthToken}`,
    "idempotency-key": idempotencyKey
  };
}

const integrationAuthVerifier: ApplicationSessionVerifier = {
  async verifyToken(token: string): Promise<VerifiedApplicationSession | null> {
    if (token === authToken) {
      return {
        userId: buyerSupabaseUserId,
        supabaseUserId: buyerSupabaseUserId,
        sessionId: buyerSupabaseUserId,
        authenticatedAt: new Date(),
        authenticationMethod: "wallet"
      };
    }
    if (token === creatorAuthToken) {
      return {
        userId: creatorSupabaseUserId,
        supabaseUserId: creatorSupabaseUserId,
        sessionId: creatorSupabaseUserId,
        authenticatedAt: new Date(),
        authenticationMethod: "wallet"
      };
    }
    return null;
  }
};

function createIntegrationAgeWaterfall(providerReference: string): AgeProviderWaterfall {
  return {
    async createSession() {
      return {
        provider: "sumsub",
        providerReference,
        launchUrl: `https://age.example.test/sumsub/${providerReference}`,
        expiresAt: new Date(Date.now() + 15 * 60 * 1000),
        jurisdiction: "US",
        rule: "over_18"
      };
    }
  };
}

function sumsubDigest(rawPayload: string): string {
  return createHmac("sha256", sumsubWebhookSecret).update(rawPayload).digest("hex");
}

function deterministicBase58Signature(seed: number): string {
  return bs58.encode(Uint8Array.from({ length: 64 }, (_, index) => (seed + index * 17) % 256));
}

async function seedCreatorPaidContent(
  sql: PostgresSql,
  input: {
    creatorUserId: string;
    creatorSupabaseUserId: string;
    creatorHandle: string;
    contentId: string;
    mediaAssetId: string;
    accessRuleId: string;
  }
): Promise<void> {
  const recipientWalletId = randomUUID();
  await seedCanonicalIntegrationUser(sql, {
    userId: input.creatorUserId,
    supabaseUserId: input.creatorSupabaseUserId
  });
  await sql`
    insert into profiles (user_id, handle, display_name, bio, visibility)
    values (${input.creatorUserId}, ${input.creatorHandle}, 'Integration Creator', 'Paid test creator', 'public')
    on conflict (user_id) do update set
      handle = excluded.handle,
      display_name = excluded.display_name,
      bio = excluded.bio,
      visibility = excluded.visibility,
      updated_at = now()
  `;
  await sql`
    insert into wallets (id, user_id, provider, address, chain, is_primary)
    values (
      ${recipientWalletId},
      ${input.creatorUserId},
      'wallet_adapter',
      ${creatorSettlementWallet},
      'solana_devnet',
      true
    )
    on conflict (chain, address) do update set
      user_id = excluded.user_id,
      is_primary = true,
      updated_at = now()
  `;
  await sql`
    insert into verification_records (
      subject_type,
      subject_id,
      purpose,
      status,
      provider,
      provider_reference,
      method,
      threshold_age,
      result_over_threshold,
      assurance_level,
      verified_at,
      reusable,
      policy_version,
      terms_accepted_at
    )
    values
      (
        'user', ${input.creatorUserId}, 'age_access', 'valid', 'didit',
        ${`creator-age-${input.contentId}`}, 'gov_id_selfie', 18, true, 'high', now(), true,
        null, null
      ),
      (
        'user', ${input.creatorUserId}, 'creator_kyc', 'valid', 'didit',
        ${`creator-kyc-${input.contentId}`}, 'gov_id_selfie', 18, true, 'high', now(), true,
        null, null
      ),
      (
        'user', ${input.creatorUserId}, 'adult_publisher_eligibility', 'valid', 'didit',
        ${`creator-adult-${input.contentId}`}, 'gov_id_selfie', 18, true, 'high', now(), true,
        'adult-publisher-v1', now()
      )
  `;
  await sql`
    insert into creator_monetisation_settings (
      user_id,
      state,
      earning_state,
      kyc_state,
      tax_profile_state,
      earnings_recipient_wallet_id,
      earnings_terms_version,
      earnings_terms_accepted_at,
      support_enabled,
      content_unlocks_enabled,
      live_passes_enabled,
      paid_messages_enabled
    )
    values (
      ${input.creatorUserId},
      'active',
      'ready',
      'verified',
      'not_required',
      ${recipientWalletId},
      'wevid-creator-earnings-v1',
      now(),
      true,
      true,
      true,
      true
    )
  `;
  await sql`
    insert into content_items (
      id,
      creator_user_id,
      media_type,
      state,
      publish_state,
      published_at,
      caption,
      visibility,
      nsfw_label,
      moderation_state
    )
    values (
      ${input.contentId},
      ${input.creatorUserId},
      'image',
      'ready',
      'submitted_for_review',
      null,
      'Integration paid content',
      'public',
      'adult',
      'pending'
    )
  `;
  await sql`
    insert into media_assets (
      id,
      content_item_id,
      provider,
      provider_asset_id,
      provider_state,
      poster_url,
      playback_url,
      provider_playable,
      ready_at
    )
    values (
      ${input.mediaAssetId},
      ${input.contentId},
      'bunny',
      ${`integration-${input.contentId}`},
      'ready',
      'https://media.example.test/integration-poster.jpg',
      ${`https://video.example.test/${input.mediaAssetId}/playlist.m3u8`},
      true,
      now()
    )
  `;
  await approveSeededContent(sql, {
    contentId: input.contentId,
    creatorUserId: input.creatorUserId,
    rating: "adult",
    representationMode: "no_real_person"
  });
  await sql`
    insert into content_access_rules (
      id,
      content_item_id,
      access_type,
      product_type,
      price_minor,
      currency,
      state
    )
    values (
      ${input.accessRuleId},
      ${input.contentId},
      'locked',
      'content_unlock',
      25000000,
      'SOL',
      'active'
    )
  `;
}

async function seedCanonicalIntegrationUser(
  sql: PostgresSql,
  input: { userId: string; supabaseUserId: string }
): Promise<void> {
  await sql`
    insert into users (id, supabase_user_id)
    values (${input.userId}, ${input.supabaseUserId})
    on conflict (supabase_user_id) do update set state = 'active'
  `;
  await sql`
    insert into user_provider_identities (
      id,
      provider,
      provider_subject,
      user_id,
      status,
      linked_at,
      last_used_at
    )
    values (
      ${randomUUID()},
      'supabase',
      ${input.supabaseUserId},
      ${input.userId},
      'active',
      now(),
      now()
    )
    on conflict (provider, provider_subject) do update set
      user_id = excluded.user_id,
      status = 'active',
      last_used_at = now()
  `;
}

async function seedCreatorFreeVideo(
  sql: PostgresSql,
  input: {
    creatorUserId: string;
    contentId: string;
    mediaAssetId: string;
  }
): Promise<void> {
  await sql`
    insert into content_items (
      id,
      creator_user_id,
      media_type,
      state,
      publish_state,
      published_at,
      caption,
      visibility,
      nsfw_label,
      moderation_state
    )
    values (
      ${input.contentId},
      ${input.creatorUserId},
      'vod',
      'ready',
      'submitted_for_review',
      null,
      'Integration free video',
      'public',
      'none',
      'pending'
    )
  `;
  await sql`
    insert into media_assets (
      id,
      content_item_id,
      provider,
      provider_asset_id,
      provider_state,
      poster_url,
      playback_url,
      provider_playable,
      ready_at
    )
    values (
      ${input.mediaAssetId},
      ${input.contentId},
      'bunny',
      ${`integration-free-${input.contentId}`},
      'ready',
      'https://media.example.test/integration-free-poster.jpg',
      ${`https://video.example.test/${input.mediaAssetId}/playlist.m3u8`},
      true,
      now()
    )
  `;
  await approveSeededContent(sql, {
    contentId: input.contentId,
    creatorUserId: input.creatorUserId,
    rating: "none",
    representationMode: "not_declared"
  });
}

async function seedFeedVolumeFixtures(
  sql: PostgresSql,
  input: { creatorUserId: string; count: number; runId: string }
): Promise<string[]> {
  const ids: string[] = [];
  for (let index = 0; index < input.count; index += 1) {
    const contentId = randomUUID();
    const mediaAssetId = randomUUID();
    ids.push(contentId);
    await sql`
      insert into content_items (
        id,
        creator_user_id,
        media_type,
        state,
        publish_state,
        caption,
        visibility,
        nsfw_label,
        moderation_state,
        created_at
      ) values (
        ${contentId},
        ${input.creatorUserId},
        ${index % 2 === 0 ? "bit" : "clip"},
        'ready',
        'submitted_for_review',
        ${`Feed volume fixture ${input.runId} ${index}`},
        'public',
        'none',
        'pending',
        now() - interval '2 days' - (${index} * interval '1 second')
      )
    `;
    await sql`
      insert into media_assets (
        id,
        content_item_id,
        provider,
        provider_asset_id,
        provider_state,
        poster_url,
        playback_url,
        provider_playable,
        ready_at
      ) values (
        ${mediaAssetId},
        ${contentId},
        'bunny',
        ${`integration-feed-${input.runId}-${index}`},
        'ready',
        ${`https://media.example.test/feed-${index}.jpg`},
        ${`https://video.example.test/${mediaAssetId}/playlist.m3u8`},
        true,
        now()
      )
    `;
    await approveSeededContent(sql, {
      contentId,
      creatorUserId: input.creatorUserId,
      rating: "none",
      representationMode: "not_declared"
    });
  }
  return ids;
}

async function approveSeededContent(
  sql: PostgresSql,
  input: {
    contentId: string;
    creatorUserId: string;
    rating: "none" | "adult" | "explicit";
    representationMode: "not_declared" | "no_real_person" | "self_only";
  }
): Promise<void> {
  await sql`
    insert into content_safety_declarations (
      content_item_id,
      uploader_user_id,
      representation_mode,
      policy_version,
      state,
      accepted_at
    )
    values (
      ${input.contentId},
      ${input.creatorUserId},
      ${input.representationMode},
      'media-safety-v1',
      'active',
      ${input.representationMode === "not_declared" ? null : new Date()}
    )
  `;
  await sql`
    insert into media_safety_cases (
      content_item_id,
      declared_rating,
      state,
      decision_source,
      reason_code,
      policy_version,
      provider_release_allowed,
      decided_at
    )
    values (
      ${input.contentId},
      ${input.rating},
      'approved',
      'staff',
      'integration_fixture_approved',
      'media-safety-v1',
      true,
      now()
    )
  `;
  await sql`
    update content_items
    set
      moderation_state = 'approved',
      publish_state = 'published',
      published_at = now(),
      updated_at = now()
    where id = ${input.contentId}
  `;
}

async function seedCreatorPaidEvent(
  sql: PostgresSql,
  input: {
    creatorUserId: string;
    eventId: string;
    accessPassTypeId: string;
    freeAccessPassTypeId: string;
    remediationAccessPassTypeId: string;
    invalidAccessPassTypeId: string;
    idempotencyKey: string;
  }
): Promise<void> {
  await sql`
    insert into events (
      id,
      creator_user_id,
      title,
      description,
      starts_at,
      ends_at,
      event_type,
      location_type,
      location_label,
      access_rule,
      state,
      idempotency_key,
      request_hash
    )
    values (
      ${input.eventId},
      ${input.creatorUserId},
      'Integration Event Access',
      'Paid integration Event Access offer',
      '2026-07-01T20:00:00.000Z',
      '2026-07-01T22:00:00.000Z',
      'physical',
      'physical',
      'Belgrade studio',
      'public_sale',
      'published',
      ${input.idempotencyKey},
      'integration-event-access'
    )
  `;
  await sql`
    insert into event_access_pass_types (
      id,
      event_id,
      label,
      price_minor,
      currency,
      capacity,
      per_user_limit,
      state
    )
    values (
      ${input.accessPassTypeId},
      ${input.eventId},
      'General admission',
      15000000,
      'SOL',
      1,
      1,
      'active'
    )
  `;
  await sql`
    insert into event_access_pass_types (
      id,
      event_id,
      label,
      price_minor,
      currency,
      capacity,
      per_user_limit,
      state
    )
    values (
      ${input.freeAccessPassTypeId},
      ${input.eventId},
      'Free admission',
      0,
      'SOL',
      1,
      1,
      'active'
    )
  `;
  await sql`
    insert into event_access_pass_types (
      id, event_id, label, price_minor, currency, capacity, per_user_limit, state
    ) values (
      ${input.remediationAccessPassTypeId}, ${input.eventId}, 'Remediation admission',
      15000000, 'SOL', 1, 1, 'active'
    )
  `;
  await sql`
    insert into event_access_pass_types (
      id, event_id, label, price_minor, currency, capacity, per_user_limit, state
    ) values (
      ${input.invalidAccessPassTypeId}, ${input.eventId}, 'Invalid signature admission',
      15000000, 'SOL', 1, 1, 'active'
    )
  `;
}

async function seedDirectConversation(
  sql: PostgresSql,
  input: {
    conversationId: string;
    buyerSupabaseUserId: string;
    creatorSupabaseUserId: string;
    creatorUserId: string;
  }
): Promise<void> {
  const buyerRows = await sql<{ id: string }[]>`
    select id
    from users
    where supabase_user_id = ${input.buyerSupabaseUserId}
    limit 1
  `;
  const buyerUserId = buyerRows[0]?.id;

  if (!buyerUserId) {
    throw new Error("Integration buyer user was not created before conversation seed.");
  }

  await sql`
    insert into users (id, supabase_user_id)
    values (${input.creatorUserId}, ${input.creatorSupabaseUserId})
    on conflict (supabase_user_id) do update set state = 'active'
  `;
  await sql`
    insert into conversations (id, type, state)
    values (${input.conversationId}, 'direct', 'active')
  `;
  await sql`
    insert into conversation_members (conversation_id, user_id, role)
    values
      (${input.conversationId}, ${buyerUserId}, 'member'),
      (${input.conversationId}, ${input.creatorUserId}, 'creator')
  `;
}

async function seedCreatorLiveRoom(
  sql: PostgresSql,
  input: {
    creatorUserId: string;
    liveRoomId: string;
    shortRunId: string;
    idempotencyKey: string;
  }
): Promise<void> {
  await sql`
    insert into live_rooms (
      id,
      creator_user_id,
      title,
      provider_stream_id,
      provider_playback_id,
      provider_state,
      state,
      access_rule,
      preview_seconds,
      event_price_minor,
      currency,
      members_only_chat,
      members_included_in_paid_event,
      replay_window_hours,
      host_ingest_url,
      host_stream_key,
      playback_url,
      idempotency_key,
      request_hash
    )
    values (
      ${input.liveRoomId},
      ${input.creatorUserId},
      'Integration live room',
      ${`livepeer-stream-${input.shortRunId}`},
      ${`livepeer-playback-${input.shortRunId}`},
      'active',
      'live',
      'paid_event',
      60,
      50000000,
      'SOL',
      false,
      false,
      48,
      'rtmp://rtmp.livepeer.com/live/integration',
      'integration-stream-key',
      ${`https://livepeercdn.studio/hls/livepeer-playback-${input.shortRunId}/index.m3u8`},
      ${input.idempotencyKey},
      'integration-live-room'
    )
  `;
  await sql`
    insert into media_safety_cases (
      live_room_id,
      declared_rating,
      state,
      decision_source,
      reason_code,
      policy_version,
      provider_release_allowed,
      evidence_summary,
      decided_at
    )
    values (
      ${input.liveRoomId},
      'none',
      'approved',
      'automated',
      'creator_sfw_attestation',
      'sfw-live-v1',
      true,
      ${sql.json({ attestation: "this_live_stream_is_sfw" })},
      now()
    )
  `;
}

async function seedPlatformSubscriptionPlan(
  sql: PostgresSql,
  input: {
    planId: string;
  }
): Promise<void> {
  await sql`
    insert into subscription_plans (
      id,
      scope,
      label,
      amount_minor,
      currency,
      period_days,
      billing_mode,
      provider_state,
      token_mint,
      token_program,
      provider,
      program_id,
      plan_pda,
      onchain_plan_id,
      merchant_wallet,
      amount_atomic,
      period_seconds,
      platform_fee_amount_atomic,
      state
    )
    values (
      ${input.planId},
      'platform',
      'Integration Platform',
      19000000,
      'USDC',
      30,
      'delegated_solana_subscription',
      'launch_approved',
      ${subscriptionTokenMint},
      'spl_token',
      'official_solana_subscription_program',
      ${subscriptionProgramId},
      ${subscriptionPlanPda},
      ${input.planId},
      ${subscriptionMerchantWallet},
      19000000,
      2592000,
      19000000,
      'active'
    )
  `;
}

async function seedProviderReplayRequest(
  sql: PostgresSql,
  input: {
    providerEventId: string;
    replayRequestId: string;
    runId: string;
  }
): Promise<void> {
  await sql`
    insert into provider_events (
      id,
      provider,
      provider_event_id,
      event_type,
      normalized_state
    )
    values (
      ${input.providerEventId},
      'solana_indexer',
      ${`integration-provider-event-${input.runId}`},
      'payment.confirmed',
      'failed'
    )
  `;
  await sql`
    insert into provider_event_replay_requests (
      id,
      provider_event_id,
      idempotency_key,
      reason,
      state
    )
    values (
      ${input.replayRequestId},
      ${input.providerEventId},
      ${`provider-replay-${input.runId}`},
      'integration replay coverage',
      'queued'
    )
  `;
}

async function cleanupRun(
  sql: PostgresSql,
  input: {
    buyerHandle: string;
    creatorHandle: string;
    buyerSupabaseUserId: string;
    creatorSupabaseUserId: string;
    providerReference: string;
    seededContentId: string;
    seededFreeContentId: string;
    seededEventId: string;
    seededConversationId: string;
    seededLiveRoomId: string;
    seededSubscriptionPlanId: string;
    seededProviderEventId: string;
    seededProviderReplayRequestId: string;
    seededOrganizationId: string;
  }
): Promise<void> {
  await sql.begin(async (tx) => {
    const userRows = await tx<{ id: string }[]>`
      select id
      from users
      where supabase_user_id in (${input.buyerSupabaseUserId}, ${input.creatorSupabaseUserId})
    `;
    const userIds = userRows.map((row) => row.id);
    const ageRows = userIds.length
      ? await tx<{ id: string }[]>`
          select id
          from age_verifications
          where user_id in ${tx(userIds)}
            or provider_reference = ${input.providerReference}
        `
      : await tx<{ id: string }[]>`
          select id
          from age_verifications
          where provider_reference = ${input.providerReference}
        `;
    const verificationSessionRows = await tx<{ id: string }[]>`
      select id
      from verification_sessions
      where provider_session_id = ${input.providerReference}
        ${userIds.length > 0 ? tx`or subject_id in ${tx(userIds)}` : tx``}
    `;
    const verificationRecordRows = await tx<{ id: string }[]>`
      select id
      from verification_records
      where provider_reference = ${input.providerReference}
        ${userIds.length > 0 ? tx`or subject_id in ${tx(userIds)}` : tx``}
    `;
    const walletRows = userIds.length
      ? await tx<{ id: string }[]>`
          select id
          from wallets
          where user_id in ${tx(userIds)}
        `
      : [];
    const contentRows = userIds.length
      ? await tx<{ id: string }[]>`
          select id
          from content_items
          where creator_user_id in ${tx(userIds)}
             or id in (${input.seededContentId}, ${input.seededFreeContentId})
        `
      : await tx<{ id: string }[]>`
          select id
          from content_items
          where id in (${input.seededContentId}, ${input.seededFreeContentId})
        `;
    const contentIds = contentRows.map((row) => row.id);
    const eventRows = userIds.length
      ? await tx<{ id: string }[]>`
          select id
          from events
          where creator_user_id in ${tx(userIds)}
             or id = ${input.seededEventId}
        `
      : await tx<{ id: string }[]>`
          select id
          from events
          where id = ${input.seededEventId}
        `;
    const eventIds = eventRows.map((row) => row.id);
    const conversationRows = userIds.length
      ? await tx<{ id: string }[]>`
          select distinct c.id
          from conversations c
          left join conversation_members cm on cm.conversation_id = c.id
          where c.id = ${input.seededConversationId}
             or cm.user_id in ${tx(userIds)}
        `
      : await tx<{ id: string }[]>`
          select id
          from conversations
          where id = ${input.seededConversationId}
        `;
    const conversationIds = conversationRows.map((row) => row.id);
    const liveRoomRows = userIds.length
      ? await tx<{ id: string }[]>`
          select id
          from live_rooms
          where creator_user_id in ${tx(userIds)}
             or id = ${input.seededLiveRoomId}
        `
      : await tx<{ id: string }[]>`
          select id
          from live_rooms
          where id = ${input.seededLiveRoomId}
        `;
    const liveRoomIds = liveRoomRows.map((row) => row.id);
    const subscriptionRows = userIds.length
      ? await tx<{ id: string }[]>`
          select id
          from subscriptions
          where subscriber_user_id in ${tx(userIds)}
             or creator_user_id in ${tx(userIds)}
             or plan_id = ${input.seededSubscriptionPlanId}
        `
      : await tx<{ id: string }[]>`
          select id
          from subscriptions
          where plan_id = ${input.seededSubscriptionPlanId}
        `;
    const subscriptionIds = subscriptionRows.map((row) => row.id);
    const ageIds = ageRows.map((row) => row.id);
    const verificationSessionIds = verificationSessionRows.map((row) => row.id);
    const verificationRecordIds = verificationRecordRows.map((row) => row.id);
    const walletIds = walletRows.map((row) => row.id);
    const paymentIntentRows = userIds.length
      ? await tx<{ id: string }[]>`
          select id
          from payment_intents
          where user_id in ${tx(userIds)}
             or target_id in (${input.seededContentId}, ${input.seededEventId}, ${input.seededConversationId}, ${input.seededLiveRoomId})
        `
      : await tx<{ id: string }[]>`
          select id
          from payment_intents
          where target_id in (${input.seededContentId}, ${input.seededEventId}, ${input.seededConversationId}, ${input.seededLiveRoomId})
        `;
    const paymentIntentIds = paymentIntentRows.map((row) => row.id);

    await tx`
      delete from platform_playback_heartbeats
      where session_id in (
        select id
        from platform_playback_sessions
        where (target_type = 'content' and target_id in (${input.seededContentId}, ${input.seededFreeContentId}))
          ${userIds.length > 0 ? tx`or user_id in ${tx(userIds)}` : tx``}
      )
    `;
    await tx`
      delete from platform_playback_sessions
      where (target_type = 'content' and target_id in (${input.seededContentId}, ${input.seededFreeContentId}))
        ${userIds.length > 0 ? tx`or user_id in ${tx(userIds)}` : tx``}
    `;
    if (userIds.length > 0) {
      await tx`
        delete from platform_usage_windows
        where user_id in ${tx(userIds)}
      `;
      await tx`
        delete from viewer_content_impressions
        where user_id in ${tx(userIds)}
      `;
      await tx`
        delete from follow_action_receipts
        where actor_user_id in ${tx(userIds)}
           or target_user_id in ${tx(userIds)}
      `;
      await tx`
        delete from user_follows
        where follower_user_id in ${tx(userIds)}
           or followed_user_id in ${tx(userIds)}
      `;
    }
    await tx`
      delete from managed_creator_allocation_records
      where relationship_id in (
        select id from managed_creator_relationships where organization_id = ${input.seededOrganizationId}
      )
    `;
    await tx`
      delete from managed_creator_agreements
      where relationship_id in (
        select id from managed_creator_relationships where organization_id = ${input.seededOrganizationId}
      )
    `;
    await tx`
      delete from enterprise_action_receipts
      where organization_id = ${input.seededOrganizationId}
        or relationship_id in (
          select id from managed_creator_relationships where organization_id = ${input.seededOrganizationId}
        )
        or membership_id in (
          select id from organization_memberships where organization_id = ${input.seededOrganizationId}
        )
    `;
    await tx`
      delete from managed_creator_relationships
      where organization_id = ${input.seededOrganizationId}
    `;
    await tx`
      delete from organization_settlement_wallets
      where organization_id = ${input.seededOrganizationId}
    `;
    await tx`
      delete from verification_records
      where subject_type = 'organization' and subject_id = ${input.seededOrganizationId}
    `;
    await tx`
      delete from tier_waivers
      where subject_type = 'organization'
        and subject_id = ${input.seededOrganizationId}
    `;
    await tx`
      delete from organization_memberships
      where organization_id = ${input.seededOrganizationId}
    `;
    await tx`
      delete from organizations
      where id = ${input.seededOrganizationId}
    `;

    if (userIds.length > 0) {
      if (subscriptionIds.length > 0) {
        await tx`
          delete from subscription_events
          where subscription_id in ${tx(subscriptionIds)}
        `;
        await tx`
          delete from subscription_collections
          where subscription_id in ${tx(subscriptionIds)}
        `;
        await tx`
          delete from subscription_authorization_intents
          where subscription_id in ${tx(subscriptionIds)}
        `;
        await tx`
          delete from subscriptions
          where id in ${tx(subscriptionIds)}
        `;
      }
      if (paymentIntentIds.length > 0) {
        await tx`
          delete from payment_confirmation_deliveries
          where payment_intent_id in ${tx(paymentIntentIds)}
        `;
        await tx`
          delete from notifications
          where related_resource_type = 'receipt'
            and related_resource_id in (
              select id
              from receipts
              where payment_intent_id in ${tx(paymentIntentIds)}
            )
        `;
        await tx`
          delete from compliance_ledger_entries
          where payment_intent_id in ${tx(paymentIntentIds)}
        `;
        await tx`
          delete from receipt_lines
          where receipt_id in (
            select id
            from receipts
            where payment_intent_id in ${tx(paymentIntentIds)}
          )
        `;
        await tx`
          delete from receipts
          where payment_intent_id in ${tx(paymentIntentIds)}
        `;
        await tx`
          delete from refunds_and_disputes
          where payment_intent_id in ${tx(paymentIntentIds)}
        `;
        await tx`
          delete from event_access_passes
          where payment_intent_id in ${tx(paymentIntentIds)}
        `;
        await tx`
          delete from event_access_purchase_requests
          where payment_intent_id in ${tx(paymentIntentIds)}
        `;
        await tx`
          delete from paid_message_delivery_requests
          where payment_intent_id in ${tx(paymentIntentIds)}
        `;
        await tx`
          delete from live_passes
          where payment_intent_id in ${tx(paymentIntentIds)}
        `;
        await tx`
          delete from live_pass_purchase_requests
          where payment_intent_id in ${tx(paymentIntentIds)}
        `;
        await tx`
          delete from messages
          where payment_intent_id in ${tx(paymentIntentIds)}
        `;
        await tx`
          delete from wallet_transaction_records
          where payment_intent_id in ${tx(paymentIntentIds)}
        `;
        await tx`
          delete from entitlement_events
          where payment_intent_id in ${tx(paymentIntentIds)}
        `;
        await tx`
          delete from entitlements
          where payment_intent_id in ${tx(paymentIntentIds)}
        `;
      }
      await tx`
        delete from refunds_and_disputes
        where reporter_user_id in ${tx(userIds)}
      `;
      await tx`
        delete from wallet_transaction_records
        where user_id in ${tx(userIds)}
      `;
      await tx`
        delete from payment_confirmation_deliveries
        where user_id in ${tx(userIds)}
      `;
      await tx`
        delete from notifications
        where user_id in ${tx(userIds)}
      `;
      await tx`
        delete from notification_action_receipts
        where actor_user_id in ${tx(userIds)}
      `;
      await tx`
        delete from notification_devices
        where user_id in ${tx(userIds)}
      `;
      await tx`
        delete from notification_preferences
        where user_id in ${tx(userIds)}
      `;
      await tx`
        delete from compliance_ledger_entries
        where buyer_user_id in ${tx(userIds)}
           or seller_user_id in ${tx(userIds)}
      `;
      await tx`
        delete from receipt_lines
        where receipt_id in (
          select id
          from receipts
          where buyer_user_id in ${tx(userIds)}
             or seller_user_id in ${tx(userIds)}
        )
      `;
      await tx`
        delete from receipts
        where buyer_user_id in ${tx(userIds)}
           or seller_user_id in ${tx(userIds)}
      `;
      await tx`
        delete from entitlement_events
        where actor_user_id in ${tx(userIds)}
      `;
      await tx`
        delete from entitlements
        where user_id in ${tx(userIds)}
      `;
      await tx`
        delete from event_access_passes
        where holder_user_id in ${tx(userIds)}
      `;
      await tx`
        delete from event_access_purchase_requests
        where buyer_user_id in ${tx(userIds)}
      `;
      await tx`
        delete from event_access_requests
        where requester_user_id in ${tx(userIds)}
           or reviewed_by_user_id in ${tx(userIds)}
      `;
      await tx`
        delete from paid_message_delivery_requests
        where sender_user_id in ${tx(userIds)}
           or recipient_user_id in ${tx(userIds)}
      `;
      await tx`
        delete from messages
        where sender_user_id in ${tx(userIds)}
      `;
      await tx`
        delete from live_chat_messages
        where user_id in ${tx(userIds)}
      `;
      await tx`
        delete from live_passes
        where user_id in ${tx(userIds)}
      `;
      await tx`
        delete from live_pass_purchase_requests
        where buyer_user_id in ${tx(userIds)}
      `;
      await tx`
        delete from payment_settlement_attempts
        where payment_intent_id in (
          select id
          from payment_intents
          where user_id in ${tx(userIds)}
             or target_id in (${input.seededContentId}, ${input.seededEventId}, ${input.seededConversationId}, ${input.seededLiveRoomId})
        )
      `;
      await tx`
        delete from referral_attributions
        where payment_intent_id in (
          select id
          from payment_intents
          where user_id in ${tx(userIds)}
             or target_id in (${input.seededContentId}, ${input.seededEventId}, ${input.seededConversationId}, ${input.seededLiveRoomId})
        )
      `;
      await tx`
        delete from payment_intents
        where user_id in ${tx(userIds)}
           or target_id in (${input.seededContentId}, ${input.seededEventId}, ${input.seededConversationId}, ${input.seededLiveRoomId})
      `;
      await tx`
        delete from wallet_link_challenges
        where user_id in ${tx(userIds)}
      `;
      await tx`
        delete from creator_onboarding_action_receipts
        where actor_user_id in ${tx(userIds)}
      `;
      await tx`
        delete from creator_monetisation_settings
        where user_id in ${tx(userIds)}
      `;
      await tx`
        delete from recovery_link_intents
        where user_id in ${tx(userIds)}
      `;
      await tx`
        delete from app_sessions
        where user_id in ${tx(userIds)}
      `;
      await tx`
        delete from wallets
        where user_id in ${tx(userIds)}
      `;
      await tx`
        delete from blocks
        where blocker_user_id in ${tx(userIds)}
           or blocked_user_id in ${tx(userIds)}
      `;
      await tx`
        delete from audit_events
        where actor_user_id in ${tx(userIds)}
      `;
    }

    await tx`
      delete from provider_event_replay_requests
      where id = ${input.seededProviderReplayRequestId}
         or provider_event_id = ${input.seededProviderEventId}
    `;
    await tx`
      delete from provider_events
      where id = ${input.seededProviderEventId}
    `;

    if (subscriptionIds.length > 0) {
      await tx`
        delete from subscription_events
        where subscription_id in ${tx(subscriptionIds)}
      `;
      await tx`
        delete from subscription_collections
        where subscription_id in ${tx(subscriptionIds)}
      `;
      await tx`
        delete from subscription_authorization_intents
        where subscription_id in ${tx(subscriptionIds)}
      `;
      await tx`
        delete from subscriptions
        where id in ${tx(subscriptionIds)}
      `;
    }

    await tx`
      delete from subscription_plans
      where id = ${input.seededSubscriptionPlanId}
    `;

    if (eventIds.length > 0) {
      await tx`
        delete from event_access_passes
        where event_id in ${tx(eventIds)}
      `;
      await tx`
        delete from event_access_purchase_requests
        where event_id in ${tx(eventIds)}
      `;
      await tx`
        delete from event_access_requests
        where event_id in ${tx(eventIds)}
      `;
      await tx`
        delete from event_access_pass_types
        where event_id in ${tx(eventIds)}
      `;
      await tx`
        delete from audit_events
        where subject_id in ${tx(eventIds)}
      `;
      await tx`
        delete from events
        where id in ${tx(eventIds)}
      `;
    }

    if (conversationIds.length > 0) {
      await tx`
        delete from paid_message_delivery_requests
        where conversation_id in ${tx(conversationIds)}
      `;
      await tx`
        delete from messages
        where conversation_id in ${tx(conversationIds)}
      `;
      await tx`
        delete from conversation_members
        where conversation_id in ${tx(conversationIds)}
      `;
      await tx`
        delete from conversations
        where id in ${tx(conversationIds)}
      `;
    }

    if (liveRoomIds.length > 0) {
      const liveRoomEntitlementRows = await tx<{ id: string }[]>`
        select id
        from entitlements
        where target_type = 'live_room'
          and target_id in ${tx(liveRoomIds)}
      `;
      const liveRoomEntitlementIds = liveRoomEntitlementRows.map((row) => row.id);

      if (liveRoomEntitlementIds.length > 0) {
        await tx`
          delete from entitlement_events
          where entitlement_id in ${tx(liveRoomEntitlementIds)}
        `;
        await tx`
          delete from entitlements
          where id in ${tx(liveRoomEntitlementIds)}
        `;
      }
      await tx`
        delete from live_chat_messages
        where room_id in ${tx(liveRoomIds)}
      `;
      await tx`
        delete from live_passes
        where room_id in ${tx(liveRoomIds)}
      `;
      await tx`
        delete from live_pass_purchase_requests
        where room_id in ${tx(liveRoomIds)}
      `;
      await tx`
        delete from audit_events
        where subject_id in ${tx(liveRoomIds)}
      `;
      await tx`
        delete from live_rooms
        where id in ${tx(liveRoomIds)}
      `;
    }

    if (contentIds.length > 0) {
      const contentEntitlementRows = await tx<{ id: string }[]>`
        select id
        from entitlements
        where target_type = 'content'
          and target_id in ${tx(contentIds)}
      `;
      const contentEntitlementIds = contentEntitlementRows.map((row) => row.id);

      if (contentEntitlementIds.length > 0) {
        await tx`
          delete from entitlement_events
          where entitlement_id in ${tx(contentEntitlementIds)}
        `;
        await tx`
          delete from entitlements
          where id in ${tx(contentEntitlementIds)}
        `;
      }
      await tx`
        delete from viewer_content_impressions
        where content_item_id in ${tx(contentIds)}
      `;
      await tx`
        delete from engagement_action_receipts
        where target_id in ${tx(contentIds)}
      `;
      await tx`
        delete from content_reactions
        where content_item_id in ${tx(contentIds)}
      `;
      await tx`
        delete from content_saves
        where content_item_id in ${tx(contentIds)}
      `;
      await tx`
        delete from comments
        where content_item_id in ${tx(contentIds)}
      `;
      await tx`
        delete from share_records
        where target_type = 'content'
          and target_id in ${tx(contentIds)}
      `;
      await tx`
        delete from reports
        where subject_type = 'content'
          and subject_id in ${tx(contentIds)}
      `;
      await tx`
        delete from content_access_rules
        where content_item_id in ${tx(contentIds)}
      `;
      await tx`
        delete from content_hashtags
        where content_item_id in ${tx(contentIds)}
      `;
      await tx`
        delete from media_assets
        where content_item_id in ${tx(contentIds)}
      `;
      await tx`
        delete from audit_events
        where subject_id in ${tx(contentIds)}
      `;
      await tx`
        delete from content_engagement_counters
        where content_item_id in ${tx(contentIds)}
      `;
      await tx`
        delete from content_items
        where id in ${tx(contentIds)}
      `;
    }

    if (ageIds.length > 0) {
      await tx`
        delete from audit_events
        where subject_id in ${tx(ageIds)}
      `;
      await tx`
        delete from age_verifications
        where id in ${tx(ageIds)}
      `;
    }

    if (verificationSessionIds.length > 0 || verificationRecordIds.length > 0) {
      const verificationSubjectIds = [...verificationSessionIds, ...verificationRecordIds];
      await tx`
        delete from audit_events
        where subject_type = 'verification_record'
          and subject_id in ${tx(verificationSubjectIds)}
      `;
      await tx`
        delete from verification_events
        where idempotency_key = ${`sumsub-event-${input.providerReference.replace("sumsub-", "")}`}
          ${verificationSessionIds.length > 0 ? tx`or session_id in ${tx(verificationSessionIds)}` : tx``}
      `;
      if (verificationRecordIds.length > 0) {
        await tx`
          delete from verification_records
          where id in ${tx(verificationRecordIds)}
        `;
      }
      if (verificationSessionIds.length > 0) {
        await tx`
          delete from verification_sessions
          where id in ${tx(verificationSessionIds)}
        `;
      }
    }

    if (walletIds.length > 0) {
      await tx`
        delete from audit_events
        where subject_id in ${tx(walletIds)}
      `;
    }

    await tx`
      delete from provider_events
      where provider = 'sumsub'
        and provider_event_id = ${`sumsub-event-${input.providerReference.replace("sumsub-", "")}`}
    `;
    await tx`
      delete from provider_webhook_receipts
      where provider = 'sumsub'
        and webhook_type = 'age-verification'
        and idempotency_key = ${`sumsub-event-${input.providerReference.replace("sumsub-", "")}`}
    `;
    if (userIds.length > 0) {
      await tx`
        delete from performer_subjects
        where owner_user_id in ${tx(userIds)}
           or linked_user_id in ${tx(userIds)}
      `;
    }
    await tx`
      delete from profiles
      where handle in (${input.buyerHandle}, ${input.creatorHandle})
        ${userIds.length > 0 ? tx`or user_id in ${tx(userIds)}` : tx``}
    `;

    if (userIds.length > 0) {
      await tx`
        delete from support_cases
        where requester_user_id in ${tx(userIds)}
      `;
      await tx`
        delete from idempotency_keys
        where actor_user_id in ${tx(userIds)}
      `;
      await tx`
        delete from user_provider_identities
        where user_id in ${tx(userIds)}
      `;
      await tx`
        delete from user_social_counts
        where user_id in ${tx(userIds)}
      `;
      await tx`
        delete from users
        where id in ${tx(userIds)}
      `;
    }
  });
}
