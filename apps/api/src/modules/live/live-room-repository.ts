import { randomUUID } from "node:crypto";
import type postgres from "postgres";
import { LiveRepositoryConfigurationError, LiveRoomIdempotencyConflictError } from "./live-errors.js";
import { toLiveRoom } from "./live-repository-mappers.js";
import type { LiveRoomRow } from "./live-repository-rows.js";
import { liveRoomSelectSql } from "./live-repository-sql.js";
import type { LiveRepository } from "./types.js";

export function createLiveRoomRepositoryMethods(
  sql: postgres.Sql
): Pick<
  LiveRepository,
  | "attachProviderRoom"
  | "createRoom"
  | "findRoom"
  | "findOwnedRoom"
  | "findOwnedRoomByIdempotency"
  | "recordLivePassPurchaseRequest"
  | "reserveRoom"
> {
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
    async reserveRoom(input) {
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
            idempotency_key,
            request_hash
          )
          select
            ${randomUUID()},
            id,
            ${input.title},
            null,
            null,
            'provider_pending',
            ${input.teaserSeconds},
            ${input.passPriceMinor},
            'SOL',
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
    async attachProviderRoom(input) {
      const rows = await sql<LiveRoomRow[]>`
        with target_user as (
          select id
          from users
          where supabase_user_id = ${input.supabaseUserId}
          limit 1
        ),
        updated_room as (
          update live_rooms lr
          set
            provider_stream_id = ${input.providerRoom.providerStreamId},
            provider_playback_id = ${input.providerRoom.providerPlaybackId},
            provider_state = ${input.providerRoom.providerState},
            host_ingest_url = ${input.providerRoom.hostIngestUrl},
            host_stream_key = ${input.providerRoom.hostStreamKey},
            playback_url = ${input.providerRoom.playbackUrl},
            updated_at = now()
          where lr.id = ${input.roomId}
            and lr.creator_user_id = (select id from target_user)
            and lr.provider_stream_id is null
          returning *
        )
        ${liveRoomSelectSql(sql)}
        join updated_room ur on ur.id = lr.id
      `;

      return rows[0] ? toLiveRoom(rows[0]) : null;
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
    }
  };
}
