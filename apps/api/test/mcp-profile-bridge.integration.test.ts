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
    let quotaContentId: string | null = null;
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

      const capabilityInput = {
        connectionId: connection.id,
        supabaseUserId: creatorId,
        contentId,
        requestHash: "a".repeat(64),
        tokenHash: "f".repeat(64),
        mediaKind: "image" as const,
        mimeType: "image/webp" as const,
        expiresAt: new Date(Date.now() + 10 * 60_000),
        originClassification: "ai_generated" as const,
        sourceKind: "generated" as const,
        sourceLineageReference: "urn:wevid:integration:lineage",
        workflowProviderReference: "integration-workflow",
        c2paReference: "urn:c2pa:integration-claim"
      };
      const issued = await contentRepository.issueMcpMediaUploadCapability!(capabilityInput);
      expect(issued).toMatchObject({ issued: true, contentId, mediaKind: "image", mimeType: "image/webp" });
      await expect(contentRepository.issueMcpMediaUploadCapability!({
        ...capabilityInput,
        tokenHash: "e".repeat(64)
      })).resolves.toMatchObject({
        id: issued!.id,
        mediaAssetId: issued!.mediaAssetId,
        issued: false
      });
      const concurrentIssueResults = await Promise.all([
        contentRepository.issueMcpMediaUploadCapability!({
          ...capabilityInput,
          requestHash: "6".repeat(64),
          tokenHash: "4".repeat(64)
        }),
        contentRepository.issueMcpMediaUploadCapability!({
          ...capabilityInput,
          requestHash: "6".repeat(64),
          tokenHash: "5".repeat(64)
        })
      ]);
      expect(new Set(concurrentIssueResults.map((result) => result?.id)).size).toBe(1);
      expect(concurrentIssueResults.filter((result) => result?.issued)).toHaveLength(1);
      expect(concurrentIssueResults.filter((result) => result && !result.issued)).toHaveLength(1);
      const capabilityLedger = await sql<Array<{ token_hash: string; request_hash: string; payload: string }>>`
        select token_hash, request_hash, row_to_json(capability)::text as payload
        from mcp_media_upload_capabilities capability
        where id = ${issued!.id}
      `;
      expect(capabilityLedger).toMatchObject([{
        token_hash: capabilityInput.tokenHash,
        request_hash: capabilityInput.requestHash
      }]);
      expect(capabilityLedger[0]!.payload).not.toContain("prompt");
      expect(capabilityLedger[0]!.payload).not.toContain("provider-secret");

      await expect(contentRepository.claimMcpMediaUploadCapability!({
        capabilityId: issued!.id,
        connectionId: connection.id,
        supabaseUserId: otherCreatorId,
        tokenHash: capabilityInput.tokenHash,
        declaredMimeType: "image/webp",
        quotaWindowStart: new Date(Date.now() - 86_400_000),
        dailyMediaUploadQuota: 10,
        leaseToken: randomUUID(),
        leasedUntil: new Date(Date.now() + 60_000)
      })).rejects.toMatchObject({ reason: "mismatch" });

      const concurrentClaims = await Promise.allSettled([randomUUID(), randomUUID()].map((leaseToken) =>
        contentRepository.claimMcpMediaUploadCapability!({
          capabilityId: issued!.id,
          connectionId: connection.id,
          supabaseUserId: creatorId,
          tokenHash: capabilityInput.tokenHash,
          declaredMimeType: "image/webp",
          quotaWindowStart: new Date(Date.now() - 86_400_000),
          dailyMediaUploadQuota: 10,
          leaseToken,
          leasedUntil: new Date(Date.now() + 60_000)
        })
      ));
      const claimed = concurrentClaims.find((result) => result.status === "fulfilled");
      const deniedClaim = concurrentClaims.find((result) => result.status === "rejected");
      expect(claimed?.status).toBe("fulfilled");
      expect(deniedClaim).toMatchObject({
        status: "rejected",
        reason: expect.objectContaining({ reason: "busy" })
      });
      if (!claimed || claimed.status !== "fulfilled") throw new Error("capability claim did not converge");

      await sql`
        update mcp_media_upload_capabilities
        set leased_until = now() - interval '1 second'
        where id = ${issued!.id}
      `;
      const recovered = await contentRepository.claimMcpMediaUploadCapability!({
        capabilityId: issued!.id,
        connectionId: connection.id,
        supabaseUserId: creatorId,
        tokenHash: capabilityInput.tokenHash,
        declaredMimeType: "image/webp",
        quotaWindowStart: new Date(Date.now() - 86_400_000),
        dailyMediaUploadQuota: 10,
        leaseToken: randomUUID(),
        leasedUntil: new Date(Date.now() + 60_000)
      });
      const completed = await contentRepository.completeMcpMediaUploadCapability!({
        capabilityId: issued!.id,
        connectionId: connection.id,
        leaseToken: recovered.leaseToken,
        providerAssetId: `integration-image-${randomUUID()}`,
        providerState: "stored_private",
        widthPixels: 8,
        heightPixels: 5,
        checksumSha256: "1".repeat(64)
      });
      expect(completed).toMatchObject({ mediaAssetId: issued!.mediaAssetId, contentId });
      await expect(contentRepository.claimMcpMediaUploadCapability!({
        capabilityId: issued!.id,
        connectionId: connection.id,
        supabaseUserId: creatorId,
        tokenHash: capabilityInput.tokenHash,
        declaredMimeType: "image/webp",
        quotaWindowStart: new Date(Date.now() - 86_400_000),
        dailyMediaUploadQuota: 10,
        leaseToken: randomUUID(),
        leasedUntil: new Date(Date.now() + 60_000)
      })).rejects.toMatchObject({ reason: "consumed" });

      const readiness = await contentRepository.findOwnedPrivateMediaReadiness!({
        supabaseUserId: creatorId,
        contentId
      });
      expect(readiness).toMatchObject({
        contentId,
        compositionRevision: completed.compositionRevision,
        assets: [{
          mediaAssetId: issued!.mediaAssetId,
          providerState: "processing",
          quarantineState: "pending",
          provenanceReviewState: "pending",
          visibleLabelState: "ai_generated",
          machineReadableMarkingState: "pending"
        }],
        blockers: expect.arrayContaining([
          "media_processing_incomplete",
          "safety_review_incomplete",
          "provenance_review_pending"
        ])
      });
      await expect(contentRepository.findOwnedPrivateMediaReadiness!({
        supabaseUserId: otherCreatorId,
        contentId
      })).resolves.toBeNull();
      const beforeReview = await sql<Array<{ ready: boolean }>>`
        select private.content_composition_provenance_ready(${contentId}) as ready
      `;
      expect(beforeReview[0]?.ready).toBe(false);

      const reviewInput = {
        supabaseUserId: creatorId,
        mediaAssetId: issued!.mediaAssetId,
        expectedCompositionRevision: completed.compositionRevision,
        decision: "confirmed" as const,
        idempotencyKey: `integration-provenance-${randomUUID()}`,
        requestHash: "9".repeat(64)
      };
      const reviewed = await contentRepository.reviewOwnedMediaAssetProvenance!(reviewInput);
      expect(reviewed).toMatchObject({
        compositionRevision: completed.compositionRevision + 1,
        asset: { provenanceReviewState: "confirmed", visibleLabelState: "ai_generated" }
      });
      await expect(contentRepository.reviewOwnedMediaAssetProvenance!(reviewInput)).resolves.toEqual(reviewed);
      const releasePredicates = await sql<Array<{ provenance_ready: boolean; release_ready: boolean }>>`
        select
          private.content_composition_provenance_ready(${contentId}) as provenance_ready,
          private.content_safety_release_ready(${contentId}) as release_ready
      `;
      expect(releasePredicates).toEqual([{ provenance_ready: true, release_ready: false }]);

      const changedClaim = await contentRepository.updateOwnedMediaAsset!({
        supabaseUserId: creatorId,
        mediaAssetId: issued!.mediaAssetId,
        expectedCompositionRevision: reviewed!.compositionRevision,
        idempotencyKey: `integration-provenance-change-${randomUUID()}`,
        requestHash: "2".repeat(64),
        altText: null,
        altTextProvided: false,
        originClassification: "ai_assisted"
      });
      expect(changedClaim).toMatchObject({
        compositionRevision: reviewed!.compositionRevision + 1,
        asset: {
          originClassification: "ai_assisted",
          visibleLabelState: "ai_assisted",
          provenanceReviewState: "pending"
        }
      });
      const staleReviewPredicate = await sql<Array<{ provenance_ready: boolean }>>`
        select private.content_composition_provenance_ready(${contentId}) as provenance_ready
      `;
      expect(staleReviewPredicate).toEqual([{ provenance_ready: false }]);
      const rereviewed = await contentRepository.reviewOwnedMediaAssetProvenance!({
        ...reviewInput,
        expectedCompositionRevision: changedClaim!.compositionRevision,
        idempotencyKey: `integration-provenance-rereview-${randomUUID()}`,
        requestHash: "3".repeat(64)
      });
      expect(rereviewed).toMatchObject({
        compositionRevision: changedClaim!.compositionRevision + 1,
        asset: { provenanceReviewState: "confirmed", visibleLabelState: "ai_assisted" }
      });

      const quotaDraft = await contentRepository.createDraft({
        ...createInput,
        idempotencyKey: `mcp-private-draft:${connection.id}:${"7".repeat(64)}`,
        requestHash: "7".repeat(64),
        origin: { ...createInput.origin, requestHash: "7".repeat(64) }
      });
      quotaContentId = quotaDraft.id;
      const quotaCapabilities = await Promise.all([
        contentRepository.issueMcpMediaUploadCapability!({
          ...capabilityInput,
          contentId,
          requestHash: "c".repeat(64),
          tokenHash: "c".repeat(64),
          c2paReference: null
        }),
        contentRepository.issueMcpMediaUploadCapability!({
          ...capabilityInput,
          contentId: quotaContentId,
          requestHash: "d".repeat(64),
          tokenHash: "d".repeat(64),
          c2paReference: null
        })
      ]);
      const quotaClaims = await Promise.allSettled(quotaCapabilities.map((capability, index) =>
        contentRepository.claimMcpMediaUploadCapability!({
          capabilityId: capability!.id,
          connectionId: connection.id,
          supabaseUserId: creatorId,
          tokenHash: index === 0 ? "c".repeat(64) : "d".repeat(64),
          declaredMimeType: "image/webp",
          quotaWindowStart: new Date(Date.now() - 86_400_000),
          dailyMediaUploadQuota: 2,
          leaseToken: randomUUID(),
          leasedUntil: new Date(Date.now() + 60_000)
        })
      ));
      const quotaWinnerIndex = quotaClaims.findIndex((result) => result.status === "fulfilled");
      expect(quotaWinnerIndex).toBeGreaterThanOrEqual(0);
      expect(quotaClaims.filter((result) => result.status === "fulfilled")).toHaveLength(1);
      expect(quotaClaims.find((result) => result.status === "rejected")).toMatchObject({
        status: "rejected",
        reason: expect.objectContaining({ reason: "quota_exceeded" })
      });
      const quotaWinner = quotaClaims[quotaWinnerIndex];
      if (!quotaWinner || quotaWinner.status !== "fulfilled") throw new Error("quota claim did not converge");
      await contentRepository.releaseMcpMediaUploadCapability!({
        capabilityId: quotaCapabilities[quotaWinnerIndex]!.id,
        connectionId: connection.id,
        leaseToken: quotaWinner.value.leaseToken,
        failureCode: "integration_release"
      });

      await contentRepository.scheduleMcpMediaProviderCleanup!({
        capabilityId: issued!.id,
        connectionId: connection.id,
        leaseToken: claimed.value.leaseToken,
        providerAssetId: `expired-lease-image-${randomUUID()}`,
        failureCode: "provider_delete_failed"
      });
      const lostLeaseCleanup = await sql<Array<{
        capability_state: string;
        cleanup_count: number;
        asset_revision: number;
      }>>`
        select capability.state as capability_state,
          count(asset.id)::integer as cleanup_count,
          content.asset_revision::integer as asset_revision
        from mcp_media_upload_capabilities capability
        join content_items content on content.id = capability.content_item_id
        join media_assets asset on asset.content_item_id = content.id
          and asset.retirement_reason = 'mcp_provider_attach_failed'
        where capability.id = ${issued!.id}
        group by capability.state, content.asset_revision
      `;
      expect(lostLeaseCleanup).toEqual([{
        capability_state: "consumed",
        cleanup_count: 1,
        asset_revision: rereviewed!.compositionRevision
      }]);

      const cleanupCapability = await contentRepository.issueMcpMediaUploadCapability!({
        ...capabilityInput,
        requestHash: "8".repeat(64),
        tokenHash: "7".repeat(64),
        c2paReference: null
      });
      const cleanupClaim = await contentRepository.claimMcpMediaUploadCapability!({
        capabilityId: cleanupCapability!.id,
        connectionId: connection.id,
        supabaseUserId: creatorId,
        tokenHash: "7".repeat(64),
        declaredMimeType: "image/webp",
        quotaWindowStart: new Date(Date.now() - 86_400_000),
        dailyMediaUploadQuota: 10,
        leaseToken: randomUUID(),
        leasedUntil: new Date(Date.now() + 60_000)
      });
      await contentRepository.scheduleMcpMediaProviderCleanup!({
        capabilityId: cleanupCapability!.id,
        connectionId: connection.id,
        leaseToken: cleanupClaim.leaseToken,
        providerAssetId: `orphan-image-${randomUUID()}`,
        failureCode: "provider_delete_failed"
      });
      const cleanupState = await sql<Array<{
        state: string;
        retired_at: Date;
        provider_cleanup_state: string;
        asset_revision: number;
      }>>`
        select capability.state, asset.retired_at, asset.provider_cleanup_state,
          content.asset_revision::integer as asset_revision
        from mcp_media_upload_capabilities capability
        join media_assets asset on asset.id = capability.reserved_media_asset_id
        join content_items content on content.id = capability.content_item_id
        where capability.id = ${cleanupCapability!.id}
      `;
      expect(cleanupState).toMatchObject([{
        state: "revoked",
        retired_at: expect.any(Date),
        provider_cleanup_state: "retry",
        asset_revision: rereviewed!.compositionRevision
      }]);

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
        await sql`delete from mcp_media_upload_capabilities where connection_id = ${connectionId}`;
        await sql`delete from mcp_connections where id = ${connectionId}`;
      }
      if (contentId) {
        await sql`
          delete from media_moderation_jobs
          where media_asset_id in (select id from media_assets where content_item_id = ${contentId})
        `;
        await sql`delete from media_assets where content_item_id = ${contentId}`;
      }
      if (contentId) await sql`delete from content_items where id = ${contentId}`;
      if (pollContentId) await sql`delete from content_items where id = ${pollContentId}`;
      if (quotaContentId) await sql`delete from content_items where id = ${quotaContentId}`;
      await sql`delete from idempotency_keys where actor_user_id = any(${[creatorId, otherCreatorId]}::uuid[])`;
      await sql`delete from audit_events where actor_user_id = any(${[creatorId, otherCreatorId]}::uuid[])`;
      await sql`delete from profiles where user_id = any(${[creatorId, otherCreatorId]}::uuid[])`;
      await sql`delete from users where id = any(${[creatorId, otherCreatorId]}::uuid[])`;
      await sql.end({ timeout: 5 });
    }
  }, 30_000);
});

function safeDatabaseHost(databaseUrl: string | undefined): string {
  try {
    return databaseUrl ? new URL(databaseUrl).hostname : "";
  } catch {
    return "";
  }
}
