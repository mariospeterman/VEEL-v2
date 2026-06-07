import { randomUUID } from "node:crypto";
import type postgres from "postgres";
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
      const room = await findRoom(input);

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
    }
  };
}
