import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  createPostgresWalletAuthRepository,
  WalletAuthAccountNotFoundError,
  WalletAuthChallengeInvalidError
} from "../src/modules/auth/wallet-auth-repository.js";
import { createPostgresClient } from "../src/shared/postgres.js";

const enabled = ["1", "true"].includes(process.env.VEEL_ENABLE_REAL_API_INTEGRATION_TESTS ?? "");
const describeIntegration = enabled ? describe : describe.skip;

describeIntegration("purpose-bound authentication against migrated Postgres", () => {
  it("keeps login lookup-only and makes onboarding duplicate-safe", async () => {
    const databaseUrl = process.env.API_INTEGRATION_DATABASE_URL ?? process.env.DATABASE_URL;
    const databaseHost = safeDatabaseHost(databaseUrl);
    if (!databaseUrl || !["127.0.0.1", "localhost"].includes(databaseHost ?? "")) {
      throw new Error("A loopback API_INTEGRATION_DATABASE_URL is required");
    }

    const sql = createPostgresClient(databaseUrl);
    const repository = createPostgresWalletAuthRepository(sql);
    const address = `auth-lifecycle-${randomUUID()}`;
    const challengeIds: string[] = [];
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
    let userId: string | null = null;

    try {
      const before = await identityCounts(sql);
      const loginChallenge = await repository.createChallenge({
        chain: "solana_devnet",
        provider: "phantom",
        purpose: "login",
        address,
        message: `Purpose: login\nNonce: ${randomUUID()}`,
        nonceHash: randomUUID(),
        expiresAt
      });
      challengeIds.push(loginChallenge.id);

      await expect(repository.createSessionFromChallenge({
        challengeId: loginChallenge.id,
        purpose: "login",
        expiresAt
      })).rejects.toBeInstanceOf(WalletAuthAccountNotFoundError);

      expect(await identityCounts(sql)).toEqual(before);
      const consumedLogin = await sql<{ consumed_at: Date | null }[]>`
        select consumed_at from wallet_auth_challenges where id = ${loginChallenge.id}
      `;
      expect(consumedLogin[0]?.consumed_at).toBeInstanceOf(Date);
      await expect(repository.createSessionFromChallenge({
        challengeId: loginChallenge.id,
        purpose: "login",
        expiresAt
      })).rejects.toBeInstanceOf(WalletAuthChallengeInvalidError);

      const onboardingChallenge = await repository.createChallenge({
        chain: "solana_devnet",
        provider: "phantom",
        purpose: "onboarding",
        address,
        message: `Purpose: onboarding\nNonce: ${randomUUID()}`,
        nonceHash: randomUUID(),
        expiresAt
      });
      challengeIds.push(onboardingChallenge.id);

      await expect(repository.createSessionFromChallenge({
        challengeId: onboardingChallenge.id,
        purpose: "login",
        expiresAt
      })).rejects.toBeInstanceOf(WalletAuthChallengeInvalidError);
      const unchangedChallenge = await sql<{ consumed_at: Date | null }[]>`
        select consumed_at from wallet_auth_challenges where id = ${onboardingChallenge.id}
      `;
      expect(unchangedChallenge[0]?.consumed_at).toBeNull();

      const onboardingSession = await repository.createSessionFromChallenge({
        challengeId: onboardingChallenge.id,
        purpose: "onboarding",
        expiresAt
      });
      const verified = await repository.verifySessionToken(onboardingSession.accessToken);
      expect(verified).not.toBeNull();
      userId = verified?.userId ?? null;

      const repeatedOnboarding = await repository.createChallenge({
        chain: "solana_devnet",
        provider: "phantom",
        purpose: "onboarding",
        address,
        message: `Purpose: onboarding\nNonce: ${randomUUID()}`,
        nonceHash: randomUUID(),
        expiresAt
      });
      challengeIds.push(repeatedOnboarding.id);
      await repository.createSessionFromChallenge({
        challengeId: repeatedOnboarding.id,
        purpose: "onboarding",
        expiresAt
      });

      const existingLogin = await repository.createChallenge({
        chain: "solana_devnet",
        provider: "phantom",
        purpose: "login",
        address,
        message: `Purpose: login\nNonce: ${randomUUID()}`,
        nonceHash: randomUUID(),
        expiresAt
      });
      challengeIds.push(existingLogin.id);
      await repository.createSessionFromChallenge({
        challengeId: existingLogin.id,
        purpose: "login",
        expiresAt
      });

      const scopedCounts = await sql<{ users: string; wallets: string; sessions: string }[]>`
        select
          count(distinct wallet.user_id)::text as users,
          count(distinct wallet.id)::text as wallets,
          count(distinct session.id)::text as sessions
        from wallets wallet
        left join app_sessions session on session.wallet_id = wallet.id
        where wallet.chain = 'solana_devnet'
          and wallet.address = ${address}
      `;
      expect(scopedCounts[0]).toEqual({ users: "1", wallets: "1", sessions: "3" });

      const audits = await sql<{ action: string; purpose: string }[]>`
        select action, metadata->>'purpose' as purpose
        from audit_events
        where subject_id = any(${challengeIds}::uuid[])
           or actor_user_id = ${userId}::uuid
        order by created_at asc
      `;
      expect(audits).toEqual(expect.arrayContaining([
        { action: "auth.wallet_account_not_found", purpose: "login" },
        { action: "auth.wallet_onboarding_completed", purpose: "onboarding" },
        { action: "auth.wallet_login_completed", purpose: "login" }
      ]));
    } finally {
      if (userId) {
        await sql`delete from audit_events where actor_user_id = ${userId} or subject_id = any(${challengeIds}::uuid[])`;
        await sql`delete from app_sessions where user_id = ${userId}`;
        await sql`delete from wallets where user_id = ${userId}`;
        await sql`delete from users where id = ${userId}`;
      } else if (challengeIds.length > 0) {
        await sql`delete from audit_events where subject_id = any(${challengeIds}::uuid[])`;
      }
      await sql`delete from wallet_auth_challenges where id = any(${challengeIds}::uuid[])`;
      await sql.end();
    }
  }, 30_000);
});

async function identityCounts(sql: ReturnType<typeof createPostgresClient>) {
  const rows = await sql<{ users: string; wallets: string; sessions: string }[]>`
    select
      (select count(*)::text from users) as users,
      (select count(*)::text from wallets) as wallets,
      (select count(*)::text from app_sessions) as sessions
  `;
  return rows[0];
}

function safeDatabaseHost(databaseUrl: string | undefined): string | null {
  if (!databaseUrl) return null;
  try {
    return new URL(databaseUrl).hostname;
  } catch {
    return null;
  }
}
