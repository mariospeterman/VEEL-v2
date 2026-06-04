import { randomUUID } from "node:crypto";
import postgres from "postgres";
import type {
  LiveChatMessage,
  LiveRepository,
  StoredLiveRoom
} from "./types.js";

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

interface LiveRoomRow {
  id: string;
  title: string;
  state: StoredLiveRoom["state"];
  access_rule: string;
  creator_user_id: string;
  creator_handle: string;
  creator_display_name: string;
  creator_avatar_url: string | null;
  provider_stream_id: string;
  provider_playback_id: string | null;
  host_ingest_url: string | null;
  host_stream_key: string | null;
  playback_url: string | null;
  teaser_seconds: number;
  pass_price_minor: number;
  currency: "SOL";
  pass_durations_minutes: number[];
  replay_content_item_id: string | null;
  request_hash?: string;
  has_active_pass: boolean;
  is_creator: boolean;
}

interface LiveChatMessageRow {
  id: string;
  room_id: string;
  body: string;
  created_at: Date;
  author_id: string;
  author_handle: string;
  author_display_name: string;
  author_avatar_url: string | null;
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
      async updateRoomStatus() {
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
              ${input.status.replayProviderAssetId ?? null},
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
        }
      });
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

function liveRoomSelectSql(sql: postgres.Sql) {
  return sql`
    select
      lr.id,
      lr.title,
      lr.state,
      lr.access_rule,
      lr.creator_user_id,
      p.handle as creator_handle,
      p.display_name as creator_display_name,
      p.avatar_url as creator_avatar_url,
      lr.provider_stream_id,
      lr.provider_playback_id,
      lr.host_ingest_url,
      lr.host_stream_key,
      lr.playback_url,
      lr.teaser_seconds,
      lr.pass_price_minor,
      lr.currency,
      lr.pass_durations_minutes,
      lr.replay_content_item_id,
      lr.request_hash,
      exists (
        select 1
        from live_passes lp
        where lp.room_id = lr.id
          and lp.user_id = (select id from target_user)
          and lp.state = 'active'
          and lp.starts_at <= now()
          and lp.expires_at > now()
      ) as has_active_pass,
      lr.creator_user_id = (select id from target_user) as is_creator
    from live_rooms lr
    join users creator on creator.id = lr.creator_user_id
    join profiles p on p.user_id = creator.id
  `;
}

function toLiveRoom(row: LiveRoomRow): StoredLiveRoom {
  const passActive = row.has_active_pass || row.is_creator;
  const isPlayable = row.state === "live" && Boolean(row.playback_url);
  const room: StoredLiveRoom = {
    id: row.id,
    title: row.title,
    creator: {
      id: row.creator_user_id,
      handle: row.creator_handle,
      displayName: row.creator_display_name,
      avatarUrl: row.creator_avatar_url,
      badges: []
    },
    state: row.state,
    accessState: passActive ? "pass_active" : "pass_required",
    playback:
      isPlayable && passActive
        ? {
            state: "full",
            url: row.playback_url,
            provider: "livepeer"
          }
        : {
            state: isPlayable ? "blocked" : "not_ready",
            url: null,
            provider: "livepeer"
          },
    teaserSecondsRemaining: passActive ? null : row.teaser_seconds,
    passOptions: row.pass_durations_minutes.map((durationMinutes) => ({
      durationMinutes: durationMinutes as 30 | 60 | 180,
      amountMinor: Number(row.pass_price_minor),
      currency: row.currency
    })),
    chat: {
      enabled: row.state === "live",
      accessState: row.state === "live" ? (passActive ? "allowed" : "pass_required") : "closed"
    },
    replayContentId: row.replay_content_item_id,
    providerStreamId: row.provider_stream_id,
    providerPlaybackId: row.provider_playback_id,
    hostIngestUrl: row.host_ingest_url,
    hostStreamKey: row.host_stream_key
  };

  if (row.request_hash) {
    room.requestHash = row.request_hash;
  }

  return room;
}

function toLiveChatMessage(row: LiveChatMessageRow): LiveChatMessage {
  return {
    id: row.id,
    roomId: row.room_id,
    author: {
      id: row.author_id,
      handle: row.author_handle,
      displayName: row.author_display_name,
      avatarUrl: row.author_avatar_url,
      badges: []
    },
    body: row.body,
    createdAt: row.created_at.toISOString()
  };
}
