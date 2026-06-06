import { randomUUID } from "node:crypto";
import postgres from "postgres";
import type {
  Comment,
  EngagementRepository,
  EngagementState,
  FeedPreferences,
  ModerationIntake,
  ShareResult
} from "./types.js";

export class EngagementRepositoryConfigurationError extends Error {
  constructor() {
    super("DATABASE_URL_NOT_CONFIGURED");
    this.name = "EngagementRepositoryConfigurationError";
  }
}

export class EngagementPolicyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EngagementPolicyError";
  }
}

interface PreferencesRow {
  default_feed_mode: FeedPreferences["defaultMode"];
  nsfw_preference: FeedPreferences["nsfwPreference"];
  hidden_creator_ids: string[] | null;
  hidden_topics: string[] | null;
}

interface EngagementStateRow {
  liked: boolean;
  saved: boolean;
  like_count: string | number;
  comment_count: string | number;
  share_count: string | number;
}

interface CommentRow {
  id: string;
  body: string;
  moderation_state: Comment["moderationState"];
  created_at: Date;
  author_id: string;
  handle: string | null;
  display_name: string | null;
  avatar_url: string | null;
}

interface ShareRow {
  id: string;
  mode: ShareResult["mode"];
  url: string | null;
}

interface ReportRow {
  id: string;
  state: ModerationIntake["state"];
  queue: ModerationIntake["queue"];
}

