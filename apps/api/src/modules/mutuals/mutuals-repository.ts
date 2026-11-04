import type postgres from "postgres";
import {
  decodeTimestampIdCursor,
  encodeTimestampIdCursor,
  keysetPage
} from "../../shared/keyset-pagination.js";
import { resolvePostgresClient, type PostgresSql } from "../../shared/postgres.js";
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

export const mutualsFeedCursorScope = "GET /v1/mutuals/feed";
export const mutualsListCursorScope = "GET /v1/mutuals";

export function createPostgresMutualsRepository(database?: string | PostgresSql): MutualsRepository {
  if (!database) {
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

  const { sql, ownsClient } = resolvePostgresClient(database);

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
      const cursor = decodeTimestampIdCursor(mutualsFeedCursorScope, input.cursor);
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
          coalesce(nullif(btrim(ci.caption), ''), p.display_name, p.handle) as title,
          ci.media_type,
          selected_asset.asset_kind as cover_asset_kind,
          selected_asset.poster_url,
          ci.created_at
        from content_items ci
        join private.eligible_content((select id from actor), null) eligible
          on eligible.content_item_id = ci.id
        join mutual_profiles creator_mutuals
          on creator_mutuals.user_id = ci.creator_user_id
          and creator_mutuals.enabled = true
          and creator_mutuals.visible_on_media = true
          and creator_mutuals.safety_state = 'clear'
        join profiles p on p.user_id = ci.creator_user_id
        join lateral (
          select ma.asset_kind, ma.poster_url
          from media_assets ma
          where ma.content_item_id = ci.id
            and ma.retired_at is null
          order by
            (ma.id = ci.release_media_asset_id) desc,
            ma.is_cover desc,
            ma.position asc,
            ma.created_at asc
          limit 1
        ) selected_asset on true
        where exists (select 1 from actor)
          and ci.media_type in ('bit', 'clip', 'image', 'vod', 'live_replay', 'carousel')
          and ci.creator_user_id <> (select id from actor)
          and (
            ${cursor.timestamp}::timestamptz is null
            or (
              ${cursor.id}::uuid is null
              and ci.created_at <= ${cursor.timestamp}::timestamptz
            )
            or (
              ${cursor.id}::uuid is not null
              and (ci.created_at, ci.id) < (${cursor.timestamp}::timestamptz, ${cursor.id}::uuid)
            )
          )
          and not exists (
            select 1
            from mutual_interests mi
            where mi.actor_user_id = (select id from actor)
              and mi.target_user_id = ci.creator_user_id
              and (mi.content_item_id = ci.id or mi.content_item_id is null)
          )
        order by ci.created_at desc, ci.id desc
        limit ${input.limit + 1}
      `;

      if (rows.length === 0) {
        const active = await hasActiveMutualsProfile(sql, input.supabaseUserId);
        if (!active) return null;
      }

      return keysetPage(rows, input.limit, toMutualsFeedItem, (row) =>
        encodeTimestampIdCursor(mutualsFeedCursorScope, row.created_at, row.content_id)
      );
    },
    ...createMutualsInterestRepositoryMethods(sql),
    async listMutuals(input) {
      const cursor = decodeTimestampIdCursor(mutualsListCursorScope, input.cursor);
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
          and not exists (
            select 1 from blocks b
            where (b.blocker_user_id = user_a_id and b.blocked_user_id = user_b_id)
               or (b.blocker_user_id = user_b_id and b.blocked_user_id = user_a_id)
          )
          and (
            ${cursor.timestamp}::timestamptz is null
            or (
              ${cursor.id}::uuid is null
              and created_at <= ${cursor.timestamp}::timestamptz
            )
            or (
              ${cursor.id}::uuid is not null
              and (created_at, id) < (${cursor.timestamp}::timestamptz, ${cursor.id}::uuid)
            )
          )
        order by created_at desc, id desc
        limit ${input.limit + 1}
      `;

      return keysetPage(rows, input.limit, toMutual, (row) =>
        encodeTimestampIdCursor(mutualsListCursorScope, row.created_at, row.id)
      );
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
      if (ownsClient) {
        await sql.end({ timeout: 5 });
      }
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
