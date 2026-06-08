import { randomUUID } from "node:crypto";
import type postgres from "postgres";
import type { MutualsRepository } from "./types.js";
import { MutualsIdempotencyConflictError } from "./mutuals-errors.js";
import { toInterestResult } from "./mutuals-repository-mappers.js";
import type { MutualsInterestResultRow } from "./mutuals-repository-rows.js";

export function createMutualsInterestRepositoryMethods(
  sql: postgres.Sql
): Pick<MutualsRepository, "createInterest"> {
  return {
    async createInterest(input) {
      const conversationId = randomUUID();
      const rows = await sql<MutualsInterestResultRow[]>`
        with actor as (
          select u.id
          from users u
          join mutual_profiles mp on mp.user_id = u.id
          where u.supabase_user_id = ${input.supabaseUserId}
            and mp.enabled = true
            and mp.safety_state <> 'blocked'
          limit 1
        ),
        target_profile as (
          select mp.user_id
          from mutual_profiles mp
          where mp.user_id = ${input.body.targetUserId}
            and mp.enabled = true
            and mp.safety_state = 'clear'
            and mp.user_id <> (select id from actor)
          limit 1
        ),
        target_content as (
          select ci.id
          from content_items ci
          join target_profile tp on tp.user_id = ci.creator_user_id
          where ci.id = ${input.body.contentId}
            and ci.state = 'ready'
            and ci.publish_state = 'published'
            and ci.moderation_state = 'approved'
            and ci.visibility = 'public'
          limit 1
        ),
        existing_swipe as (
          select *
          from mutual_interests mi
          where mi.actor_user_id = (select id from actor)
            and mi.idempotency_key = ${input.idempotencyKey}
          limit 1
        ),
        inserted_swipe as (
          insert into mutual_interests (
            id,
            actor_user_id,
            target_user_id,
            content_item_id,
            action,
            idempotency_key,
            request_hash
          )
          select
            ${randomUUID()},
            actor.id,
            target_profile.user_id,
            target_content.id,
            ${input.body.action},
            ${input.idempotencyKey},
            ${input.requestHash}
          from actor, target_profile, target_content
          where not exists (select 1 from existing_swipe)
          on conflict (actor_user_id, target_user_id, content_item_id) where content_item_id is not null do update
          set action = mutual_interests.action
          returning *
        ),
        selected_swipe as (
          select * from inserted_swipe
          union all
          select * from existing_swipe
          limit 1
        ),
        reciprocal_yes as (
          select mi.*
          from mutual_interests mi, selected_swipe ss
          where ss.action = 'yes'
            and mi.action = 'yes'
            and mi.actor_user_id = ss.target_user_id
            and mi.target_user_id = ss.actor_user_id
          limit 1
        ),
        created_conversation as (
          insert into conversations (id, type)
          select ${conversationId}, 'match'
          where exists (select 1 from reciprocal_yes)
          on conflict do nothing
          returning id
        ),
        inserted_match as (
          insert into mutuals (
            id,
            user_a_id,
            user_b_id,
            source_content_item_id,
            conversation_id,
            stale_at,
            expires_at
          )
          select
            ${randomUUID()},
            least(ss.actor_user_id, ss.target_user_id),
            greatest(ss.actor_user_id, ss.target_user_id),
            ss.content_item_id,
            coalesce((select id from created_conversation), ${conversationId}),
            now() + interval '7 days',
            now() + interval '30 days'
          from selected_swipe ss
          where ss.action = 'yes'
            and exists (select 1 from reciprocal_yes)
          on conflict (user_a_id, user_b_id) do update
          set state = mutuals.state
          returning *
        ),
        inserted_members as (
          insert into conversation_members (conversation_id, user_id)
          select inserted_match.conversation_id, inserted_match.user_a_id
          from inserted_match
          where inserted_match.conversation_id is not null
          union all
          select inserted_match.conversation_id, inserted_match.user_b_id
          from inserted_match
          where inserted_match.conversation_id is not null
          on conflict do nothing
        )
        select
          ss.id as swipe_id,
          ss.idempotency_key as swipe_idempotency_key,
          ss.request_hash,
          im.id as match_id,
          im.user_a_id as match_user_a_id,
          im.user_b_id as match_user_b_id,
          im.source_content_item_id as match_source_content_item_id,
          im.conversation_id as match_conversation_id,
          im.state as match_state,
          im.stale_at as match_stale_at,
          im.expires_at as match_expires_at,
          im.created_at as match_created_at
        from selected_swipe ss
        left join inserted_match im on true
        limit 1
      `;
      const row = rows[0];

      if (!row) return null;
      if (row.swipe_idempotency_key === input.idempotencyKey && row.request_hash !== input.requestHash) {
        throw new MutualsIdempotencyConflictError();
      }

      return toInterestResult(row);
    }
  };
}