export function createPostgresEngagementRepository(databaseUrl?: string): EngagementRepository {
  if (!databaseUrl) {
    return {
      async getFeedPreferences() {
        throw new EngagementRepositoryConfigurationError();
      },
      async updateFeedPreferences() {
        throw new EngagementRepositoryConfigurationError();
      },
      async resetFeedRecommendations() {
        throw new EngagementRepositoryConfigurationError();
      },
      async hideCreator() {
        throw new EngagementRepositoryConfigurationError();
      },
      async hideTopic() {
        throw new EngagementRepositoryConfigurationError();
      },
      async toggleLike() {
        throw new EngagementRepositoryConfigurationError();
      },
      async toggleSave() {
        throw new EngagementRepositoryConfigurationError();
      },
      async listComments() {
        throw new EngagementRepositoryConfigurationError();
      },
      async createComment() {
        throw new EngagementRepositoryConfigurationError();
      },
      async createShare() {
        throw new EngagementRepositoryConfigurationError();
      },
      async createReport() {
        throw new EngagementRepositoryConfigurationError();
      },
      async blockUser() {
        throw new EngagementRepositoryConfigurationError();
      }
    };
  }

  const sql = postgres(databaseUrl, {
    max: 5,
    idle_timeout: 20,
    prepare: false
  });

  return {
    async getFeedPreferences(input) {
      const rows = await sql<PreferencesRow[]>`
        with actor as (
          select id as user_id
          from users
          where supabase_user_id = ${input.supabaseUserId}
          limit 1
        ),
        preferences as (
          select
            actor.user_id,
            coalesce(vfp.default_feed_mode, 'recommended') as default_feed_mode,
            coalesce(vfp.nsfw_preference, 'recommended') as nsfw_preference
          from actor
          left join viewer_feed_preferences vfp on vfp.user_id = actor.user_id
        )
        select
          preferences.default_feed_mode,
          preferences.nsfw_preference,
          coalesce(array_agg(distinct vhc.creator_user_id::text) filter (where vhc.creator_user_id is not null), array[]::text[]) as hidden_creator_ids,
          coalesce(array_agg(distinct vht.topic) filter (where vht.topic is not null), array[]::text[]) as hidden_topics
        from preferences
        left join viewer_hidden_creators vhc on vhc.user_id = preferences.user_id
        left join viewer_hidden_topics vht on vht.user_id = preferences.user_id
        group by preferences.user_id, preferences.default_feed_mode, preferences.nsfw_preference
      `;

      return toPreferences(rows[0]);
    },
    async updateFeedPreferences(input) {
      const rows = await sql<PreferencesRow[]>`
        with actor as (
          select id
          from users
          where supabase_user_id = ${input.supabaseUserId}
          limit 1
        ),
        upserted as (
          insert into viewer_feed_preferences (
            user_id,
            default_feed_mode,
            nsfw_preference,
            updated_at
          )
          select
            actor.id,
            coalesce(${input.body.defaultMode ?? null}, 'recommended'),
            coalesce(${input.body.nsfwPreference ?? null}, 'recommended'),
            now()
          from actor
          on conflict (user_id) do update
          set
            default_feed_mode = coalesce(${input.body.defaultMode ?? null}, viewer_feed_preferences.default_feed_mode),
            nsfw_preference = coalesce(${input.body.nsfwPreference ?? null}, viewer_feed_preferences.nsfw_preference),
            updated_at = now()
          returning user_id, default_feed_mode, nsfw_preference
        )
        ${preferencesSelectSql(sql, "upserted")}
      `;

      return toPreferences(rows[0]);
    },
    async resetFeedRecommendations(input) {
      await sql.begin(async (transaction) => {
        const actorRows = await transaction<{ id: string }[]>`
          select id
          from users
          where supabase_user_id = ${input.supabaseUserId}
          limit 1
        `;
        const actor = actorRows[0];
        if (!actor) throw new EngagementRepositoryConfigurationError();

        await transaction`delete from viewer_hidden_creators where user_id = ${actor.id}`;
        await transaction`delete from viewer_hidden_topics where user_id = ${actor.id}`;
        await transaction`
          insert into viewer_feed_preferences (user_id, default_feed_mode, nsfw_preference, updated_at)
          values (${actor.id}, 'recommended', 'recommended', now())
          on conflict (user_id) do update
          set default_feed_mode = 'recommended', nsfw_preference = 'recommended', updated_at = now()
        `;
        await insertAudit(transaction, actor.id, "feed_preferences", actor.id, "feed.reset", {
          idempotencyKey: input.idempotencyKey
        });
      });
    },
    async hideCreator(input) {
      const rows = await sql<PreferencesRow[]>`
        with actor as (
          select id
          from users
          where supabase_user_id = ${input.supabaseUserId}
          limit 1
        ),
        inserted as (
          insert into viewer_hidden_creators (user_id, creator_user_id, idempotency_key)
          select actor.id, ${input.creatorUserId}, ${input.idempotencyKey}
          from actor
          on conflict (user_id, creator_user_id) do update
          set idempotency_key = viewer_hidden_creators.idempotency_key
          returning user_id
        ),
        ensured_preferences as (
          insert into viewer_feed_preferences (user_id)
          select user_id
          from inserted
          on conflict (user_id) do nothing
          returning user_id
        )
        ${preferencesSelectSql(sql, "inserted")}
      `;

      return toPreferences(rows[0]);
    },
    async hideTopic(input) {
      const rows = await sql<PreferencesRow[]>`
        with actor as (
          select id
          from users
          where supabase_user_id = ${input.supabaseUserId}
          limit 1
        ),
        inserted as (
          insert into viewer_hidden_topics (user_id, topic, idempotency_key)
          select actor.id, lower(${input.topic}), ${input.idempotencyKey}
          from actor
          on conflict (user_id, topic) do update
          set idempotency_key = viewer_hidden_topics.idempotency_key
          returning user_id
        ),
        ensured_preferences as (
          insert into viewer_feed_preferences (user_id)
          select user_id
          from inserted
          on conflict (user_id) do nothing
          returning user_id
        )
        ${preferencesSelectSql(sql, "inserted")}
      `;

      return toPreferences(rows[0]);
    },
    async toggleLike(input) {
      await sql`
        with actor as (
          select id
          from users
          where supabase_user_id = ${input.supabaseUserId}
          limit 1
        ),
        visible_content as (
          ${visibleContentSql(sql, input.contentId, input.supabaseUserId)}
        ),
        receipt as (
          insert into engagement_action_receipts (actor_user_id, action, target_id, idempotency_key)
          select actor.id, 'content.like', visible_content.id, ${input.idempotencyKey}
          from actor, visible_content
          on conflict (actor_user_id, action, idempotency_key) do nothing
          returning actor_user_id
        )
        insert into content_reactions (
          user_id,
          content_item_id,
          reaction_key,
          state,
          last_idempotency_key,
          updated_at
        )
        select actor.id, visible_content.id, 'like', 'active', ${input.idempotencyKey}, now()
        from actor, visible_content, receipt
        on conflict (user_id, content_item_id, reaction_key) do update
        set
          state = case
            when content_reactions.state = 'active' then 'inactive'
            else 'active'
          end,
          last_idempotency_key = ${input.idempotencyKey},
          updated_at = now()
      `;

      return engagementState(sql, input.supabaseUserId, input.contentId);
    },
    async toggleSave(input) {
      await sql`
        with actor as (
          select id
          from users
          where supabase_user_id = ${input.supabaseUserId}
          limit 1
        ),
        visible_content as (
          ${visibleContentSql(sql, input.contentId, input.supabaseUserId)}
        ),
        receipt as (
          insert into engagement_action_receipts (actor_user_id, action, target_id, idempotency_key)
          select actor.id, 'content.save', visible_content.id, ${input.idempotencyKey}
          from actor, visible_content
          on conflict (actor_user_id, action, idempotency_key) do nothing
          returning actor_user_id
        )
        insert into content_saves (
          user_id,
          content_item_id,
          state,
          last_idempotency_key,
          updated_at
        )
        select actor.id, visible_content.id, 'active', ${input.idempotencyKey}, now()
        from actor, visible_content, receipt
        on conflict (user_id, content_item_id) do update
        set
          state = case
            when content_saves.state = 'active' then 'inactive'
            else 'active'
          end,
          last_idempotency_key = ${input.idempotencyKey},
          updated_at = now()
      `;

      return engagementState(sql, input.supabaseUserId, input.contentId);
    },
    async listComments(input) {
      const rows = await sql<CommentRow[]>`
        with visible_content as (
          ${visibleContentSql(sql, input.contentId, input.supabaseUserId)}
        )
        select
          c.id,
          c.body,
          c.moderation_state,
          c.created_at,
          u.id as author_id,
          p.handle,
          p.display_name,
          p.avatar_url
        from comments c
        join visible_content on visible_content.id = c.content_item_id
        join users u on u.id = c.user_id
        left join profiles p on p.user_id = u.id
        where c.moderation_state = 'visible'
          and (${input.cursor ?? null}::timestamptz is null or c.created_at < ${input.cursor ?? null}::timestamptz)
        order by c.created_at desc
        limit ${input.limit + 1}
      `;
      const visibleRows = rows.slice(0, input.limit);
      const next = rows[input.limit];

      return {
        items: visibleRows.map(toComment),
        nextCursor: next ? next.created_at.toISOString() : null
      };
    },
    async createComment(input) {
      const rows = await sql<CommentRow[]>`
        with actor as (
          select id
          from users
          where supabase_user_id = ${input.supabaseUserId}
          limit 1
        ),
        visible_content as (
          ${visibleContentSql(sql, input.contentId, input.supabaseUserId)}
        ),
        inserted as (
          insert into comments (
            id,
            content_item_id,
            user_id,
            body,
            moderation_state,
            idempotency_key
          )
          select
            ${randomUUID()},
            visible_content.id,
            actor.id,
            ${input.body.body},
            'visible',
            ${input.idempotencyKey}
          from actor, visible_content
          on conflict (user_id, idempotency_key) do nothing
          returning id, user_id, body, moderation_state, created_at
        )
        select
          c.id,
          c.body,
          c.moderation_state,
          c.created_at,
          u.id as author_id,
          p.handle,
          p.display_name,
          p.avatar_url
        from (
          select * from inserted
          union all
          select id, user_id, body, moderation_state, created_at
          from comments
          where user_id = (select id from actor)
            and idempotency_key = ${input.idempotencyKey}
        ) c
        join users u on u.id = c.user_id
        left join profiles p on p.user_id = u.id
        limit 1
      `;

      const row = rows[0];
      if (!row) throw new EngagementPolicyError("Comment is not allowed");
      return toComment(row);
    },
    async createShare(input) {
      const rows = await sql<ShareRow[]>`
        with actor as (
          select id
          from users
          where supabase_user_id = ${input.supabaseUserId}
          limit 1
        ),
        inserted as (
          insert into share_records (
            id,
            actor_user_id,
            target_type,
            target_id,
            mode,
            url,
            idempotency_key
          )
          select
            ${randomUUID()},
            actor.id,
            ${input.body.targetType},
            ${input.body.targetId},
            ${input.body.mode},
            ${shareUrl(input.webUrl, input.body.targetType, input.body.targetId, input.body.mode)},
            ${input.idempotencyKey}
          from actor
          on conflict (actor_user_id, idempotency_key) do nothing
          returning id, actor_user_id, target_type, target_id, mode, url
        ),
        existing as (
          select id, actor_user_id, target_type, target_id, mode, url
          from share_records
          where actor_user_id = (select id from actor)
            and idempotency_key = ${input.idempotencyKey}
        ),
        selected as (
          select * from inserted
          union all
          select * from existing
          limit 1
        ),
        audit as (
          insert into audit_events (id, actor_user_id, subject_type, subject_id, action, metadata)
          select ${randomUUID()}, actor_user_id, target_type, target_id, 'share.created', jsonb_build_object('mode', mode)
          from selected
          on conflict do nothing
          returning id
        )
        select id, mode, url
        from selected
      `;

      const row = rows[0];
      if (!row) throw new EngagementRepositoryConfigurationError();
      return { id: row.id, mode: row.mode, url: row.url };
    },
    async createReport(input) {
      const queue = queueForSubject(input.body.subjectType);
      const rows = await sql<ReportRow[]>`
        with actor as (
          select id
          from users
          where supabase_user_id = ${input.supabaseUserId}
          limit 1
        ),
        inserted as (
          insert into reports (
            id,
            reporter_user_id,
            subject_type,
            subject_id,
            reason,
            queue,
            state,
            idempotency_key
          )
          select
            ${randomUUID()},
            actor.id,
            ${input.body.subjectType},
            ${input.body.subjectId},
            ${input.body.reason},
            ${queue},
            'queued',
            ${input.idempotencyKey}
          from actor
          on conflict (reporter_user_id, idempotency_key) do nothing
          returning id, reporter_user_id, subject_type, subject_id, state, queue
        ),
        existing as (
          select id, reporter_user_id, subject_type, subject_id, state, queue
          from reports
          where reporter_user_id = (select id from actor)
            and idempotency_key = ${input.idempotencyKey}
        ),
        selected as (
          select * from inserted
          union all
          select * from existing
          limit 1
        ),
        audit as (
          insert into audit_events (id, actor_user_id, subject_type, subject_id, action, metadata)
          select ${randomUUID()}, reporter_user_id, subject_type, subject_id, 'report.created', jsonb_build_object('queue', queue)
          from selected
          on conflict do nothing
          returning id
        )
        select id, state, queue
        from selected
      `;

      const row = rows[0];
      if (!row) throw new EngagementRepositoryConfigurationError();
      return { id: row.id, state: row.state, queue: row.queue };
    },
    async blockUser(input) {
      const rows = await sql<{ blocked_user_id: string }[]>`
        with actor as (
          select id
          from users
          where supabase_user_id = ${input.supabaseUserId}
          limit 1
        ),
        target_user as (
          select id
          from users
          where id = ${input.blockedUserId}
          limit 1
        ),
        inserted as (
          insert into blocks (blocker_user_id, blocked_user_id, idempotency_key)
          select actor.id, target_user.id, ${input.idempotencyKey}
          from actor, target_user
          where actor.id <> target_user.id
          on conflict (blocker_user_id, blocked_user_id) do update
          set idempotency_key = blocks.idempotency_key
          returning blocker_user_id, blocked_user_id
        ),
        audit as (
          insert into audit_events (id, actor_user_id, subject_type, subject_id, action, metadata)
          select ${randomUUID()}, blocker_user_id, 'user', blocked_user_id, 'user.blocked', '{}'::jsonb
          from inserted
          on conflict do nothing
          returning id
        )
        select blocked_user_id
        from inserted
        limit 1
      `;

      const row = rows[0];
      if (!row) throw new EngagementPolicyError("Block is not allowed");
      return { blocked: true, blockedUserId: row.blocked_user_id };
    },
    async close() {
      await sql.end({ timeout: 5 });
    }
  };
}

