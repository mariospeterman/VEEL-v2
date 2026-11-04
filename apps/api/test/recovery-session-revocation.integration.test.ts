import { createHash, randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import {
  createPostgresWalletAuthRepository,
  WalletAuthChallengeInvalidError
} from "../src/modules/auth/wallet-auth-repository";
import { createPostgresClient, type PostgresSql } from "../src/shared/postgres";
import {
  assertIntegrationDatabaseIsAllowed,
  integrationDatabaseUrl
} from "./integration-database.js";

const enableRealApiIntegration =
  process.env.VEEL_ENABLE_REAL_API_INTEGRATION_TESTS === "1" ||
  process.env.VEEL_ENABLE_REAL_API_INTEGRATION_TESTS === "true";
const describeIntegration = enableRealApiIntegration ? describe : describe.skip;

interface RecoveryFixture {
  userId: string;
  providerSubject: string;
  providerSessionId: string;
  authenticatedAt: Date;
}

describeIntegration("Supabase recovery-session revocation boundary", () => {
  let sql: PostgresSql | null = null;
  const fixtures: RecoveryFixture[] = [];

  afterEach(async () => {
    if (!sql) return;
    const currentSql = sql;
    sql = null;
    try {
      for (const fixture of fixtures.reverse()) {
        await cleanupRecoveryFixture(currentSql, fixture);
      }
    } finally {
      fixtures.length = 0;
      await currentSql.end();
    }
  });

  it("stores the signed provider session and genuine authentication time", async () => {
    sql = connectToIntegrationDatabase();
    const fixture = await seedRecoveryFixture(sql);
    fixtures.push(fixture);
    const repository = createPostgresWalletAuthRepository(sql);

    const session = await repository.exchangeRecoveryIdentity({
      provider: "supabase",
      providerSubject: fixture.providerSubject,
      providerSessionId: fixture.providerSessionId,
      providerAuthenticatedAt: fixture.authenticatedAt,
      sessionExpiresAt: new Date(Date.now() + 10 * 60 * 1000)
    });

    const rows = await sql<
      Array<{
        authenticated_at: Date;
        authentication_method: string;
        provider_session_id: string | null;
      }>
    >`
      select authenticated_at, authentication_method, provider_session_id
      from app_sessions
      where token_hash = ${hashOpaqueSessionToken(session.accessToken)}
    `;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      authentication_method: "supabase_recovery",
      provider_session_id: fixture.providerSessionId
    });
    expect(rows[0]?.authenticated_at.getTime()).toBe(fixture.authenticatedAt.getTime());
  });

  it("rejects absent and subject-mismatched Supabase sessions without issuing an app session", async () => {
    sql = connectToIntegrationDatabase();
    const fixture = await seedRecoveryFixture(sql);
    const otherFixture = await seedRecoveryFixture(sql);
    fixtures.push(fixture, otherFixture);
    const repository = createPostgresWalletAuthRepository(sql);

    await expect(
      repository.exchangeRecoveryIdentity({
        provider: "supabase",
        providerSubject: fixture.providerSubject,
        providerSessionId: randomUUID(),
        providerAuthenticatedAt: fixture.authenticatedAt,
        sessionExpiresAt: new Date(Date.now() + 10 * 60 * 1000)
      })
    ).rejects.toBeInstanceOf(WalletAuthChallengeInvalidError);

    await expect(
      repository.exchangeRecoveryIdentity({
        provider: "supabase",
        providerSubject: fixture.providerSubject,
        providerSessionId: otherFixture.providerSessionId,
        providerAuthenticatedAt: fixture.authenticatedAt,
        sessionExpiresAt: new Date(Date.now() + 10 * 60 * 1000)
      })
    ).rejects.toBeInstanceOf(WalletAuthChallengeInvalidError);

    const activeSessions = await sql<{ count: string }[]>`
      select count(*)::text as count
      from app_sessions
      where user_id = ${fixture.userId}
        and revoked_at is null
    `;
    expect(activeSessions[0]?.count).toBe("0");
  });

  it("prevents a captured pre-logout recovery credential from recreating an app session", async () => {
    sql = connectToIntegrationDatabase();
    const fixture = await seedRecoveryFixture(sql);
    fixtures.push(fixture);
    const repository = createPostgresWalletAuthRepository(sql);
    const exchangeInput = {
      provider: "supabase" as const,
      providerSubject: fixture.providerSubject,
      providerSessionId: fixture.providerSessionId,
      providerAuthenticatedAt: fixture.authenticatedAt,
      sessionExpiresAt: new Date(Date.now() + 10 * 60 * 1000)
    };

    const issued = await repository.exchangeRecoveryIdentity(exchangeInput);
    expect(await repository.verifySessionToken(issued.accessToken)).not.toBeNull();

    expect(
      await repository.revokeAllSessions({
        userId: fixture.userId,
        actorUserId: fixture.userId,
        reason: "user_logout_all"
      })
    ).toBe(1);
    expect(await repository.verifySessionToken(issued.accessToken)).toBeNull();

    await expect(repository.exchangeRecoveryIdentity(exchangeInput)).rejects.toBeInstanceOf(
      WalletAuthChallengeInvalidError
    );

    const activeSessions = await sql<{ count: string }[]>`
      select count(*)::text as count
      from app_sessions
      where user_id = ${fixture.userId}
        and revoked_at is null
    `;
    expect(activeSessions[0]?.count).toBe("0");
  });

  it("rejects a previously valid exchange after the exact provider session is removed", async () => {
    sql = connectToIntegrationDatabase();
    const fixture = await seedRecoveryFixture(sql);
    fixtures.push(fixture);
    const repository = createPostgresWalletAuthRepository(sql);
    const exchangeInput = {
      provider: "supabase" as const,
      providerSubject: fixture.providerSubject,
      providerSessionId: fixture.providerSessionId,
      providerAuthenticatedAt: fixture.authenticatedAt,
      sessionExpiresAt: new Date(Date.now() + 10 * 60 * 1000)
    };

    await expect(repository.exchangeRecoveryIdentity(exchangeInput)).resolves.toMatchObject({
      authenticationMethod: "supabase_recovery"
    });
    await sql`delete from auth.sessions where id = ${fixture.providerSessionId}`;
    await expect(repository.exchangeRecoveryIdentity(exchangeInput)).rejects.toBeInstanceOf(
      WalletAuthChallengeInvalidError
    );
  });

  it("serializes recovery exchange against logout-all so no old session survives", async () => {
    sql = connectToIntegrationDatabase();
    const fixture = await seedRecoveryFixture(sql);
    fixtures.push(fixture);
    const repository = createPostgresWalletAuthRepository(sql);

    const [exchangeResult, revocationResult] = await Promise.allSettled([
      repository.exchangeRecoveryIdentity({
        provider: "supabase",
        providerSubject: fixture.providerSubject,
        providerSessionId: fixture.providerSessionId,
        providerAuthenticatedAt: fixture.authenticatedAt,
        sessionExpiresAt: new Date(Date.now() + 10 * 60 * 1000)
      }),
      repository.revokeAllSessions({
        userId: fixture.userId,
        actorUserId: fixture.userId,
        reason: "user_logout_all"
      })
    ]);

    expect(revocationResult.status).toBe("fulfilled");
    if (exchangeResult.status === "rejected") {
      expect(exchangeResult.reason).toBeInstanceOf(WalletAuthChallengeInvalidError);
    }

    const activeSessions = await sql<{ count: string }[]>`
      select count(*)::text as count
      from app_sessions
      where user_id = ${fixture.userId}
        and revoked_at is null
    `;
    expect(activeSessions[0]?.count).toBe("0");
  });
});

