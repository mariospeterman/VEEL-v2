import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { countOpenReports } from "../src/modules/admin/admin-report-authority.js";
import { createEventOpsRepository } from "../src/modules/admin/admin-repository-event-ops.js";
import { createFeatureFlagRepository } from "../src/modules/admin/admin-repository-feature-flag.js";
import { featureFlagEnabled } from "../src/modules/admin/admin-route-auth.js";
import { createPostgresClient, type PostgresSql } from "../src/shared/postgres.js";
import { guardedIntegrationDatabaseUrl } from "./integration-database.js";

const enabled = ["1", "true"].includes(process.env.VEEL_ENABLE_REAL_API_INTEGRATION_TESTS ?? "");
const describeIntegration = enabled ? describe : describe.skip;

describeIntegration("admin authority projections against migrated Postgres", () => {
  it("uses one canonical open-report definition in overview and Mutuals safety", async () => {
    const sql = createPostgresClient(guardedIntegrationDatabaseUrl());
    const reporterUserId = randomUUID();
    const reports = ["submitted", "queued", "reviewing", "escalated", "resolved"].map(
      (state, index) => ({
        id: randomUUID(),
        reporter_user_id: reporterUserId,
        subject_type: "content",
        subject_id: randomUUID(),
        reason: `Admin report authority ${state}`,
        queue: "content",
        state,
        idempotency_key: `admin-report-authority-${index}-${reporterUserId}`
      })
    );

    try {
      await sql.begin("isolation level repeatable read", async (transaction) => {
        const database = transaction as unknown as PostgresSql;
        const repository = createEventOpsRepository(database);
        const before = await countOpenReports(database);

        await transaction`
          insert into users (id, supabase_user_id, state)
          values (${reporterUserId}::uuid, ${reporterUserId}::uuid, 'active')
        `;
        await transaction`
          insert into reports ${transaction(
            reports,
            "id",
            "reporter_user_id",
            "subject_type",
            "subject_id",
            "reason",
            "queue",
            "state",
            "idempotency_key"
          )}
        `;

        expect(await countOpenReports(database)).toBe(before + 4);
        await expect(repository.getMutualsSafety()).resolves.toMatchObject({
          openReports: before + 4
        });

        await transaction`delete from reports where reporter_user_id = ${reporterUserId}::uuid`;
        await transaction`delete from users where id = ${reporterUserId}::uuid`;
      });
    } finally {
      await sql.end({ timeout: 5 });
    }
  });

  it("paginates every feature flag while policy checks use an exact key lookup", async () => {
    const sql = createPostgresClient(guardedIntegrationDatabaseUrl());
    const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
    const flags = Array.from({ length: 51 }, (_, index) => ({
      key: `test.admin_authority_${suffix}.${index.toString().padStart(3, "0")}`,
      value: { enabled: index === 50 },
      category: "admin_policy",
      policy_boundary: "software_policy_only_no_payment_access_or_social_priority",
      state: "active",
      updated_at: new Date("9999-12-30T12:00:00.000Z")
    }));
    const targetKey = flags[50]!.key;

    try {
      await sql.begin("isolation level repeatable read", async (transaction) => {
        const database = transaction as unknown as PostgresSql;
        const repository = createFeatureFlagRepository(database);
        await transaction`
          insert into feature_flags ${transaction(
            flags,
            "key",
            "value",
            "category",
            "policy_boundary",
            "state",
            "updated_at"
          )}
        `;

        const firstPage = await repository.listFeatureFlags({});
        expect(firstPage.items).toHaveLength(50);
        expect(firstPage.nextCursor).not.toBeNull();
        expect(firstPage.items.some((flag) => flag.key === targetKey)).toBe(false);

        const collected = [...firstPage.items];
        let cursor = firstPage.nextCursor ?? undefined;
        while (cursor) {
          const page = await repository.listFeatureFlags({ cursor });
          collected.push(...page.items);
          cursor = page.nextCursor ?? undefined;
        }

        const fixtureItems = collected.filter((flag) => flag.key.startsWith(
          `test.admin_authority_${suffix}.`
        ));
        expect(fixtureItems).toHaveLength(51);
        expect(new Set(fixtureItems.map((flag) => flag.key))).toHaveLength(51);
        await expect(repository.getFeatureFlag(targetKey)).resolves.toMatchObject({
          key: targetKey,
          value: { enabled: true }
        });
        await expect(featureFlagEnabled(repository, targetKey)).resolves.toBe(true);

        await transaction`
          delete from feature_flags
          where key like ${`test.admin_authority_${suffix}.%`}
        `;
      });
    } finally {
      await sql.end({ timeout: 5 });
    }
  });

  it("reads canonical verification records and unifies current assistant and MCP audit rows", async () => {
    const sql = createPostgresClient(guardedIntegrationDatabaseUrl());
    const actorUserId = randomUUID();
    const organizationId = randomUUID();
    const verificationId = randomUUID();
    const legacyVerificationId = randomUUID();
    const assistantSessionId = randomUUID();
    const assistantToolCallId = randomUUID();
    const mcpConnectionId = randomUUID();
    const mcpToolCallId = randomUUID();

    try {
      await sql.begin("isolation level repeatable read", async (transaction) => {
        const database = transaction as unknown as PostgresSql;
        const repository = createEventOpsRepository(database);

        await transaction`
          insert into users (id, supabase_user_id, state)
          values (${actorUserId}::uuid, ${actorUserId}::uuid, 'active')
        `;
        await transaction`
          insert into organizations (id, name, state, plan, kyb_state, created_at)
          values (
            ${organizationId}::uuid,
            'Admin projection fixture',
            'active',
            'enterprise',
            'verified',
            '9999-12-30T09:00:00.000Z'
          )
        `;
        await transaction`
          insert into verification_records (
            id, subject_type, subject_id, purpose, status, provider, provider_reference,
            method, jurisdiction, assurance_level, verified_at, reusable, created_at, updated_at
          ) values (
            ${verificationId}::uuid,
            'organization',
            ${organizationId}::uuid,
            'org_kyb',
            'valid',
            'didit',
            ${`admin-projection-${verificationId}`},
            'kyb_registry',
            'RS',
            'business_verified',
            '9999-12-30T10:00:00.000Z',
            false,
            '9999-12-30T10:00:00.000Z',
            '9999-12-30T10:00:00.000Z'
          )
        `;
        await transaction`
          insert into identity_verifications (
            id, user_id, provider, provider_reference, verification_type, state, created_at
          ) values (
            ${legacyVerificationId}::uuid,
            ${actorUserId}::uuid,
            'legacy-provider',
            ${`legacy-admin-projection-${legacyVerificationId}`},
            'kyc',
            'verified',
            '9999-12-30T11:00:00.000Z'
          )
        `;
        await transaction`
          insert into ai_sessions (
            id, actor_user_id, scope, state, allowed_tools, idempotency_key, created_at, expires_at
          ) values (
            ${assistantSessionId}::uuid,
            ${actorUserId}::uuid,
            'admin_ops',
            'active',
            ${["provider_health_summary"]},
            ${`assistant-admin-projection-${assistantSessionId}`},
            '9999-12-30T12:00:00.000Z',
            '9999-12-31T12:00:00.000Z'
          )
        `;
        await transaction`
          insert into ai_tool_calls (
            id, session_id, actor_user_id, scope, tool_name, state, confirmation_state,
            subject_type, input_summary, output_summary, idempotency_key, created_at
          ) values (
            ${assistantToolCallId}::uuid,
            ${assistantSessionId}::uuid,
            ${actorUserId}::uuid,
            'admin_ops',
            'provider_health_summary',
            'executed',
            'not_required',
            'provider',
            'Read provider health',
            'Providers healthy',
            ${`assistant-tool-admin-projection-${assistantToolCallId}`},
            '9999-12-30T12:01:00.000Z'
          )
        `;
        await transaction`
          insert into mcp_connections (
            id, actor_user_id, client_name, client_type, role_type, state, token_hash,
            token_hint, scopes, idempotency_key, expires_at, last_used_at, created_at
          ) values (
            ${mcpConnectionId}::uuid,
            ${actorUserId}::uuid,
            'Admin audit client',
            'custom',
            'admin',
            'active',
            ${mcpConnectionId.replaceAll("-", "").repeat(2)},
            'test…token',
            ${["admin.health.read"]},
            ${`mcp-admin-projection-${mcpConnectionId}`},
            '9999-12-31T12:00:00.000Z',
            '9999-12-30T12:03:00.000Z',
            '9999-12-30T12:02:00.000Z'
          )
        `;
        await transaction`
          insert into mcp_tool_calls (
            id, connection_id, actor_user_id, tool_name, tool_version, state, risk_level,
            required_scopes, input_summary, output_summary, created_at
          ) values (
            ${mcpToolCallId}::uuid,
            ${mcpConnectionId}::uuid,
            ${actorUserId}::uuid,
            'admin_get_provider_health',
            '1.2.3',
            'allowed',
            'read',
            ${["admin.health.read"]},
            'Read provider health',
            'Providers healthy',
            '9999-12-30T12:04:00.000Z'
          )
        `;

        const identityChecks = await repository.listIdentityChecks({});
        expect(identityChecks.items.find((item) => item.id === verificationId)).toMatchObject({
          userId: null,
          subjectType: "organization",
          subjectId: organizationId,
          purpose: "org_kyb",
          provider: "didit",
          verificationType: "kyb",
          state: "verified"
        });
        expect(identityChecks.items.some((item) => item.id === legacyVerificationId)).toBe(false);

        const sessions = await repository.listAiSessions({});
        expect(sessions.items.find((item) => item.id === assistantSessionId)).toMatchObject({
          transport: "assistant",
          connectionId: null,
          actorUserId,
          scope: "admin_ops",
          allowedToolCount: 1
        });
        expect(sessions.items.find((item) => item.id === mcpConnectionId)).toMatchObject({
          transport: "mcp",
          connectionId: mcpConnectionId,
          actorUserId,
          scope: "admin",
          clientName: "Admin audit client",
          clientType: "custom",
          authMode: "scoped_token",
          grantedScopes: ["admin.health.read"]
        });

        const toolCalls = await repository.listAiToolCalls({});
        expect(toolCalls.items.find((item) => item.id === assistantToolCallId)).toMatchObject({
          transport: "assistant",
          connectionId: null,
          actorUserId,
          toolName: "provider_health_summary",
          toolVersion: null,
          state: "executed"
        });
        expect(toolCalls.items.find((item) => item.id === mcpToolCallId)).toMatchObject({
          transport: "mcp",
          connectionId: mcpConnectionId,
          actorUserId,
          scope: "admin",
          toolName: "admin_get_provider_health",
          toolVersion: "1.2.3",
          state: "allowed",
          riskLevel: "read",
          requiredScopes: ["admin.health.read"],
          outputSummary: "Providers healthy"
        });

        await transaction`delete from mcp_tool_calls where id = ${mcpToolCallId}::uuid`;
        await transaction`delete from ai_tool_calls where id = ${assistantToolCallId}::uuid`;
        await transaction`delete from mcp_connections where id = ${mcpConnectionId}::uuid`;
        await transaction`delete from ai_sessions where id = ${assistantSessionId}::uuid`;
        await transaction`delete from identity_verifications where id = ${legacyVerificationId}::uuid`;
        await transaction`delete from verification_records where id = ${verificationId}::uuid`;
        await transaction`delete from organizations where id = ${organizationId}::uuid`;
        await transaction`delete from users where id = ${actorUserId}::uuid`;
      });
    } finally {
      await sql.end({ timeout: 5 });
    }
  });
});