function preferencesSelectSql(sql: postgres.Sql, source: string) {
  return sql.unsafe(`
    select
      vfp.default_feed_mode,
      vfp.nsfw_preference,
      coalesce(array_agg(distinct vhc.creator_user_id::text) filter (where vhc.creator_user_id is not null), array[]::text[]) as hidden_creator_ids,
      coalesce(array_agg(distinct vht.topic) filter (where vht.topic is not null), array[]::text[]) as hidden_topics
    from ${source}
    join viewer_feed_preferences vfp on vfp.user_id = ${source}.user_id
    left join viewer_hidden_creators vhc on vhc.user_id = vfp.user_id
    left join viewer_hidden_topics vht on vht.user_id = vfp.user_id
    group by vfp.user_id, vfp.default_feed_mode, vfp.nsfw_preference
  `);
}

function visibleContentSql(sql: postgres.Sql, contentId: string, supabaseUserId: string) {
  return sql`
    select ci.id, ci.creator_user_id
    from content_items ci
    join users viewer on viewer.supabase_user_id = ${supabaseUserId}
    where ci.id = ${contentId}
      and ci.state = 'ready'
      and ci.visibility = 'public'
      and ci.moderation_state = 'approved'
      and not exists (
        select 1
        from blocks b
        where (b.blocker_user_id = viewer.id and b.blocked_user_id = ci.creator_user_id)
           or (b.blocker_user_id = ci.creator_user_id and b.blocked_user_id = viewer.id)
      )
  `;
}

