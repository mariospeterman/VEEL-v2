import { createHmac, randomUUID } from "node:crypto";
import { TextEncoder } from "node:util";
import bs58 from "bs58";
import nacl from "tweetnacl";
import { describe, expect, it, vi } from "vitest";
import { buildApi } from "../src/app";
import type { AgeProviderWaterfall } from "../src/modules/age/types";
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

describeIntegration("authenticated API happy path against Postgres", () => {
  it("links wallet, verifies age, creates content, and opens a content unlock intent", async () => {
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
    const providerReference = `sumsub-${runId}`;
    const ageProviderWaterfall = createIntegrationAgeWaterfall(providerReference);

    vi.stubEnv("DATABASE_URL", databaseUrl);
    vi.stubEnv("SUMSUB_WEBHOOK_SECRET", sumsubWebhookSecret);
    vi.stubEnv("PAYMENT_PLATFORM_TREASURY_WALLET", treasuryWallet);

    const app = await buildApi({
      authVerifier: integrationAuthVerifier,
      ageProviderWaterfall,
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
        seededContentId
      });
      await seedCreatorPaidContent(sql, {
        creatorUserId: seededCreatorUserId,
        creatorSupabaseUserId,
        creatorHandle,
        contentId: seededContentId,
        mediaAssetId: seededMediaAssetId,
        accessRuleId: seededAccessRuleId
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

      const persistedRows = await sql<{ wallet_count: string; payment_intent_count: string }[]>`
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
          ) as payment_intent_count
      `;

      expect(persistedRows[0]).toEqual({
        wallet_count: "1",
        payment_intent_count: "1"
      });
    } finally {
      await cleanupRun(sql, {
        buyerHandle,
        creatorHandle,
        buyerSupabaseUserId,
        creatorSupabaseUserId,
        providerReference,
        seededContentId
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

async function cleanupRun(
  sql: PostgresSql,
  input: {
    buyerHandle: string;
    creatorHandle: string;
    buyerSupabaseUserId: string;
    creatorSupabaseUserId: string;
    providerReference: string;
    seededContentId: string;
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
    const ageIds = ageRows.map((row) => row.id);
    const walletIds = walletRows.map((row) => row.id);

    if (userIds.length > 0) {
      await tx`
        delete from payment_settlement_attempts
        where payment_intent_id in (
          select id
          from payment_intents
          where user_id in ${tx(userIds)}
             or target_id = ${input.seededContentId}
        )
      `;
      await tx`
        delete from referral_attributions
        where payment_intent_id in (
          select id
          from payment_intents
          where user_id in ${tx(userIds)}
             or target_id = ${input.seededContentId}
        )
      `;
      await tx`
        delete from payment_intents
        where user_id in ${tx(userIds)}
           or target_id = ${input.seededContentId}
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

    if (contentIds.length > 0) {
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
