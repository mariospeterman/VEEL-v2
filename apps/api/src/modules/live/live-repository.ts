import { randomUUID } from "node:crypto";
import postgres from "postgres";
import type { LiveRepository } from "./types.js";
import { toLiveChatMessage, toLiveRoom } from "./live-repository-mappers.js";
import type { LiveChatMessageRow, LiveRoomRow } from "./live-repository-rows.js";
import { liveRoomSelectSql } from "./live-repository-sql.js";
import { ensureLiveReplayContent } from "./live-replay-repository.js";

export class LiveRepositoryConfigurationError extends Error {
  constructor() {
    super("DATABASE_URL_NOT_CONFIGURED");
    this.name = "LiveRepositoryConfigurationError";
  }
}

export class LiveRoomIdempotencyConflictError extends Error {
  constructor() {
    super("LIVE_ROOM_IDEMPOTENCY_CONFLICT");
    this.name = "LiveRoomIdempotencyConflictError";
  }
}

export function createPostgresLiveRepository(databaseUrl?: string): LiveRepository {
  if (!databaseUrl) {
    return {
      async createRoom() {
        throw new LiveRepositoryConfigurationError();
      },
      async findRoom() {
        throw new LiveRepositoryConfigurationError();
      },
      async findOwnedRoom() {
        throw new LiveRepositoryConfigurationError();
      },
      async findOwnedRoomByIdempotency() {
        throw new LiveRepositoryConfigurationError();
      },
      async recordLivePassPurchaseRequest() {
        throw new LiveRepositoryConfigurationError();
      },
      async recordLiveProviderWebhook() {
        throw new LiveRepositoryConfigurationError();
      },
      async updateRoomStatus() {
        throw new LiveRepositoryConfigurationError();
      },
      async updateRoomFromWebhook() {
        throw new LiveRepositoryConfigurationError();
      },
      async listChatMessages() {
        throw new LiveRepositoryConfigurationError();
      },
      async createChatMessage() {
        throw new LiveRepositoryConfigurationError();
      }
    };
  }

  const sql = postgres(databaseUrl, {
    max: 5,
    idle_timeout: 20,
    prepare: false
  });

  return {
    async createRoom(input) {
      const rows = await sql<LiveRoomRow[]>`
        with target_user as (
          select id
          from users
          where supabase_user_id = ${input.supabaseUserId}
          limit 1
        ),
        existing_room as (
          select lr.*
          from live_rooms lr
          join target_user tu on tu.id = lr.creator_user_id
          where lr.idempotency_key = ${input.idempotencyKey}
          limit 1
        ),
        inserted_room as (
          insert into live_rooms (
            id,
            creator_user_id,
            title,
            provider_stream_id,
            provider_playback_id,
            provider_state,
            teaser_seconds,
            pass_price_minor,
            currency,
            host_ingest_url,
            host_stream_key,
            playback_url,
            idempotency_key,
            request_hash
          )
          select
            ${randomUUID()},
            id,
            ${input.title},
            ${input.providerRoom.providerStreamId},
            ${input.providerRoom.providerPlaybackId},
            ${input.providerRoom.providerState},
            ${input.teaserSeconds},
            ${input.passPriceMinor},
            'SOL',
            ${input.providerRoom.hostIngestUrl},
            ${input.providerRoom.hostStreamKey},
            ${input.providerRoom.playbackUrl},
            ${input.idempotencyKey},
            ${input.requestHash}
          from target_user
          where not exists (select 1 from existing_room)
          returning *
        ),
        selected_room as (
          select * from inserted_room
          union all
          select * from existing_room
          limit 1
        )
        ${liveRoomSelectSql(sql)}
        join selected_room sr on sr.id = lr.id
      `;
      const row = rows[0];

      if (!row) {
        throw new LiveRepositoryConfigurationError();
      }

      if (row.request_hash !== input.requestHash) {
        throw new LiveRoomIdempotencyConflictError();
      }

      return toLiveRoom(row);
    },
    async findRoom(input) {
      const rows = await sql<LiveRoomRow[]>`
        with target_user as (
          select id
          from users
          where supabase_user_id = ${input.supabaseUserId}
          limit 1
        )
        ${liveRoomSelectSql(sql)}
        where lr.id = ${input.roomId}
        limit 1
      `;

      return rows[0] ? toLiveRoom(rows[0]) : null;
    },
    async findOwnedRoom(input) {
      const rows = await sql<LiveRoomRow[]>`
        with target_user as (
          select id
          from users
          where supabase_user_id = ${input.supabaseUserId}
          limit 1
        )
        ${liveRoomSelectSql(sql)}
        where lr.id = ${input.roomId}
          and lr.creator_user_id = (select id from target_user)
        limit 1
      `;

      return rows[0] ? toLiveRoom(rows[0]) : null;
    },
    async findOwnedRoomByIdempotency(input) {
      const rows = await sql<LiveRoomRow[]>`
        with target_user as (
          select id
          from users
          where supabase_user_id = ${input.supabaseUserId}
          limit 1
        )
        ${liveRoomSelectSql(sql)}
        where lr.idempotency_key = ${input.idempotencyKey}
          and lr.creator_user_id = (select id from target_user)
        limit 1
      `;

      return rows[0] ? toLiveRoom(rows[0]) : null;
    },
    async recordLivePassPurchaseRequest(input) {
      await sql`
        with buyer as (
          select id
          from users
          where supabase_user_id = ${input.supabaseUserId}
          limit 1
        )
        insert into live_pass_purchase_requests (
          payment_intent_id,
          room_id,
          buyer_user_id,
          duration_minutes,
          amount_minor,
          currency
        )
        select
          ${input.paymentIntentId},
          ${input.roomId},
          id,
          ${input.durationMinutes},
          ${input.amountMinor},
          ${input.currency}
        from buyer
        on conflict (payment_intent_id) do nothing
      `;
    },
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
    },
    async listChatMessages(input) {
      const room = await this.findRoom(input);

      if (!room) {
        return null;
      }

      if (room.chat.accessState !== "allowed") {
        return { items: [] };
      }

      const rows = await sql<LiveChatMessageRow[]>`
        select
          lcm.id,
          lcm.room_id,
          lcm.body,
          lcm.created_at,
          u.id as author_id,
          p.handle as author_handle,
          p.display_name as author_display_name,
          p.avatar_url as author_avatar_url
        from live_chat_messages lcm
        join users u on u.id = lcm.user_id
        join profiles p on p.user_id = u.id
        where lcm.room_id = ${input.roomId}
          and lcm.state = 'visible'
        order by lcm.created_at desc
        limit 50
      `;

      return {
        items: rows.reverse().map(toLiveChatMessage)
      };
    },
    async createChatMessage(input) {
      const room = await this.findRoom(input);

      if (!room || room.chat.accessState !== "allowed") {
        return null;
      }

      const rows = await sql<LiveChatMessageRow[]>`
        with actor as (
          select id
          from users
          where supabase_user_id = ${input.supabaseUserId}
          limit 1
        ),
        inserted_message as (
          insert into live_chat_messages (
            id,
            room_id,
            user_id,
            body
          )
          select
            ${randomUUID()},
            ${input.roomId},
            id,
            ${input.body}
          from actor
          returning *
        )
        select
          im.id,
          im.room_id,
          im.body,
          im.created_at,
          u.id as author_id,
          p.handle as author_handle,
          p.display_name as author_display_name,
          p.avatar_url as author_avatar_url
        from inserted_message im
        join users u on u.id = im.user_id
        join profiles p on p.user_id = u.id
      `;

      return rows[0] ? toLiveChatMessage(rows[0]) : null;
    },
    async close() {
      await sql.end({ timeout: 5 });
    }
  };
}