async function engagementState(
  sql: postgres.Sql,
  supabaseUserId: string,
  contentId: string
): Promise<EngagementState> {
  const rows = await sql<EngagementStateRow[]>`
    with viewer as (
      select id
      from users
      where supabase_user_id = ${supabaseUserId}
      limit 1
    )
    select
      exists (
        select 1 from content_reactions cr, viewer
        where cr.content_item_id = ${contentId}
          and cr.user_id = viewer.id
          and cr.reaction_key = 'like'
          and cr.state = 'active'
      ) as liked,
      exists (
        select 1 from content_saves cs, viewer
        where cs.content_item_id = ${contentId}
          and cs.user_id = viewer.id
          and cs.state = 'active'
      ) as saved,
      (select count(*) from content_reactions where content_item_id = ${contentId} and reaction_key = 'like' and state = 'active') as like_count,
      (select count(*) from comments where content_item_id = ${contentId} and moderation_state = 'visible') as comment_count,
      (select count(*) from share_records where target_type = 'content' and target_id = ${contentId} and state = 'created') as share_count
  `;

  const row = rows[0];
  return {
    liked: Boolean(row?.liked),
    saved: Boolean(row?.saved),
    likeCount: Number(row?.like_count ?? 0),
    commentCount: Number(row?.comment_count ?? 0),
    shareCount: Number(row?.share_count ?? 0)
  };
}

