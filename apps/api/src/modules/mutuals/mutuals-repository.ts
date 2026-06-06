import { randomUUID } from "node:crypto";
import postgres from "postgres";
import type {
  MutualsFeedItem,
  Mutual,
  MutualsProfile,
  MutualsRepository,
  MutualsInterestResult
} from "./types.js";

export class MutualsRepositoryConfigurationError extends Error {
  constructor() {
    super("DATABASE_URL_NOT_CONFIGURED");
    this.name = "MutualsRepositoryConfigurationError";
  }
}

export class MutualsIdempotencyConflictError extends Error {
  constructor() {
    super("MUTUALS_IDEMPOTENCY_CONFLICT");
    this.name = "MutualsIdempotencyConflictError";
  }
}

interface MutualsProfileRow {
  enabled: boolean;
  consent_version: string | null;
  active_match_limit: number;
  visible_on_media: boolean;
  safety_state: MutualsProfile["safetyState"];
  created_at: Date;
  updated_at: Date;
}

interface MutualsFeedRow {
  content_id: string;
  creator_user_id: string;
  handle: string;
  display_name: string;
  avatar_url: string | null;
  title: string;
  media_kind: MutualsFeedItem["mediaKind"];
  poster_url: string | null;
  created_at: Date;
}

interface MutualsInterestResultRow {
  swipe_id: string;
  swipe_idempotency_key: string;
  request_hash: string;
  match_id: string | null;
  match_user_a_id: string | null;
  match_user_b_id: string | null;
  match_source_content_item_id: string | null;
  match_conversation_id: string | null;
  match_state: Mutual["state"] | null;
  match_stale_at: Date | null;
  match_expires_at: Date | null;
  match_created_at: Date | null;
}