function connectToIntegrationDatabase(): PostgresSql {
  const databaseUrl = integrationDatabaseUrl();
  assertIntegrationDatabaseIsAllowed(databaseUrl);
  return createPostgresClient(databaseUrl);
}

async function seedRecoveryFixture(sql: PostgresSql): Promise<RecoveryFixture> {
  const userId = randomUUID();
  const providerSubject = randomUUID();
  const providerSessionId = randomUUID();
  const authenticatedAt = new Date(Date.now() - 60_000);
  const cutoff = new Date(authenticatedAt.getTime() - 60_000);

  return sql.begin(async (transaction) => {
    await transaction`
      insert into auth.users (
        id, aud, role, raw_app_meta_data, raw_user_meta_data, created_at, updated_at
      )
      values (
        ${providerSubject}, 'authenticated', 'authenticated', '{}'::jsonb, '{}'::jsonb, now(), now()
      )
    `;
    await transaction`
      insert into auth.sessions (id, user_id, created_at, updated_at)
      values (${providerSessionId}, ${providerSubject}, now(), now())
    `;
    await transaction`
      insert into users (id, supabase_user_id, recovery_authentication_valid_after)
      values (${userId}, ${userId}, ${cutoff})
    `;
    await transaction`
      insert into user_provider_identities (
        id, provider, provider_subject, user_id, status, linked_at, last_used_at
      )
      values (
        ${randomUUID()}, 'supabase', ${providerSubject}, ${userId}, 'active', now(), now()
      )
    `;

    return { userId, providerSubject, providerSessionId, authenticatedAt };
  });
}

async function cleanupRecoveryFixture(sql: PostgresSql, fixture: RecoveryFixture): Promise<void> {
  await sql`delete from audit_events where actor_user_id = ${fixture.userId}`;
  await sql`delete from recovery_link_intents where user_id = ${fixture.userId}`;
  await sql`delete from app_sessions where user_id = ${fixture.userId}`;
  await sql`delete from user_provider_identities where user_id = ${fixture.userId}`;
  await sql`delete from users where id = ${fixture.userId}`;
  await sql`delete from auth.sessions where id = ${fixture.providerSessionId}`;
  await sql`delete from auth.users where id = ${fixture.providerSubject}`;
}

function hashOpaqueSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
