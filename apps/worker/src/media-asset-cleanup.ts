import { randomUUID } from "node:crypto";
import type { MediaUploadProviderAdapter } from "@veel/api/media-upload-provider";
import postgres from "postgres";

export interface QueuedMediaAssetCleanup {
  mediaAssetId: string;
  contentId: string;
  provider: "bunny" | "livepeer";
  providerAssetId: string;
  assetKind: "image" | "video";
  leaseToken: string;
  attemptCount: number;
}

export type MediaAssetCleanupOutcome =
  | { state: "completed" }
  | { state: "retry"; errorCode: string };

export interface MediaAssetCleanupRepository {
  leaseDueCleanups(input: {
    now: Date;
    limit: number;
    leaseDurationMs: number;
  }): Promise<QueuedMediaAssetCleanup[]>;
  recordCleanupOutcome(input: {
    cleanup: QueuedMediaAssetCleanup;
    now: Date;
    outcome: MediaAssetCleanupOutcome;
  }): Promise<void>;
  close?(): Promise<void>;
}

export interface MediaAssetCleanupProvider {
  remove(cleanup: QueuedMediaAssetCleanup): Promise<void>;
}

export interface ProcessMediaAssetCleanupsResult {
  leased: number;
  completed: number;
  retrying: number;
}

export async function processMediaAssetCleanups(input: {
  repository: MediaAssetCleanupRepository;
  provider: MediaAssetCleanupProvider;
  now?: Date;
  limit?: number;
  leaseDurationMs?: number;
}): Promise<ProcessMediaAssetCleanupsResult> {
  const now = input.now ?? new Date();
  const cleanups = await input.repository.leaseDueCleanups({
    now,
    limit: input.limit ?? 25,
    leaseDurationMs: input.leaseDurationMs ?? 5 * 60 * 1000
  });
  const result = { leased: cleanups.length, completed: 0, retrying: 0 };

  for (const cleanup of cleanups) {
    const outcome: MediaAssetCleanupOutcome = await input.provider.remove(cleanup)
      .then(() => ({ state: "completed" as const }))
      .catch(() => ({ state: "retry" as const, errorCode: "provider_delete_failed" }));
    await input.repository.recordCleanupOutcome({ cleanup, now, outcome });
    if (outcome.state === "completed") result.completed += 1;
    else result.retrying += 1;
  }
  return result;
}

export function createAdapterMediaAssetCleanupProvider(
  adapter: MediaUploadProviderAdapter
): MediaAssetCleanupProvider {
  return {
    async remove(cleanup) {
      if (cleanup.provider !== adapter.provider || !adapter.deleteProviderAsset) {
        throw new Error("media_asset_cleanup_provider_not_configured");
      }
      await adapter.deleteProviderAsset({
        providerAssetId: cleanup.providerAssetId,
        assetKind: cleanup.assetKind
      });
    }
  };
}

export function createPostgresMediaAssetCleanupRepository(
  databaseUrl?: string
): MediaAssetCleanupRepository {
  if (!databaseUrl) {
    return {
      async leaseDueCleanups() { return []; },
      async recordCleanupOutcome() {}
    };
  }
  const sql = postgres(databaseUrl, { max: 4 });
  return {
    async leaseDueCleanups(input) {
      return sql.begin(async (transaction) => {
        const rows = await transaction<{
          id: string;
          content_item_id: string;
          provider: "bunny" | "livepeer";
          provider_asset_id: string;
          asset_kind: "image" | "video";
          provider_cleanup_attempt_count: number;
        }[]>`
          select id, content_item_id, provider, provider_asset_id, asset_kind,
            provider_cleanup_attempt_count
          from media_assets
          where retired_at is not null
            and provider_cleanup_state in ('pending', 'retry')
            and provider_cleanup_next_attempt_at <= ${input.now}
            and (provider_cleanup_leased_until is null or provider_cleanup_leased_until <= ${input.now})
          order by provider_cleanup_next_attempt_at, created_at, id
          for update skip locked
          limit ${input.limit}
        `;
        const cleanups: QueuedMediaAssetCleanup[] = [];
        for (const row of rows) {
          const leaseToken = randomUUID();
          const leased = await transaction<{ id: string }[]>`
            update media_assets
            set
              provider_cleanup_lease_token = ${leaseToken},
              provider_cleanup_leased_until = ${new Date(input.now.getTime() + input.leaseDurationMs)}
            where id = ${row.id}
              and retired_at is not null
              and provider_cleanup_state in ('pending', 'retry')
            returning id
          `;
          if (!leased[0]) continue;
          cleanups.push({
            mediaAssetId: row.id,
            contentId: row.content_item_id,
            provider: row.provider,
            providerAssetId: row.provider_asset_id,
            assetKind: row.asset_kind,
            leaseToken,
            attemptCount: Number(row.provider_cleanup_attempt_count)
          });
        }
        return cleanups;
      });
    },
    async recordCleanupOutcome(input) {
      await sql.begin(async (transaction) => {
        const succeeded = input.outcome.state === "completed";
        const updated = await transaction<{ retired_by_user_id: string }[]>`
          update media_assets
          set
            provider_cleanup_state = ${succeeded ? "completed" : "retry"},
            provider_cleanup_error_code = ${succeeded ? null : input.outcome.state === "retry" ? input.outcome.errorCode : null},
            provider_cleanup_attempt_count = provider_cleanup_attempt_count + 1,
            provider_cleanup_next_attempt_at = case
              when ${succeeded} then null
              else ${new Date(input.now.getTime() + retryDelayMs(input.cleanup.attemptCount + 1))}
            end,
            provider_cleanup_lease_token = null,
            provider_cleanup_leased_until = null
          where id = ${input.cleanup.mediaAssetId}
            and provider_cleanup_lease_token = ${input.cleanup.leaseToken}
            and retired_at is not null
          returning retired_by_user_id
        `;
        const asset = updated[0];
        if (!asset) return;
        const action = succeeded
          ? "content_media_asset_cleanup_completed"
          : "content_media_asset_cleanup_retry";
        await transaction`
          insert into audit_events (
            id, actor_user_id, subject_type, subject_id, action, idempotency_key, metadata
          )
          values (
            ${randomUUID()},
            ${asset.retired_by_user_id},
            'content',
            ${input.cleanup.contentId},
            ${action},
            ${`worker:asset-cleanup:${input.cleanup.mediaAssetId}:${input.cleanup.attemptCount + 1}:${action}`},
            ${transaction.json({
              mediaAssetId: input.cleanup.mediaAssetId,
              attemptCount: input.cleanup.attemptCount + 1,
              errorCode: input.outcome.state === "retry" ? input.outcome.errorCode : null
            })}::jsonb
          )
          on conflict (actor_user_id, action, idempotency_key) where actor_user_id is not null and idempotency_key is not null
          do nothing
        `;
      });
    },
    async close() {
      await sql.end({ timeout: 5 });
    }
  };
}

function retryDelayMs(attemptCount: number): number {
  return Math.min(60 * 60 * 1000, 60_000 * 2 ** Math.min(attemptCount, 6));
}
