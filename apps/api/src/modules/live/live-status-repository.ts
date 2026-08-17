import { randomUUID } from "node:crypto";
import type postgres from "postgres";
import { providerEventReplayDecision } from "../../shared/provider-event-order.js";
import { ensureLiveReplayContent } from "./live-replay-repository.js";
import type { LiveRepository } from "./types.js";

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
type JsonObject = { [key: string]: JsonValue };

export function createLiveStatusRepositoryMethods(
  sql: postgres.Sql
): Pick<LiveRepository, "recordLiveProviderWebhook" | "updateRoomFromWebhook" | "updateRoomStatus"> {
  return {
    async updateRoomStatus(input) {
      await sql.begin(async (transaction) => {
        const updatedRooms = await transaction<{ id: string }[]>`
          update live_rooms
          set
            provider_stream_id = ${input.status.providerStreamId},
            provider_playback_id = ${input.status.providerPlaybackId},
            provider_state = ${input.status.providerState},
            state = ${input.status.state},
            playback_url = case when ${input.status.state} = 'live' then ${input.status.playbackUrl} else null end,
            starts_at = case when ${input.status.state} = 'live' then coalesce(starts_at, now()) else starts_at end,
            ended_at = case when ${input.status.state} in ('ended', 'replay_ready') then coalesce(ended_at, now()) else ended_at end,
            provider_checked_at = ${input.providerObservedAt},
            updated_at = now()
          where id = ${input.roomId}
            and state <> 'suspended'
            and not exists (
              select 1
              from provider_events newer
              where newer.provider = 'livepeer'
                and newer.received_at > ${input.providerObservedAt}
                and newer.normalized_state is distinct from 'ignored_stale'
                and newer.replay_payload ->> 'kind' = 'livepeer_stream'
                and newer.replay_payload ->> 'providerStreamId' = live_rooms.provider_stream_id
            )
            and (
              state in ('scheduled', 'waiting')
              or (state = 'live' and ${input.status.state} in ('live', 'ended', 'replay_ready'))
              or (state = 'ended' and ${input.status.state} in ('ended', 'replay_ready'))
              or (state = 'replay_ready' and ${input.status.state} = 'replay_ready')
            )
          returning id
        `;

        if (updatedRooms.length === 0) return;

        if (input.status.state === "ended" || input.status.state === "replay_ready") {
          await closeLiveEventAccessWindow(transaction, input.roomId);
        }

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
      return sql.begin(async (transaction) => {
        await transaction`
          insert into provider_webhook_receipts (
            id, provider, webhook_type, signature_hash, idempotency_key
          )
          values (
            ${randomUUID()}, 'livepeer', 'media-status', ${input.signatureHash ?? null},
            ${input.providerEventId}
          )
          on conflict (provider, webhook_type, idempotency_key) do nothing
        `;

        const events = await transaction<{ processed_at: Date | null }[]>`
          insert into provider_events (
            id, provider, provider_event_id, event_type, normalized_state, replay_payload
          )
          values (
            ${randomUUID()}, 'livepeer', ${input.providerEventId}, ${input.eventType},
            ${input.normalizedState}, ${transaction.json(toJsonObject(input.replayPayload ?? {}))}
          )
          on conflict (provider, provider_event_id) do update
          set provider_event_id = excluded.provider_event_id
          returning processed_at
        `;

        return events[0]?.processed_at === null;
      });
    },
    async updateRoomFromWebhook(input) {
      const rows = await sql.begin(async (transaction) => {
        const currentRows = await transaction<{ id: string; provider_checked_at: Date | null; state: string }[]>`
          select id, provider_checked_at, state
          from live_rooms
          where provider_stream_id = ${input.providerStreamId}
          limit 1
          for update
        `;
        const current = currentRows[0];

        if (!current) {
          return [] as { id: string }[];
        }

        const replayDecision = !input.preventStateRegression ? "apply" : await providerEventReplayDecision(
          transaction,
          {
            provider: "livepeer",
            providerEventId: input.providerEventId,
            subject: { kind: "livepeer_stream", providerStreamId: input.providerStreamId },
            subjectObservedAt: current.provider_checked_at
          }
        );

        if (replayDecision === "already_applied") {
          return [{ id: current.id }];
        }

        if (replayDecision === "stale" || !isAllowedWebhookTransition(current.state, input.state)) {
          await transaction`
            update provider_events
            set normalized_state = 'ignored_stale', processed_at = now()
            where provider = 'livepeer' and provider_event_id = ${input.providerEventId}
          `;
          return [{ id: current.id }];
        }

        const updated = await transaction<{ id: string }[]>`
          update live_rooms
          set
            provider_playback_id = case
              when ${input.state} in ('waiting', 'live') then coalesce(${input.providerPlaybackId}, provider_playback_id)
              else provider_playback_id
            end,
            provider_state = ${input.providerState},
            state = ${input.state},
            playback_url = case when ${input.state} = 'live' then ${input.playbackUrl} else null end,
            starts_at = case when ${input.state} = 'live' then coalesce(starts_at, now()) else starts_at end,
            ended_at = case when ${input.state} in ('ended', 'replay_ready') then coalesce(ended_at, now()) else ended_at end,
            updated_at = now()
          where id = ${current.id}
          returning id
        `;
        const roomId = updated[0]?.id;

        if (roomId && (input.state === "ended" || input.state === "replay_ready")) {
          await closeLiveEventAccessWindow(transaction, roomId);
        }

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

async function closeLiveEventAccessWindow(
  transaction: postgres.TransactionSql,
  roomId: string
): Promise<void> {
  await transaction`
    with access_window as (
      select
        id,
        ended_at + make_interval(hours => replay_window_hours) as expires_at
      from live_rooms
      where id = ${roomId}
        and access_rule = 'paid_event'
        and ended_at is not null
    ),
    updated_passes as (
      update live_passes lp
      set expires_at = aw.expires_at
      from access_window aw
      where lp.room_id = aw.id
        and lp.state = 'active'
      returning lp.payment_intent_id, lp.expires_at
    )
    update entitlements e
    set ends_at = up.expires_at
    from updated_passes up
    where e.payment_intent_id = up.payment_intent_id
      and e.product_type = 'live_pass'
  `;
}

function toJsonObject(value: Record<string, unknown>): JsonObject {
  return JSON.parse(JSON.stringify(value)) as JsonObject;
}

function isAllowedWebhookTransition(current: string, next: string): boolean {
  if (current === "suspended") return false;
  if (current === "scheduled" || current === "waiting") return true;
  if (current === "live") return next === "live" || next === "ended" || next === "replay_ready";
  if (current === "ended") return next === "ended" || next === "replay_ready";
  if (current === "replay_ready") return next === "replay_ready";
  return false;
}
