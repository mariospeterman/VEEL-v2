import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  ContentDraftOriginConflictError,
  ContentDraftPollCloseError
} from "../src/modules/content/content-errors.js";
import { createPostgresContentRepository } from "../src/modules/content/content-repository.js";
import { createPostgresMcpRepository } from "../src/modules/mcp/mcp-repository.js";
import { createPostgresClient } from "../src/shared/postgres.js";

const enabled = ["1", "true"].includes(process.env.VEEL_ENABLE_REAL_API_INTEGRATION_TESTS ?? "");
const describeIntegration = enabled ? describe : describe.skip;

describeIntegration("MCP profile bridge against migrated Postgres", () => {
  it("creates a valid scoped connection and records one minimized origin for an owned private draft", async () => {
    const databaseUrl = process.env.API_INTEGRATION_DATABASE_URL ?? process.env.DATABASE_URL;
    const databaseHost = safeDatabaseHost(databaseUrl);
    if (!databaseUrl || !["127.0.0.1", "localhost"].includes(databaseHost)) {
      throw new Error("A loopback API_INTEGRATION_DATABASE_URL is required");
    }

    const sql = createPostgresClient(databaseUrl);
    const contentRepository = createPostgresContentRepository(sql);
    const repository = createPostgresMcpRepository(sql);
    const creatorId = randomUUID();
    const otherCreatorId = randomUUID();
    let contentId: string | null = null;
    let pollContentId: string | null = null;
    let connectionId: string | null = null;

    try {
      await sql`
        insert into users (id, supabase_user_id, state)
        values (${creatorId}, ${creatorId}, 'active'), (${otherCreatorId}, ${otherCreatorId}, 'active')
      `;
      await sql`
        insert into profiles (user_id, handle, display_name, visibility)
        values
          (${creatorId}, ${`mcp_${creatorId.replaceAll("-", "").slice(0, 12)}`}, 'MCP creator', 'public'),
          (${otherCreatorId}, ${`mcp_${otherCreatorId.replaceAll("-", "").slice(0, 12)}`}, 'Other creator', 'public')
      `;

      const connection = await repository.createConnection({
        supabaseUserId: creatorId,
        clientName: "Integration assistant",
        clientType: "custom",
        roleType: "creator",
        tokenHash: creatorId.replaceAll("-", "").repeat(2),
        tokenHint: "test…token",
        scopes: ["creator.drafts.write"],
        idempotencyKey: `mcp-integration-${randomUUID()}`,
        expiresAt: new Date(Date.now() + 60_000)
      });
      connectionId = connection.id;
      expect(connection).toMatchObject({ authMode: "scoped_token", state: "active" });

      const createInput = {
        supabaseUserId: creatorId,
        idempotencyKey: `mcp-private-draft:${connection.id}:${"b".repeat(64)}`,
        requestHash: "b".repeat(64),
        mediaType: "image" as const,
        caption: "Private integration draft",
        visibility: "private",
        nsfwLabel: "none" as const,
        representationMode: "not_declared" as const,
        contentSafetyPolicyAccepted: false,
        quotaWindowStart: new Date(Date.now() - 86_400_000),
        dailyDraftQuota: 10,
        origin: {
          kind: "mcp" as const,
          connectionId: connection.id,
          toolName: "creator_create_private_draft" as const,
          toolVersion: "1.0.0",
          requestHash: "b".repeat(64)
        }
      };
      const created = await contentRepository.createDraft(createInput);
      contentId = created.id;
      await expect(contentRepository.createDraft(createInput)).resolves.toMatchObject({ id: contentId });

      const pollClosesAt = new Date(Date.now() + 1_000).toISOString();
      const pollInput = {
        ...createInput,
        idempotencyKey: `mcp-private-draft:${connection.id}:${"d".repeat(64)}`,
        requestHash: "d".repeat(64),
        mediaType: "poll" as const,
        caption: null,
        poll: { question: "Replay after close?", options: ["Yes", "No"], closesAt: pollClosesAt },
        origin: { ...createInput.origin, requestHash: "d".repeat(64) }
      };
      const createdPoll = await contentRepository.createDraft(pollInput);
      pollContentId = createdPoll.id;
      await new Promise((resolve) => setTimeout(resolve, 1_050));
      await expect(contentRepository.createDraft(pollInput)).resolves.toMatchObject({ id: pollContentId });
      await expect(contentRepository.createDraft({
        ...pollInput,
        idempotencyKey: `mcp-private-draft:${connection.id}:${"e".repeat(64)}`,
        requestHash: "e".repeat(64),
        origin: { ...createInput.origin, requestHash: "e".repeat(64) }
      })).rejects.toBeInstanceOf(ContentDraftPollCloseError);

      await expect(contentRepository.createDraft({
        ...createInput,
        supabaseUserId: otherCreatorId,
        idempotencyKey: `cross-user-${randomUUID()}`,
        requestHash: "c".repeat(64),
        origin: { ...createInput.origin, requestHash: "c".repeat(64) }
      })).rejects.toBeInstanceOf(ContentDraftOriginConflictError);

      const rows = await sql<Array<{
        connection_id: string;
        actor_user_id: string;
        content_item_id: string;
        tool_name: string;
        tool_version: string;
        request_hash: string;
      }>>`
        select connection_id, actor_user_id, content_item_id, tool_name, tool_version, request_hash
        from mcp_private_draft_origins
        where connection_id = ${connection.id}
          and content_item_id = ${contentId}
      `;
      expect(rows).toEqual([{
        connection_id: connection.id,
        actor_user_id: creatorId,
        content_item_id: contentId,
        tool_name: "creator_create_private_draft",
        tool_version: "1.0.0",
        request_hash: "b".repeat(64)
      }]);
    } finally {
      if (connectionId) {
        await sql`delete from mcp_private_draft_origins where connection_id = ${connectionId}`;
        await sql`delete from mcp_connections where id = ${connectionId}`;
      }
      if (contentId) await sql`delete from content_items where id = ${contentId}`;
      if (pollContentId) await sql`delete from content_items where id = ${pollContentId}`;
      await sql`delete from idempotency_keys where actor_user_id = any(${[creatorId, otherCreatorId]}::uuid[])`;
      await sql`delete from profiles where user_id = any(${[creatorId, otherCreatorId]}::uuid[])`;
      await sql`delete from users where id = any(${[creatorId, otherCreatorId]}::uuid[])`;
      await sql.end({ timeout: 5 });
    }
  });
});

function safeDatabaseHost(databaseUrl: string | undefined): string {
  try {
    return databaseUrl ? new URL(databaseUrl).hostname : "";
  } catch {
    return "";
  }
}
