import { createHmac, randomUUID } from "node:crypto";
import { TextEncoder } from "node:util";
import bs58 from "bs58";
import nacl from "tweetnacl";
import { describe, expect, it, vi } from "vitest";
import { buildApi } from "../src/app";
import type { AgeProviderWaterfall } from "../src/modules/age/types";
import type {
  PaymentSettlementInput,
  PaymentSettlementVerifier
} from "../src/modules/payment/types";
import type {
  SupabaseAuthVerifier,
  VerifiedSupabaseSession
} from "../src/modules/session/types";
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
const sumsubWebhookSecret = "sumsub-integration-webhook-secret";
const treasuryWallet = "1".repeat(32);
const subscriptionCollectorWallet = "1".repeat(32);
const subscriptionTokenMint = "3".repeat(32);
const subscriptionAuthorityAddress = "4".repeat(32);
const subscriptionDelegationAddress = "5".repeat(32);
const subscriptionTokenAccount = "6".repeat(32);
const validSolanaSignature =
  "5Pj5fCupXLUePYn18JkY8SrRaWFiUctuDTRwvUy2MLgVFG1FsCeezrWwZsmxkL5YJQFmQpAcY7rc5pN6vrXJt7Qp";
const validEventAccessSolanaSignature = deterministicBase58Signature(41);
const validPaidMessageSolanaSignature = deterministicBase58Signature(83);
const validLivePassSolanaSignature = deterministicBase58Signature(127);
const validSubscriptionAuthorizationSignature = deterministicBase58Signature(149);