type QueryableSql = postgres.Sql | postgres.TransactionSql;

async function insertAudit(
  sql: QueryableSql,
  actorUserId: string,
  subjectType: string,
  subjectId: string,
  action: string,
  metadata: Record<string, unknown>
) {
  await sql`
    insert into audit_events (id, actor_user_id, subject_type, subject_id, action, metadata)
    values (${randomUUID()}, ${actorUserId}, ${subjectType}, ${subjectId}, ${action}, ${JSON.stringify(metadata)}::jsonb)
  `;
}

function toPreferences(row: PreferencesRow | undefined): FeedPreferences {
  return {
    defaultMode: row?.default_feed_mode ?? "recommended",
    nsfwPreference: row?.nsfw_preference ?? "recommended",
    hiddenCreatorIds: row?.hidden_creator_ids ?? [],
    hiddenTopics: row?.hidden_topics ?? []
  };
}

function toComment(row: CommentRow): Comment {
  return {
    id: row.id,
    author: {
      id: row.author_id,
      handle: row.handle ?? "",
      displayName: row.display_name ?? "",
      avatarUrl: row.avatar_url,
      badges: []
    },
    body: row.body,
    moderationState: row.moderation_state,
    createdAt: row.created_at.toISOString()
  };
}

function queueForSubject(subjectType: string): ModerationIntake["queue"] {
  if (subjectType === "content") return "content";
  if (subjectType === "user") return "user";
  if (subjectType === "message") return "message";
  if (subjectType === "live_room") return "live";
  if (subjectType === "event") return "event";
  return "general";
}

function shareUrl(webUrl: string, targetType: string, targetId: string, mode: string): string | null {
  if (mode === "internal_message") return null;

  const base = webUrl.replace(/\/$/, "");
  return `${base}/share/${targetType}/${targetId}`;
}
