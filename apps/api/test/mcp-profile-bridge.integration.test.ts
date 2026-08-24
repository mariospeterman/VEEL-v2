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
    let capacityContentId: string | null = null;
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
      await sql`
        insert into verification_records (
          subject_type, subject_id, purpose, status, provider, provider_reference,
          method, threshold_age, result_over_threshold, assurance_level, verified_at, reusable
        ) values (
          'user', ${creatorId}, 'age_access', 'valid', 'internal',
          ${`mcp-age-${creatorId}`}, 'reusable_age', 18, true, 'high', now(), false
        )
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
        sourceLineageReference: "urn:wevid:lineage:00000000-0000-4000-8000-000000000401",
        workflowProviderReference: "00000000-0000-4000-8000-000000000402",
        c2paReference: "urn:c2pa:claim:00000000-0000-4000-8000-000000000403"
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
      await expect(sql`
        update mcp_media_upload_capabilities
        set source_lineage_reference = 'https://example.test/users/alice@example.com'
        where id = ${issued!.id}
      `).rejects.toBeDefined();

      const ineligibleCapability = await contentRepository.issueMcpMediaUploadCapability!({
        ...capabilityInput,
        requestHash: "7".repeat(64),
        tokenHash: "8".repeat(64),
        c2paReference: null
      });
      await sql`update users set state = 'suspended' where id = ${creatorId}`;
      await expect(contentRepository.claimMcpMediaUploadCapability!({
        capabilityId: ineligibleCapability!.id,
        connectionId: connection.id,
        supabaseUserId: creatorId,
        tokenHash: "8".repeat(64),
        declaredMimeType: "image/webp",
        quotaWindowStart: new Date(Date.now() - 86_400_000),
        dailyMediaUploadQuota: 10,
        leaseToken: randomUUID(),
        leasedUntil: new Date(Date.now() + 60_000)
      })).rejects.toMatchObject({ reason: "access_ineligible" });
      await sql`update users set state = 'active' where id = ${creatorId}`;
      await sql`
        update verification_records set status = 'revoked', updated_at = now()
        where subject_type = 'user' and subject_id = ${creatorId} and purpose = 'age_access'
      `;
      await expect(contentRepository.claimMcpMediaUploadCapability!({
        capabilityId: ineligibleCapability!.id,
        connectionId: connection.id,
        supabaseUserId: creatorId,
        tokenHash: "8".repeat(64),
        declaredMimeType: "image/webp",
        quotaWindowStart: new Date(Date.now() - 86_400_000),
        dailyMediaUploadQuota: 10,
        leaseToken: randomUUID(),
        leasedUntil: new Date(Date.now() + 60_000)
      })).rejects.toMatchObject({ reason: "access_ineligible" });
      await expect(sql<Array<{ reason: string; contains_token: boolean }>>`
        select metadata->>'reason' as reason,
          metadata::text like ${`%${"8".repeat(64)}%`} as contains_token
        from audit_events
        where subject_type = 'mcp_media_capability'
          and subject_id = ${ineligibleCapability!.id}
          and action = 'mcp_media_capability_redemption_denied'
        order by created_at
      `).resolves.toEqual([
        { reason: "access_ineligible", contains_token: false },
        { reason: "access_ineligible", contains_token: false }
      ]);
      await sql`
        update verification_records set status = 'valid', updated_at = now()
        where subject_type = 'user' and subject_id = ${creatorId} and purpose = 'age_access'
      `;

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
          dailyMediaUploadQuota: 1,
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
        dailyMediaUploadQuota: 1,
        leaseToken: randomUUID(),
        leasedUntil: new Date(Date.now() + 60_000)
      });
      // A previously approved empty composition must not make a newly attached,
      // unreviewed asset appear safety-ready in the MCP readiness projection.
      await sql`
        update media_safety_cases
        set state = 'approved', provider_release_allowed = true,
            reason_code = 'approved_before_new_asset', updated_at = now()
        where content_item_id = ${contentId} and state <> 'superseded'
      `;
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
      await expect(sql<Array<{
        provider_playable: boolean;
        ready_at: Date | null;
        provider_checked_at: Date | null;
      }>>`
        select provider_playable, ready_at, provider_checked_at
        from media_assets where id = ${issued!.mediaAssetId}
      `).resolves.toMatchObject([{
        provider_playable: true,
        ready_at: expect.any(Date),
        provider_checked_at: expect.any(Date)
      }]);
      await expect(sql`
        update media_assets
        set c2pa_reference = 'https://example.test/users/alice@example.com'
        where id = ${issued!.mediaAssetId}
      `).rejects.toBeDefined();
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
          providerState: "ready",
          quarantineState: "pending",
          provenanceReviewState: "pending",
          visibleLabelState: "ai_generated",
          machineReadableMarkingState: "pending"
        }],
        blockers: expect.arrayContaining([
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
      await expect(contentRepository.updateOwnedMediaAsset!({
        supabaseUserId: creatorId,
        mediaAssetId: issued!.mediaAssetId,
        expectedCompositionRevision: rereviewed!.compositionRevision,
        idempotencyKey: `integration-human-origin-rejected-${randomUUID()}`,
        requestHash: "4".repeat(64),
        altText: null,
        altTextProvided: false,
        originClassification: "human_created"
      })).rejects.toMatchObject({ reason: "provenance_locked" });

      let readinessAfterWaitingForLock: Promise<Array<{ provenance_ready: boolean }>> | null = null;
      await sql.begin(async (transaction) => {
        await transaction`select id from content_items where id = ${contentId} for update`;
        readinessAfterWaitingForLock = sql.begin(async (waitingTransaction) => {
          await waitingTransaction`select id from content_items where id = ${contentId} for update`;
          return waitingTransaction<Array<{ provenance_ready: boolean }>>`
            select private.content_composition_provenance_ready(${contentId}) as provenance_ready
          `;
        });
        await new Promise((resolve) => setTimeout(resolve, 150));
        await transaction`
          update media_assets
          set provenance_human_review_state = 'pending'
          where id = ${issued!.mediaAssetId}
        `;
      });
      await expect(readinessAfterWaitingForLock!).resolves.toEqual([{ provenance_ready: false }]);
      await sql`
        update media_assets
        set provenance_human_review_state = 'confirmed'
        where id = ${issued!.mediaAssetId}
      `;

      const expiredReservationToken = "31".repeat(32);
      const expiredReservation = await contentRepository.issueMcpMediaUploadCapability!({
        ...capabilityInput,
        requestHash: "41".repeat(32),
        tokenHash: expiredReservationToken,
        c2paReference: null
      });
      const expiredReservationClaim = await contentRepository.claimMcpMediaUploadCapability!({
        capabilityId: expiredReservation!.id,
        connectionId: connection.id,
        supabaseUserId: creatorId,
        tokenHash: expiredReservationToken,
        declaredMimeType: "image/webp",
        quotaWindowStart: new Date(Date.now() - 86_400_000),
        dailyMediaUploadQuota: 100,
        leaseToken: randomUUID(),
        leasedUntil: new Date(Date.now() + 60_000)
      });
      await sql`
        update mcp_media_upload_capabilities
        set created_at = now() - interval '11 minutes',
            expires_at = now() - interval '1 second'
        where id = ${expiredReservation!.id}
      `;
      const expiredQuotaImageId = randomUUID();
      const expiredQuotaIdempotencyKey = `expired-quota-image-${randomUUID()}`;
      await expect(contentRepository.reserveImageAssetUpload!({
        supabaseUserId: creatorId,
        contentId,
        mediaAssetId: expiredQuotaImageId,
        idempotencyKey: expiredQuotaIdempotencyKey,
        requestHash: "6".repeat(64),
        providerAssetId: `images/${contentId}/${expiredQuotaImageId}.webp`,
        mimeType: "image/webp",
        widthPixels: 8,
        heightPixels: 5,
        checksumSha256: "6".repeat(64),
        quotaWindowStart: new Date(Date.now() - 86_400_000),
        dailyMediaUploadQuota: 2
      })).resolves.toMatchObject({ mediaAssetId: expiredQuotaImageId });
      await sql`delete from media_moderation_jobs where media_asset_id = ${expiredQuotaImageId}`;
      await sql`delete from media_assets where id = ${expiredQuotaImageId}`;
      await sql`
        delete from idempotency_keys
        where key = ${`content:image-upload:${creatorId}:${expiredQuotaIdempotencyKey}`}
      `;
      const liveReservationToken = "32".repeat(32);
      const liveReservation = await contentRepository.issueMcpMediaUploadCapability!({
        ...capabilityInput,
        requestHash: "42".repeat(32),
        tokenHash: liveReservationToken,
        c2paReference: null
      });
      const liveReservationClaim = await contentRepository.claimMcpMediaUploadCapability!({
        capabilityId: liveReservation!.id,
        connectionId: connection.id,
        supabaseUserId: creatorId,
        tokenHash: liveReservationToken,
        declaredMimeType: "image/webp",
        quotaWindowStart: new Date(Date.now() - 86_400_000),
        dailyMediaUploadQuota: 2,
        leaseToken: randomUUID(),
        leasedUntil: new Date(Date.now() + 60_000)
      });
      await contentRepository.releaseMcpMediaUploadCapability!({
        capabilityId: liveReservation!.id,
        connectionId: connection.id,
        leaseToken: liveReservationClaim.leaseToken,
        failureCode: "integration_expired_quota_release"
      });
      await sql`delete from mcp_media_upload_capabilities where id = ${expiredReservation!.id}`;
      expect(expiredReservationClaim.leaseToken).toEqual(expect.any(String));

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

      const sharedQuotaCapability = await contentRepository.issueMcpMediaUploadCapability!({
        ...capabilityInput,
        contentId,
        requestHash: "9".repeat(64),
        tokenHash: "9".repeat(64),
        c2paReference: null
      });
      const sharedQuotaImageId = randomUUID();
      const sharedQuotaResults = await Promise.allSettled([
        contentRepository.claimMcpMediaUploadCapability!({
          capabilityId: sharedQuotaCapability!.id,
          connectionId: connection.id,
          supabaseUserId: creatorId,
          tokenHash: "9".repeat(64),
          declaredMimeType: "image/webp",
          quotaWindowStart: new Date(Date.now() - 86_400_000),
          dailyMediaUploadQuota: 2,
          leaseToken: randomUUID(),
          leasedUntil: new Date(Date.now() + 60_000)
        }),
        contentRepository.reserveImageAssetUpload!({
          supabaseUserId: creatorId,
          contentId: quotaContentId,
          mediaAssetId: sharedQuotaImageId,
          idempotencyKey: `shared-quota-image-${randomUUID()}`,
          requestHash: "2".repeat(64),
          providerAssetId: `images/${quotaContentId}/${sharedQuotaImageId}.webp`,
          mimeType: "image/webp",
          widthPixels: 8,
          heightPixels: 5,
          checksumSha256: "2".repeat(64),
          quotaWindowStart: new Date(Date.now() - 86_400_000),
          dailyMediaUploadQuota: 2
        })
      ]);
      expect(sharedQuotaResults.filter((result) => result.status === "fulfilled")).toHaveLength(1);
      expect(sharedQuotaResults.find((result) => result.status === "rejected")).toMatchObject({
        status: "rejected",
        reason: expect.objectContaining({ reason: "quota_exceeded" })
      });
      if (sharedQuotaResults[0]?.status === "fulfilled") {
        await contentRepository.releaseMcpMediaUploadCapability!({
          capabilityId: sharedQuotaCapability!.id,
          connectionId: connection.id,
          leaseToken: sharedQuotaResults[0].value.leaseToken,
          failureCode: "integration_shared_quota_release"
        });
      }

      const publicationRaceCapability = await contentRepository.issueMcpMediaUploadCapability!({
        ...capabilityInput,
        contentId: quotaContentId,
        requestHash: "0".repeat(64),
        tokenHash: "0".repeat(64),
        c2paReference: null
      });
      const publicationRaceClaim = await contentRepository.claimMcpMediaUploadCapability!({
        capabilityId: publicationRaceCapability!.id,
        connectionId: connection.id,
        supabaseUserId: creatorId,
        tokenHash: "0".repeat(64),
        declaredMimeType: "image/webp",
        quotaWindowStart: new Date(Date.now() - 86_400_000),
        dailyMediaUploadQuota: 10,
        leaseToken: randomUUID(),
        leasedUntil: new Date(Date.now() + 60_000)
      });
      await sql`
        update content_items set publish_state = 'published' where id = ${quotaContentId}
      `;
      await expect(contentRepository.completeMcpMediaUploadCapability!({
        capabilityId: publicationRaceCapability!.id,
        connectionId: connection.id,
        leaseToken: publicationRaceClaim.leaseToken,
        providerAssetId: `publication-race-${randomUUID()}`,
        providerState: "stored_private",
        widthPixels: 8,
        heightPixels: 5,
        checksumSha256: "3".repeat(64)
      })).rejects.toMatchObject({ reason: "draft_locked" });
      await expect(sql<{ count: number }[]>`
        select count(*)::integer as count
        from media_assets where id = ${publicationRaceCapability!.mediaAssetId}
      `).resolves.toEqual([{ count: 0 }]);
      await contentRepository.releaseMcpMediaUploadCapability!({
        capabilityId: publicationRaceCapability!.id,
        connectionId: connection.id,
        leaseToken: publicationRaceClaim.leaseToken,
        failureCode: "integration_publication_race"
      });
      await sql`
        update content_items set publish_state = 'draft' where id = ${quotaContentId}
      `;

      const capacityDraft = await contentRepository.createDraft({
        ...createInput,
        idempotencyKey: `mcp-private-draft:${connection.id}:${"6".repeat(64)}`,
        requestHash: "6".repeat(64),
        origin: { ...createInput.origin, requestHash: "6".repeat(64) }
      });
      capacityContentId = capacityDraft.id;
      for (let position = 0; position < 9; position += 1) {
        await sql`
          insert into media_assets (
            id, content_item_id, provider, provider_asset_id, provider_state,
            provider_playable, ready_at, asset_kind, position, required_for_release
          ) values (
            ${randomUUID()}, ${capacityContentId}, 'bunny',
            ${`capacity-seed-${position}-${randomUUID()}`}, 'stored_private',
            true, now(), 'image', ${position}, true
          )
        `;
      }
      const tenthAssetId = randomUUID();
      let issueAfterTenthAttachment: Promise<unknown> | null = null;
      await sql.begin(async (transaction) => {
        await transaction`select id from content_items where id = ${capacityContentId} for update`;
        issueAfterTenthAttachment = contentRepository.issueMcpMediaUploadCapability!({
          ...capabilityInput,
          contentId: capacityContentId!,
          requestHash: "26".repeat(32),
          tokenHash: "36".repeat(32),
          c2paReference: null
        });
        await new Promise((resolve) => setTimeout(resolve, 150));
        await transaction`
          insert into media_assets (
            id, content_item_id, provider, provider_asset_id, provider_state,
            provider_playable, ready_at, asset_kind, position, required_for_release
          ) values (
            ${tenthAssetId}, ${capacityContentId}, 'bunny',
            ${`capacity-tenth-${randomUUID()}`}, 'stored_private',
            true, now(), 'image', 9, true
          )
        `;
      });
      await expect(issueAfterTenthAttachment!).resolves.toBeNull();
      await sql`delete from media_assets where id = ${tenthAssetId}`;

      const capacityTokens = ["14".repeat(32), "15".repeat(32)];
      const capacityRequests = ["24".repeat(32), "25".repeat(32)];
      const capacityCapabilities = await Promise.all(capacityTokens.map((token, index) =>
        contentRepository.issueMcpMediaUploadCapability!({
          ...capabilityInput,
          contentId: capacityContentId!,
          requestHash: capacityRequests[index]!,
          tokenHash: token,
          c2paReference: null
        })
      ));
      const capacityClaims = await Promise.all(capacityCapabilities.map((capability, index) =>
        contentRepository.claimMcpMediaUploadCapability!({
          capabilityId: capability!.id,
          connectionId: connection.id,
          supabaseUserId: creatorId,
          tokenHash: capacityTokens[index]!,
          declaredMimeType: "image/webp",
          quotaWindowStart: new Date(Date.now() - 86_400_000),
          dailyMediaUploadQuota: 100,
          leaseToken: randomUUID(),
          leasedUntil: new Date(Date.now() + 60_000)
        })
      ));
      const completionPromises: Promise<unknown>[] = [];
      await sql.begin(async (transaction) => {
        await transaction`select id from content_items where id = ${capacityContentId} for update`;
        completionPromises.push(...capacityCapabilities.map((capability, index) =>
          contentRepository.completeMcpMediaUploadCapability!({
            capabilityId: capability!.id,
            connectionId: connection.id,
            leaseToken: capacityClaims[index]!.leaseToken,
            providerAssetId: `capacity-race-${index}-${randomUUID()}`,
            providerState: "stored_private",
            widthPixels: 8,
            heightPixels: 5,
            checksumSha256: (index === 0 ? "4" : "5").repeat(64)
          })
        ));
        await new Promise((resolve) => setTimeout(resolve, 150));
      });
      const capacityCompletions = await Promise.allSettled(completionPromises);
      expect(capacityCompletions.filter((result) => result.status === "fulfilled")).toHaveLength(1);
      expect(capacityCompletions.find((result) => result.status === "rejected")).toMatchObject({
        status: "rejected",
        reason: expect.objectContaining({ reason: "draft_locked" })
      });
      await expect(sql<{ count: number }[]>`
        select count(*)::integer as count from media_assets
        where content_item_id = ${capacityContentId} and retired_at is null
      `).resolves.toEqual([{ count: 10 }]);
      await sql`delete from mcp_private_draft_origins where content_item_id = ${capacityContentId}`;
      await sql`delete from mcp_media_upload_capabilities where content_item_id = ${capacityContentId}`;
      await sql`
        delete from media_moderation_jobs
        where media_asset_id in (
          select id from media_assets where content_item_id = ${capacityContentId}
        )
      `;
      await sql`delete from media_assets where content_item_id = ${capacityContentId}`;
      await sql`delete from content_items where id = ${capacityContentId}`;
      capacityContentId = null;

      const videoCapacityDraft = await contentRepository.createDraft({
        ...createInput,
        idempotencyKey: `mcp-private-draft:${connection.id}:${"33".repeat(32)}`,
        requestHash: "33".repeat(32),
        mediaType: "vod",
        origin: { ...createInput.origin, requestHash: "33".repeat(32) }
      });
      capacityContentId = videoCapacityDraft.id;
      for (let position = 0; position < 9; position += 1) {
        await sql`
          insert into media_assets (
            id, content_item_id, provider, provider_asset_id, provider_state,
            provider_playable, ready_at, asset_kind, position, required_for_release
          ) values (
            ${randomUUID()}, ${capacityContentId}, 'bunny',
            ${`video-capacity-seed-${position}-${randomUUID()}`}, 'ready',
            true, now(), 'video', ${position}, true
          )
        `;
      }
      const firstPartyVideoCompletions = await Promise.allSettled([0, 1].map((index) =>
        contentRepository.createMediaAsset({
          supabaseUserId: creatorId,
          contentId: capacityContentId!,
          provider: "bunny",
          providerAssetId: `video-capacity-race-${index}-${randomUUID()}`,
          providerState: "created",
          quotaWindowStart: new Date(Date.now() - 86_400_000),
          dailyMediaUploadQuota: 100
        })
      ));
      expect(firstPartyVideoCompletions.filter((result) => result.status === "fulfilled")).toHaveLength(1);
      expect(firstPartyVideoCompletions.find((result) => result.status === "rejected")).toMatchObject({
        status: "rejected",
        reason: expect.objectContaining({ reason: "draft_locked" })
      });
      await expect(sql<{ count: number }[]>`
        select count(*)::integer as count from media_assets
        where content_item_id = ${capacityContentId} and retired_at is null
      `).resolves.toEqual([{ count: 10 }]);
      await sql`delete from mcp_private_draft_origins where content_item_id = ${capacityContentId}`;
      await sql`
        delete from media_moderation_jobs
        where media_asset_id in (
          select id from media_assets where content_item_id = ${capacityContentId}
        )
      `;
      await sql`delete from media_assets where content_item_id = ${capacityContentId}`;
      await sql`delete from content_items where id = ${capacityContentId}`;
      capacityContentId = null;

      const revisionBeforeLostLeaseCleanup = await sql<{ asset_revision: number }[]>`
        select asset_revision::integer as asset_revision
        from content_items where id = ${contentId}
      `;
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
        asset_revision: revisionBeforeLostLeaseCleanup[0]!.asset_revision
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
        asset_revision: revisionBeforeLostLeaseCleanup[0]!.asset_revision
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
      const mediaContentIds = [contentId, quotaContentId, capacityContentId].filter(
        (value): value is string => value !== null
      );
      if (mediaContentIds.length > 0) {
        await sql`
          delete from media_moderation_jobs
          where media_asset_id in (
            select id from media_assets where content_item_id = any(${mediaContentIds}::uuid[])
          )
        `;
        await sql`delete from media_assets where content_item_id = any(${mediaContentIds}::uuid[])`;
      }
      if (contentId) await sql`delete from content_items where id = ${contentId}`;
      if (pollContentId) await sql`delete from content_items where id = ${pollContentId}`;
      if (quotaContentId) await sql`delete from content_items where id = ${quotaContentId}`;
      if (capacityContentId) await sql`delete from content_items where id = ${capacityContentId}`;
      await sql`delete from idempotency_keys where actor_user_id = any(${[creatorId, otherCreatorId]}::uuid[])`;
      await sql`delete from audit_events where actor_user_id = any(${[creatorId, otherCreatorId]}::uuid[])`;
      await sql`
        delete from verification_records
        where subject_type = 'user' and subject_id = any(${[creatorId, otherCreatorId]}::uuid[])
      `;
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
