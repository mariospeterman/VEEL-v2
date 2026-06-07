import { randomUUID } from "node:crypto";
import type postgres from "postgres";
import { ensureLiveReplayContent } from "./live-replay-repository.js";
import type { LiveRepository } from "./types.js";

export function createLiveStatusRepositoryMethods(
  sql: postgres.Sql
): Pick<LiveRepository, "recordLiveProviderWebhook" | "updateRoomFromWebhook" | "updateRoomStatus"> {
  return {
    async updateRoomStatus(input) {
      await sql.begin(async (transaction) => {
        await transaction`
          update live_rooms
          set
            provider_stream_id = ${input.status.providerStreamId},
            provider_playback_id = ${input.status.providerPlaybackId},
            provider_state = ${input.status.providerState},
            state = ${input.status.state},
            playback_url = ${input.status.playbackUrl},
            starts_at = case when ${input.status.state} = 'live' then coalesce(starts_at, now()) else starts_at end,
            ended_at = case when ${input.status.state} in ('ended', 'replay_ready') then coalesce(ended_at, now()) else ended_at end,
            updated_at = now()
          where id = ${input.roomId}
        `;

        if (input.status.replayProviderAssetId || input.status.replayProviderPlaybackId) {
          const replayProviderAssetId =
            input.status.replayProviderAssetId ?? input.status.replayProviderPlaybackId;

          await transaction`
            insert into live_replay_assets (
              id,
              room_id,
              provider_asset_id,
              provider_playback_id,
              state,
              playback_url,
              ready_at
            )
            values (
              ${randomUUID()},
              ${input.roomId},
              ${replayProviderAssetId ?? null},
              ${input.status.replayProviderPlaybackId ?? null},
              ${input.status.state === "replay_ready" ? "ready" : "processing"},
              ${input.status.replayPlaybackUrl ?? null},
              ${input.status.state === "replay_ready" ? new Date() : null}
            )
            on conflict (room_id, provider_asset_id) do update
            set
              provider_playback_id = excluded.provider_playback_id,
              state = excluded.state,
              playback_url = excluded.playback_url,
              ready_at = excluded.ready_at
          `;

          if (input.status.state === "replay_ready" && replayProviderAssetId) {
            await ensureLiveReplayContent(transaction, {
              roomId: input.roomId,
              providerAssetId: replayProviderAssetId,
              providerPlaybackId: input.status.replayProviderPlaybackId,
              playbackUrl: input.status.replayPlaybackUrl
            });
          }
        }
      });
    },
    async recordLiveProviderWebhook(input) {
      const insertedReceipts = await sql<{ id: string }[]>`
        insert into provider_webhook_receipts (
          id,
          provider,
          webhook_type,
          signature_hash,
          idempotency_key
        )
        values (
          ${randomUUID()},
          'livepeer',
          'media-status',
          ${input.signatureHash ?? null},
          ${input.providerEventId}
        )
        on conflict (provider, webhook_type, idempotency_key) do nothing
        returning id
      `;

      if (insertedReceipts.length === 0) {
        return false;
      }

      await sql`
        insert into provider_events (
          id,
          provider,
          provider_event_id,
          event_type,
          normalized_state
        )
        values (
          ${randomUUID()},
          'livepeer',
          ${input.providerEventId},
          ${input.eventType},
          ${input.normalizedState}
        )
        on conflict (provider, provider_event_id) do nothing
      `;

      return true;
    },
    async updateRoomFromWebhook(input) {
      const rows = await sql.begin(async (transaction) => {
        const updated = await transaction<{ id: string }[]>`
          update live_rooms
          set
            provider_playback_id = coalesce(${input.providerPlaybackId}, provider_playback_id),
            provider_state = ${input.providerState},
            state = ${input.state},
            playback_url = coalesce(${input.playbackUrl}, playback_url),
            starts_at = case when ${input.state} = 'live' then coalesce(starts_at, now()) else starts_at end,
            ended_at = case when ${input.state} in ('ended', 'replay_ready') then coalesce(ended_at, now()) else ended_at end,
            updated_at = now()
          where provider_stream_id = ${input.providerStreamId}
          returning id
        `;
        const roomId = updated[0]?.id;

        if (roomId && input.state === "replay_ready" && input.providerPlaybackId) {
          await ensureLiveReplayContent(transaction, {
            roomId,
            providerAssetId: input.providerPlaybackId,
            providerPlaybackId: input.providerPlaybackId,
            playbackUrl: input.playbackUrl
          });
        }

        await transaction`
          update provider_events
          set
            normalized_state = ${input.providerState},
            processed_at = now()
          where provider = 'livepeer'
            and provider_event_id = ${input.providerEventId}
        `;

        return updated;
      });

      return rows.length > 0;
    }
  };
}
