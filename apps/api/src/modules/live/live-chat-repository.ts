import { randomUUID } from "node:crypto";
import type postgres from "postgres";
import { LiveChatIdempotencyConflictError } from "./live-errors.js";
import { toLiveChatMessage } from "./live-repository-mappers.js";
import type { LiveChatMessageRow } from "./live-repository-rows.js";
import type { FindLiveRoomInput, LiveRepository } from "./types.js";

export function createLiveChatRepositoryMethods(
  sql: postgres.Sql,
  findRoom: LiveRepository["findRoom"]
): Pick<LiveRepository, "createChatMessage" | "listChatMessages"> {
  return {
    async listChatMessages(input: FindLiveRoomInput) {
      const room = await findRoom(input);

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
      const rows = await sql<LiveChatMessageRow[]>`
        with actor as (
          select id
          from users
          where supabase_user_id = ${input.supabaseUserId} and state = 'active'
          limit 1
        ),
        existing_message as (
          select lcm.*
          from live_chat_messages lcm
          where lcm.user_id = (select id from actor)
            and lcm.idempotency_key = ${input.idempotencyKey}
          limit 1
        ),
        eligible_actor as (
          select actor.id
          from actor
          join live_rooms lr on lr.id = ${input.roomId}
          join users creator on creator.id = lr.creator_user_id and creator.state = 'active'
          where lr.state = 'live'
            and exists (
              select 1
              from media_safety_cases safety
              where safety.live_room_id = lr.id
                and safety.state = 'approved'
                and safety.provider_release_allowed is true
            )
            and not exists (
              select 1 from blocks b
              where (b.blocker_user_id = actor.id and b.blocked_user_id = lr.creator_user_id)
                 or (b.blocker_user_id = lr.creator_user_id and b.blocked_user_id = actor.id)
            )
            and (
              actor.id = lr.creator_user_id
              or lr.access_rule = 'public'
              or exists (
                select 1 from subscriptions s
                where s.subscriber_user_id = actor.id
                  and s.creator_user_id = lr.creator_user_id
                  and s.scope = 'creator'
                  and s.state in ('active', 'renewal_pending', 'grace_period')
                  and (s.current_period_ends_at is null or s.current_period_ends_at > now())
              )
              or exists (
                select 1 from live_passes lp
                where lp.room_id = lr.id and lp.user_id = actor.id
                  and lp.state = 'active' and lp.starts_at <= now()
                  and (lp.expires_at is null or lp.expires_at > now())
              )
            )
            and (
              not lr.members_only_chat
              or actor.id = lr.creator_user_id
              or exists (
                select 1 from subscriptions s
                where s.subscriber_user_id = actor.id
                  and s.creator_user_id = lr.creator_user_id
                  and s.scope = 'creator'
                  and s.state in ('active', 'renewal_pending', 'grace_period')
                  and (s.current_period_ends_at is null or s.current_period_ends_at > now())
              )
            )
        ),
        inserted_message as (
          insert into live_chat_messages (
            id,
            room_id,
            user_id,
            body,
            idempotency_key,
            request_hash
          )
          select
            ${randomUUID()},
            ${input.roomId},
            id,
            ${input.body},
            ${input.idempotencyKey},
            ${input.requestHash}
          from eligible_actor
          where not exists (select 1 from existing_message)
          returning *
        ),
        selected_message as (
          select * from inserted_message
          union all
          select * from existing_message
          limit 1
        )
        select
          im.id, im.room_id, im.body, im.created_at, im.request_hash,
          u.id as author_id,
          p.handle as author_handle,
          p.display_name as author_display_name,
          p.avatar_url as author_avatar_url
        from selected_message im
        join users u on u.id = im.user_id
        join profiles p on p.user_id = u.id
      `;

      if (rows[0]?.request_hash && rows[0].request_hash !== input.requestHash) {
        throw new LiveChatIdempotencyConflictError();
      }

      return rows[0] ? toLiveChatMessage(rows[0]) : null;
    }
  };
}
