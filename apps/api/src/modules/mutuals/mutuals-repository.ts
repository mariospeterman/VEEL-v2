import postgres from "postgres";
import type { MutualsRepository } from "./types.js";
import { MutualsRepositoryConfigurationError } from "./mutuals-errors.js";
import { createMutualsInterestRepositoryMethods } from "./mutuals-interest-repository.js";
import {
  toMutual,
  toMutualsFeedItem,
  toMutualsProfile
} from "./mutuals-repository-mappers.js";
import type { MutualRow, MutualsFeedRow, MutualsProfileRow } from "./mutuals-repository-rows.js";

export {
  MutualsIdempotencyConflictError,
  MutualsRepositoryConfigurationError
} from "./mutuals-errors.js";

export function createPostgresMutualsRepository(databaseUrl?: string): MutualsRepository {
  if (!databaseUrl) {
    return {
      async activate() {
        throw new MutualsRepositoryConfigurationError();
      },
      async updatePreferences() {
        throw new MutualsRepositoryConfigurationError();
      },
      async listFeed() {
        throw new MutualsRepositoryConfigurationError();
      },
      async createInterest() {
        throw new MutualsRepositoryConfigurationError();
      },
      async listMutuals() {
        throw new MutualsRepositoryConfigurationError();
      },
      async archiveMutual() {
        throw new MutualsRepositoryConfigurationError();
      }
    };
  }

  const sql = postgres(databaseUrl, {
    max: 5,
    idle_timeout: 20,
    prepare: false
  });

  return {
    async activate(input) {
      const rows = await sql<MutualsProfileRow[]>`
        with actor as (
          select id
          from users
          where supabase_user_id = ${input.supabaseUserId}
          limit 1
        )
        insert into mutual_profiles (
          user_id,
          enabled,
          consent_version,
          active_match_limit,
          visible_on_media
        )
        select
          id,
          true,
          ${input.consentVersion},
          10,
          true
        from actor
        on conflict (user_id) do update
        set
          enabled = true,
          consent_version = excluded.consent_version,
          updated_at = now()
        returning *
      `;

      return toMutualsProfile(rows[0]);
    },
    async updatePreferences(input) {
      const rows = await sql<MutualsProfileRow[]>`
        with actor as (
          select id
          from users
          where supabase_user_id = ${input.supabaseUserId}
          limit 1
        )
        update mutual_profiles mp
        set
          enabled = coalesce(${input.body.enabled ?? null}, enabled),
          active_match_limit = coalesce(${input.body.activeMatchLimit ?? null}, active_match_limit),
          updated_at = now()
        from actor
        where mp.user_id = actor.id
        returning mp.*
      `;

      return rows[0] ? toMutualsProfile(rows[0]) : null;
    },
    async listFeed(input) {
      const rows = await sql<MutualsFeedRow[]>`
        with actor as (
          select u.id
          from users u
          join mutual_profiles mp on mp.user_id = u.id
          where u.supabase_user_id = ${input.supabaseUserId}
            and mp.enabled = true
            and mp.safety_state <> 'blocked'
          limit 1
        )
        select
          ci.id as content_id,
          ci.creator_user_id,
          p.handle,
          p.display_name,
          p.avatar_url,
          ci.caption as title,
          ci.media_kind,
          ma.poster_url,
          ci.created_at
        from content_items ci
        join mutual_profiles creator_mutuals
          on creator_mutuals.user_id = ci.creator_user_id
          and creator_mutuals.enabled = true
          and creator_mutuals.visible_on_media = true
          and creator_mutuals.safety_state = 'clear'
        join profiles p on p.user_id = ci.creator_user_id
        left join media_assets ma on ma.content_item_id = ci.id
        where exists (select 1 from actor)
          and ci.state = 'published'
          and ci.visibility = 'public'
          and ci.creator_user_id <> (select id from actor)
          and (${input.cursor ?? null}::timestamptz is null or ci.created_at < ${input.cursor ?? null}::timestamptz)
          and not exists (
            select 1
            from mutual_interests mi
            where mi.actor_user_id = (select id from actor)
              and mi.target_user_id = ci.creator_user_id
              and (mi.content_item_id = ci.id or mi.content_item_id is null)
          )
        order by ci.created_at desc
        limit ${input.limit + 1}
      `;

      if (rows.length === 0) {
        const active = await hasActiveMutualsProfile(sql, input.supabaseUserId);
        if (!active) return null;
      }

      const pageRows = rows.slice(0, input.limit);
      const extraRow = rows[input.limit];

      return {
        items: pageRows.map(toMutualsFeedItem),
        nextCursor: extraRow ? extraRow.created_at.toISOString() : null
      };
    },
    ...createMutualsInterestRepositoryMethods(sql),
    async listMutuals(input) {
      const rows = await sql<MutualRow[]>`
        with actor as (
          select id
          from users
          where supabase_user_id = ${input.supabaseUserId}
          limit 1
        )
        select
          id,
          user_a_id,
          user_b_id,
          source_content_item_id,
          conversation_id,
          state,
          stale_at,
          expires_at,
          created_at
        from mutuals
        where (user_a_id = (select id from actor) or user_b_id = (select id from actor))
          and state in ('active', 'stale')
          and (${input.cursor ?? null}::timestamptz is null or created_at < ${input.cursor ?? null}::timestamptz)
        order by created_at desc
        limit ${input.limit + 1}
      `;

      const pageRows = rows.slice(0, input.limit);
      const extraRow = rows[input.limit];

      return {
        items: pageRows.map(toMutual),
        nextCursor: extraRow ? extraRow.created_at.toISOString() : null
      };
    },
    async archiveMutual(input) {
      const rows = await sql<MutualRow[]>`
        with actor as (
          select id
          from users
          where supabase_user_id = ${input.supabaseUserId}
          limit 1
        )
        update mutuals m
        set
          state = 'archived',
          archived_by_user_id = (select id from actor),
          updated_at = now()
        where m.id = ${input.mutualId}
          and (m.user_a_id = (select id from actor) or m.user_b_id = (select id from actor))
          and m.state in ('active', 'stale')
        returning
          id,
          user_a_id,
          user_b_id,
          source_content_item_id,
          conversation_id,
          state,
          stale_at,
          expires_at,
          created_at
      `;

      return rows[0] ? toMutual(rows[0]) : null;
    },
    async close() {
      await sql.end({ timeout: 5 });
    }
  };
}

async function hasActiveMutualsProfile(sql: postgres.Sql, supabaseUserId: string): Promise<boolean> {
  const rows = await sql<{ exists: boolean }[]>`
    select exists (
      select 1
      from users u
      join mutual_profiles mp on mp.user_id = u.id
      where u.supabase_user_id = ${supabaseUserId}
        and mp.enabled = true
    )
  `;

  return rows[0]?.exists ?? false;
}