interface MutualRow {
  id: string;
  user_a_id: string;
  user_b_id: string;
  source_content_item_id: string | null;
  conversation_id: string | null;
  state: Mutual["state"];
  stale_at: Date | null;
  expires_at: Date | null;
  created_at: Date;
}

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
        insert into dating_profiles (
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
        update dating_profiles dp
        set
          enabled = coalesce(${input.body.enabled ?? null}, enabled),
          active_match_limit = coalesce(${input.body.activeMatchLimit ?? null}, active_match_limit),
          updated_at = now()
        from actor
        where dp.user_id = actor.id
        returning dp.*
      `;

      return rows[0] ? toMutualsProfile(rows[0]) : null;
    },
    async listFeed(input) {
      const rows = await sql<MutualsFeedRow[]>`
        with actor as (
          select u.id
          from users u
          join dating_profiles dp on dp.user_id = u.id
          where u.supabase_user_id = ${input.supabaseUserId}
            and dp.enabled = true
            and dp.safety_state <> 'blocked'
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
        join dating_profiles creator_dating
          on creator_dating.user_id = ci.creator_user_id
          and creator_dating.enabled = true
          and creator_dating.visible_on_media = true
          and creator_dating.safety_state = 'clear'
        join profiles p on p.user_id = ci.creator_user_id
        left join media_assets ma on ma.content_item_id = ci.id
        where exists (select 1 from actor)
          and ci.state = 'published'
          and ci.visibility = 'public'
          and ci.creator_user_id <> (select id from actor)
          and (${input.cursor ?? null}::timestamptz is null or ci.created_at < ${input.cursor ?? null}::timestamptz)
          and not exists (
            select 1
            from dating_swipes ds
            where ds.actor_user_id = (select id from actor)
              and ds.target_user_id = ci.creator_user_id
              and (ds.content_item_id = ci.id or ds.content_item_id is null)
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
    async createInterest(input) {
      const conversationId = randomUUID();
      const rows = await sql<MutualsInterestResultRow[]>`
        with actor as (
          select u.id
          from users u
          join dating_profiles dp on dp.user_id = u.id
          where u.supabase_user_id = ${input.supabaseUserId}
            and dp.enabled = true
            and dp.safety_state <> 'blocked'
          limit 1
        ),
        target_profile as (
          select dp.user_id
          from dating_profiles dp
          where dp.user_id = ${input.body.targetUserId}
            and dp.enabled = true
            and dp.safety_state = 'clear'
            and dp.user_id <> (select id from actor)
          limit 1
        ),
        target_content as (
          select ci.id
          from content_items ci
          join target_profile tp on tp.user_id = ci.creator_user_id
          where ci.id = ${input.body.contentId}
            and ci.state = 'published'
            and ci.visibility = 'public'
          limit 1
        ),
        existing_swipe as (
          select *
          from dating_swipes ds
          where ds.actor_user_id = (select id from actor)
            and ds.idempotency_key = ${input.idempotencyKey}
          limit 1
        ),
        inserted_swipe as (
          insert into dating_swipes (
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
          set action = dating_swipes.action
          returning *
        ),
        selected_swipe as (
          select * from inserted_swipe
          union all
          select * from existing_swipe
          limit 1
        ),
        reciprocal_yes as (
          select ds.*
          from dating_swipes ds, selected_swipe ss
          where ss.action = 'yes'
            and ds.action = 'yes'
            and ds.actor_user_id = ss.target_user_id
            and ds.target_user_id = ss.actor_user_id
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
          insert into dating_matches (
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
          set state = dating_matches.state
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
    },
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
        from dating_matches
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
        update dating_matches dm
        set
          state = 'archived',
          archived_by_user_id = (select id from actor),
          updated_at = now()
        where dm.id = ${input.matchId}
          and (dm.user_a_id = (select id from actor) or dm.user_b_id = (select id from actor))
          and dm.state in ('active', 'stale')
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
      join dating_profiles dp on dp.user_id = u.id
      where u.supabase_user_id = ${supabaseUserId}
        and dp.enabled = true
    )
  `;

  return rows[0]?.exists ?? false;
}

function toMutualsProfile(row: MutualsProfileRow | undefined): MutualsProfile {
  if (!row) throw new MutualsRepositoryConfigurationError();

  return {
    enabled: row.enabled,
    consentVersion: row.consent_version,
    activeMatchLimit: row.active_match_limit,
    visibleOnMedia: row.visible_on_media,
    safetyState: row.safety_state,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString()
  };
}

function toMutualsFeedItem(row: MutualsFeedRow): MutualsFeedItem {
  return {
    contentId: row.content_id,
    creatorUserId: row.creator_user_id,
    handle: row.handle,
    displayName: row.display_name,
    avatarUrl: row.avatar_url,
    title: row.title,
    mediaKind: row.media_kind,
    posterUrl: row.poster_url,
    createdAt: row.created_at.toISOString()
  };
}

function toInterestResult(row: MutualsInterestResultRow): MutualsInterestResult {
  const match = row.match_id
    ? toMutual({
        id: row.match_id,
        user_a_id: row.match_user_a_id ?? "",
        user_b_id: row.match_user_b_id ?? "",
        source_content_item_id: row.match_source_content_item_id,
        conversation_id: row.match_conversation_id,
        state: row.match_state ?? "active",
        stale_at: row.match_stale_at,
        expires_at: row.match_expires_at,
        created_at: row.match_created_at ?? new Date()
      })
    : undefined;

  return {
    swipeId: row.swipe_id,
    matchCreated: Boolean(row.match_id),
    matchId: row.match_id,
    ...(match ? { match } : {})
  };
}

function toMutual(row: MutualRow): Mutual {
  return {
    id: row.id,
    userAId: row.user_a_id,
    userBId: row.user_b_id,
    sourceContentId: row.source_content_item_id,
    conversationId: row.conversation_id,
    state: row.state,
    staleAt: row.stale_at?.toISOString() ?? null,
    expiresAt: row.expires_at?.toISOString() ?? null,
    createdAt: row.created_at.toISOString()
  };
}
