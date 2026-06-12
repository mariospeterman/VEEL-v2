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
import { createPostgresClient, type PostgresSql } from "../src/shared/postgres";

const enableRealApiIntegration =
  process.env.VEEL_ENABLE_REAL_API_INTEGRATION_TESTS === "1" ||
  process.env.VEEL_ENABLE_REAL_API_INTEGRATION_TESTS === "true";
const describeIntegration = enableRealApiIntegration ? describe : describe.skip;
const buyerSupabaseUserId = "10000000-0000-4000-8000-000000000001";
const creatorSupabaseUserId = "10000000-0000-4000-8000-000000000002";
const authToken = "integration-buyer-token";
const sumsubWebhookSecret = "sumsub-integration-webhook-secret";
const treasuryWallet = "1".repeat(32);
const validSolanaSignature =
  "5Pj5fCupXLUePYn18JkY8SrRaWFiUctuDTRwvUy2MLgVFG1FsCeezrWwZsmxkL5YJQFmQpAcY7rc5pN6vrXJt7Qp";
const validEventAccessSolanaSignature = deterministicBase58Signature(41);

describeIntegration("authenticated API happy path against Postgres", () => {
  it("links wallet, verifies age, creates content, unlocks content, and buys Event Access", async () => {
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

    const app = await buildApi({
      authVerifier: integrationAuthVerifier,
      ageProviderWaterfall,
      settlementVerifier,
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
        seededEventId
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
          ) as entitlement_event_count
      `;

      expect(persistedRows[0]).toEqual({
        wallet_count: "1",
        payment_intent_count: "1",
        wallet_transaction_count: "1",
        settlement_attempt_count: "1",
        entitlement_count: "1",
        entitlement_event_count: "1"
      });

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
    } finally {
      await cleanupRun(sql, {
        buyerHandle,
        creatorHandle,
        buyerSupabaseUserId,
        creatorSupabaseUserId,
        providerReference,
        seededContentId,
        seededEventId
      });
      await app.close();
      vi.unstubAllEnvs();
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
    const ageIds = ageRows.map((row) => row.id);
    const walletIds = walletRows.map((row) => row.id);
    const paymentIntentRows = userIds.length
      ? await tx<{ id: string }[]>`
          select id
          from payment_intents
          where user_id in ${tx(userIds)}
             or target_id in (${input.seededContentId}, ${input.seededEventId})
        `
      : await tx<{ id: string }[]>`
          select id
          from payment_intents
          where target_id in (${input.seededContentId}, ${input.seededEventId})
        `;
    const paymentIntentIds = paymentIntentRows.map((row) => row.id);

    if (userIds.length > 0) {
      if (paymentIntentIds.length > 0) {
        await tx`
          delete from event_access_passes
          where payment_intent_id in ${tx(paymentIntentIds)}
        `;
        await tx`
          delete from event_access_purchase_requests
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
        delete from wallet_transaction_records
        where user_id in ${tx(userIds)}
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
        delete from payment_settlement_attempts
        where payment_intent_id in (
          select id
          from payment_intents
          where user_id in ${tx(userIds)}
             or target_id in (${input.seededContentId}, ${input.seededEventId})
        )
      `;
      await tx`
        delete from referral_attributions
        where payment_intent_id in (
          select id
          from payment_intents
          where user_id in ${tx(userIds)}
             or target_id in (${input.seededContentId}, ${input.seededEventId})
        )
      `;
      await tx`
        delete from payment_intents
        where user_id in ${tx(userIds)}
           or target_id in (${input.seededContentId}, ${input.seededEventId})
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