describeIntegration("authenticated API happy path against Postgres", () => {
  it("links wallet, verifies age, creates content, unlocks content, buys Event Access, sends a paid message, buys a live pass, and verifies subscriptions", async () => {
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
    const seededEventId = randomUUID();
    const seededAccessPassTypeId = randomUUID();
    const seededConversationId = randomUUID();
    const seededLiveRoomId = randomUUID();
    const seededSubscriptionPlanId = `integration-platform-${shortRunId}`;
    const seededProviderEventId = randomUUID();
    const seededProviderReplayRequestId = randomUUID();
    const providerReference = `sumsub-${runId}`;
    const ageProviderWaterfall = createIntegrationAgeWaterfall(providerReference);
    const settlementInputs: PaymentSettlementInput[] = [];
    const settlementVerifier: PaymentSettlementVerifier = {
      async verifyNativeSolTransfer(input) {
        settlementInputs.push(input);

        return {
          confirmed: true
        };
      }
    };

    vi.stubEnv("DATABASE_URL", databaseUrl);
    vi.stubEnv("SUMSUB_WEBHOOK_SECRET", sumsubWebhookSecret);
    vi.stubEnv("PAYMENT_PLATFORM_TREASURY_WALLET", treasuryWallet);
    vi.stubEnv("SOLANA_SUBSCRIPTION_COLLECTOR_WALLET", subscriptionCollectorWallet);

    const subscriptionVerificationInputs: Parameters<
      SubscriptionAuthorizationVerifier["verifyAuthorization"]
    >[0][] = [];
    const subscriptionAuthorizationVerifier: SubscriptionAuthorizationVerifier = {
      async verifyAuthorization(input) {
        subscriptionVerificationInputs.push(input);

        return {
          verified: true
        };
      }
    };

    const app = await buildApi({
      authVerifier: integrationAuthVerifier,
      ageProviderWaterfall,
      settlementVerifier,
      subscriptionAuthorizationVerifier,
      liveProvider: {
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
            supabaseUserId: buyerSupabaseUserId
          });
          return `integration-live-jwt-${shortRunId}`;
        }
      },
      postgresClient: sql
    });

    try {
      await app.ready();
      await cleanupRun(sql, {
        buyerHandle,
        creatorHandle,
        buyerSupabaseUserId,
        creatorSupabaseUserId,
        providerReference,
        seededContentId,
        seededEventId,
        seededConversationId,
        seededLiveRoomId,
        seededSubscriptionPlanId,
        seededProviderEventId,
        seededProviderReplayRequestId
      });
      await seedCreatorPaidContent(sql, {
        creatorUserId: seededCreatorUserId,
        creatorSupabaseUserId,
        creatorHandle,
        contentId: seededContentId,
        mediaAssetId: seededMediaAssetId,
        accessRuleId: seededAccessRuleId
      });
      await seedCreatorPaidEvent(sql, {
        creatorUserId: seededCreatorUserId,
        eventId: seededEventId,
        accessPassTypeId: seededAccessPassTypeId,
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
        createdAt: "2026-06-12 12:00:00+0000"
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
      await seedDirectConversation(sql, {
        conversationId: seededConversationId,
        buyerSupabaseUserId,
        creatorSupabaseUserId,
        creatorUserId: seededCreatorUserId
      });

      const createContentResponse = await app.inject({
        method: "POST",
        url: "/v1/content",
        headers: authenticatedHeaders(`content-create-${runId}`),
        payload: {
          mediaType: "image",
          visibility: "public",
          nsfwLabel: "adult",
          caption: `Integration draft ${runId}`
        }
      });

      expect(createContentResponse.statusCode, createContentResponse.body).toBe(201);
      expect(createContentResponse.json()).toMatchObject({
        mediaType: "image",
        accessState: "free",
        caption: `Integration draft ${runId}`
      });

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
      expect(settlementInputs).toHaveLength(1);
      expect(settlementInputs[0]).toEqual(
        expect.objectContaining({
          signature: validSolanaSignature,
          treasuryWallet,
          amountMinor: unlock.paymentIntent.amountMinor
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
      expect(
        `${refundRequestResponse.body}${repeatedRefundRequestResponse.body}${conflictingRefundRequestResponse.body}`
      ).not.toMatch(/automaticRefund|platformBalance|creatorBalance|withdraw|payoutQueue|escrow|privateKey|serviceRole/i);

      const accessPassIntentResponse = await app.inject({
        method: "POST",
        url: `/v1/events/${seededEventId}/access-passes/intents`,
        headers: authenticatedHeaders(`event-access-pass-${runId}`),
        payload: {
          accessPassTypeId: seededAccessPassTypeId
        }
      });

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
          amountMinor: accessPassIntent.paymentIntent.amountMinor
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
          amountMinor: paidMessageIntent.paymentIntent.amountMinor
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

      const lockedLiveRoomResponse = await app.inject({
        method: "GET",
        url: `/v1/live/rooms/${seededLiveRoomId}`,
        headers: authenticatedHeaders(`live-room-before-pass-${runId}`)
      });

      expect(lockedLiveRoomResponse.statusCode, lockedLiveRoomResponse.body).toBe(200);
      expect(lockedLiveRoomResponse.json()).toMatchObject({
        id: seededLiveRoomId,
        state: "live",
        accessState: "pass_required",
        playback: {
          state: "blocked",
          url: null,
          provider: "livepeer"
        },
        chat: {
          enabled: true,
          accessState: "pass_required"
        }
      });

      const livePassIntentResponse = await app.inject({
        method: "POST",
        url: `/v1/live/rooms/${seededLiveRoomId}/pass-intents`,
        headers: authenticatedHeaders(`live-pass-${runId}`),
        payload: {
          durationMinutes: 60
        }
      });

      expect(livePassIntentResponse.statusCode, livePassIntentResponse.body).toBe(201);
      expect(livePassIntentResponse.json()).toMatchObject({
        productType: "live_pass",
        targetId: seededLiveRoomId,
        amountMinor: 50000000,
        currency: "SOL",
        state: "pending"
      });
      const livePassIntent = livePassIntentResponse.json<{
        id: string;
        amountMinor: number;
      }>();

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
      expect(settlementInputs).toHaveLength(4);
      expect(settlementInputs[3]).toEqual(
        expect.objectContaining({
          signature: validLivePassSolanaSignature,
          treasuryWallet,
          amountMinor: livePassIntent.amountMinor
        })
      );
      expect(settlementInputs[3]?.referenceAddress).toMatch(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/);

      const activeLiveRoomResponse = await app.inject({
        method: "GET",
        url: `/v1/live/rooms/${seededLiveRoomId}`,
        headers: authenticatedHeaders(`live-room-after-pass-${runId}`)
      });

      expect(activeLiveRoomResponse.statusCode, activeLiveRoomResponse.body).toBe(200);
      expect(activeLiveRoomResponse.json()).toMatchObject({
        id: seededLiveRoomId,
        state: "live",
        accessState: "pass_active",
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
      expect(activeLiveRoomResponse.json().playback.url).toContain(
        `jwt=integration-live-jwt-${shortRunId}`
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
              and lppr.duration_minutes = 60
          ) as purchase_request_count,
          (
            select count(*)
            from live_passes lp
            join users u on u.id = lp.user_id
            where u.supabase_user_id = ${buyerSupabaseUserId}
              and lp.payment_intent_id = ${livePassIntent.id}
              and lp.room_id = ${seededLiveRoomId}
              and lp.duration_minutes = 60
              and lp.state = 'active'
              and lp.starts_at <= now()
              and lp.expires_at > now()
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
              and e.ends_at > now()
          ) as entitlement_count,
          (
            select count(*)
            from audit_events ae
            join users u on u.id = ae.actor_user_id
            where u.supabase_user_id = ${buyerSupabaseUserId}
              and ae.subject_id = ${seededLiveRoomId}
              and ae.action = 'live_pass_entitlement_granted'
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

      const subscriptionAuthorizationResponse = await app.inject({
        method: "POST",
        url: `/v1/subscriptions/authorizations/${subscriptionIntent.id}/submissions`,
        headers: authenticatedHeaders(`subscription-authorization-${runId}`),
        payload: {
          signature: validSubscriptionAuthorizationSignature,
          authorityAddress: subscriptionAuthorityAddress,
          delegationAddress: subscriptionDelegationAddress,
          subscriberTokenAccount: subscriptionTokenAccount
        }
      });

      expect(subscriptionAuthorizationResponse.statusCode, subscriptionAuthorizationResponse.body).toBe(202);
      expect(subscriptionAuthorizationResponse.json()).toMatchObject({
        id: subscriptionIntent.subscription.id,
        scope: "platform",
        planId: seededSubscriptionPlanId,
        state: "active",
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
            async collect(input) {
              expect(input).toEqual(
                expect.objectContaining({
                  subscriptionId: subscriptionIntent.subscription.id,
                  planId: seededSubscriptionPlanId,
                  amountMinor: 19000000,
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
        submitted_event_count: "1",
        confirmed_event_count: "1",
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
                providerEventId: seededProviderEventId,
                provider: "solana_indexer",
                eventType: "payment.confirmed"
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
    } finally {
      await cleanupRun(sql, {
        buyerHandle,
        creatorHandle,
        buyerSupabaseUserId,
        creatorSupabaseUserId,
        providerReference,
        seededContentId,
        seededEventId,
        seededConversationId,
        seededLiveRoomId,
        seededSubscriptionPlanId,
        seededProviderEventId,
        seededProviderReplayRequestId
      });
      await app.close();
      vi.unstubAllEnvs();
    }
  }, 75_000);
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

const integrationAuthVerifier: SupabaseAuthVerifier = {
  async verifyBearerToken(token: string): Promise<VerifiedSupabaseSession | null> {
    if (token !== authToken) {
      return null;
    }

    return {
      supabaseUserId: buyerSupabaseUserId,
      email: "integration-buyer@example.test",
      role: "authenticated"
    };
  }
};

function createIntegrationAgeWaterfall(providerReference: string): AgeProviderWaterfall {
  return {
    async createSession() {
      return {
        provider: "sumsub",
        providerReference,
        launchUrl: `https://age.example.test/sumsub/${providerReference}`,
        expiresAt: new Date("2026-06-12T12:15:00.000Z"),
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
  await sql`
    insert into users (id, supabase_user_id)
    values (${input.creatorUserId}, ${input.creatorSupabaseUserId})
    on conflict (supabase_user_id) do update set state = 'active'
  `;
  await sql`
    insert into profiles (user_id, handle, display_name, bio)
    values (${input.creatorUserId}, ${input.creatorHandle}, 'Integration Creator', 'Paid test creator')
    on conflict (user_id) do update set
      handle = excluded.handle,
      display_name = excluded.display_name,
      bio = excluded.bio,
      updated_at = now()
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
      'published',
      now(),
      'Integration paid content',
      'public',
      'adult',
      'approved'
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

async function seedCreatorPaidEvent(
  sql: PostgresSql,
  input: {
    creatorUserId: string;
    eventId: string;
    accessPassTypeId: string;
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
      10,
      1,
      'active'
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
      teaser_seconds,
      pass_price_minor,
      currency,
      pass_durations_minutes,
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
      'pass_required',
      60,
      50000000,
      'SOL',
      array[30, 60, 180],
      'rtmp://rtmp.livepeer.com/live/integration',
      'integration-stream-key',
      ${`https://livepeercdn.studio/hls/livepeer-playback-${input.shortRunId}/index.m3u8`},
      ${input.idempotencyKey},
      'integration-live-room'
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
      'staging_required',
      ${subscriptionTokenMint},
      'spl_token',
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
    seededEventId: string;
    seededConversationId: string;
    seededLiveRoomId: string;
    seededSubscriptionPlanId: string;
    seededProviderEventId: string;
    seededProviderReplayRequestId: string;
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
             or id = ${input.seededContentId}
        `
      : await tx<{ id: string }[]>`
          select id
          from content_items
          where id = ${input.seededContentId}
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
    const conversationRows = await tx<{ id: string }[]>`
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
        delete from wallets
        where user_id in ${tx(userIds)}
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
    await tx`
      delete from profiles
      where handle in (${input.buyerHandle}, ${input.creatorHandle})
    `;

    if (userIds.length > 0) {
      await tx`
        delete from users
        where id in ${tx(userIds)}
      `;
    }
  });
}
