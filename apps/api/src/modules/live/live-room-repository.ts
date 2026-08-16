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
  | "claimProviderCreation"
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
            access_rule,
            preview_seconds,
            event_price_minor,
            currency,
            members_only_chat,
            members_included_in_paid_event,
            replay_window_hours,
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
            ${input.accessMode},
            ${input.previewSeconds},
            ${input.eventPriceMinor},
            'SOL',
            ${input.membersOnlyChat},
            ${input.membersIncludedInPaidEvent},
            ${input.replayWindowHours},
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
        ),
        inserted_safety as (
          insert into media_safety_cases (
            live_room_id,
            declared_rating,
            state,
            decision_source,
            reason_code,
            policy_version,
            provider_release_allowed,
            evidence_summary,
            decided_at
          )
          select
            sr.id,
            'none',
            'approved',
            'automated',
            'creator_sfw_attestation',
            'sfw-live-v1',
            true,
            ${sql.json({ attestation: "this_live_stream_is_sfw" })},
            now()
          from selected_room sr
          where not exists (
            select 1
            from media_safety_cases existing
            where existing.live_room_id = sr.id
              and existing.state <> 'superseded'
          )
          returning id, live_room_id
        ),
        target_safety as (
          select id, live_room_id from inserted_safety
          union all
          select existing.id, existing.live_room_id
          from media_safety_cases existing
          join selected_room sr on sr.id = existing.live_room_id
          where existing.state <> 'superseded'
          limit 1
        ),
        inserted_job as (
          insert into media_moderation_jobs (
            media_safety_case_id,
            live_room_id,
            stage,
            state,
            idempotency_key
          )
          select
            ts.id,
            ts.live_room_id,
            'live_monitoring',
            'queued',
            'media-safety:live:' || ts.live_room_id::text || ':monitor-v1'
          from target_safety ts
          on conflict (idempotency_key) do nothing
          returning id
        )
        ${liveRoomSelectSql(sql)}
        join selected_room sr on sr.id = lr.id
        cross join (select count(*) from inserted_job) job_effect
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
            access_rule,
            preview_seconds,
            event_price_minor,
            currency,
            members_only_chat,
            members_included_in_paid_event,
            replay_window_hours,
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
            ${input.accessMode},
            ${input.previewSeconds},
            ${input.eventPriceMinor},
            'SOL',
            ${input.membersOnlyChat},
            ${input.membersIncludedInPaidEvent},
            ${input.replayWindowHours},
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
        ),
        inserted_safety as (
          insert into media_safety_cases (
            live_room_id,
            declared_rating,
            state,
            decision_source,
            reason_code,
            policy_version,
            provider_release_allowed,
            evidence_summary,
            decided_at
          )
          select
            sr.id,
            'none',
            'approved',
            'automated',
            'creator_sfw_attestation',
            'sfw-live-v1',
            true,
            ${sql.json({ attestation: "this_live_stream_is_sfw" })},
            now()
          from selected_room sr
          where not exists (
            select 1
            from media_safety_cases existing
            where existing.live_room_id = sr.id
              and existing.state <> 'superseded'
          )
          returning id, live_room_id
        ),
        target_safety as (
          select id, live_room_id from inserted_safety
          union all
          select existing.id, existing.live_room_id
          from media_safety_cases existing
          join selected_room sr on sr.id = existing.live_room_id
          where existing.state <> 'superseded'
          limit 1
        ),
        inserted_job as (
          insert into media_moderation_jobs (
            media_safety_case_id,
            live_room_id,
            stage,
            state,
            idempotency_key
          )
          select
            ts.id,
            ts.live_room_id,
            'live_monitoring',
            'queued',
            'media-safety:live:' || ts.live_room_id::text || ':monitor-v1'
          from target_safety ts
          on conflict (idempotency_key) do nothing
          returning id
        )
        ${liveRoomSelectSql(sql)}
        join selected_room sr on sr.id = lr.id
        cross join (select count(*) from inserted_job) job_effect
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
    async claimProviderCreation(input) {
      const rows = await sql<{ id: string }[]>`
        with target_user as (
          select id from users where supabase_user_id = ${input.supabaseUserId} limit 1
        )
        update live_rooms
        set
          provider_creation_claim_id = ${input.claimId},
          provider_creation_claim_expires_at = now() + interval '10 minutes',
          provider_creation_attempt_count = provider_creation_attempt_count + 1,
          updated_at = now()
        where id = ${input.roomId}
          and creator_user_id = (select id from target_user)
          and provider_stream_id is null
          and state in ('scheduled', 'waiting')
          and (
            provider_creation_claim_id is null
            or provider_creation_claim_expires_at <= now()
          )
        returning id
      `;
      return Boolean(rows[0]);
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
            provider_creation_claim_id = null,
            provider_creation_claim_expires_at = null,
            updated_at = now()
          where lr.id = ${input.roomId}
            and lr.creator_user_id = (select id from target_user)
            and lr.provider_stream_id is null
            and lr.provider_creation_claim_id = ${input.claimId}
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
        ${liveRoomSelectSql(sql, { includeHostSecrets: true })}
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
          amount_minor,
          currency
        )
        select
          ${input.paymentIntentId},
          ${input.roomId},
          id,
          ${input.amountMinor},
          ${input.currency}
        from buyer
        on conflict (payment_intent_id) do nothing
      `;
    }
  };
}
