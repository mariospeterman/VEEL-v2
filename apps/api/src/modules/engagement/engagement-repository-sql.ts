import { randomUUID } from "node:crypto";
import type postgres from "postgres";
import type { EngagementState } from "./types.js";
import type { EngagementStateRow } from "./engagement-repository-rows.js";

export function preferencesSelectSql(sql: postgres.Sql, source: string) {
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

export function visibleContentSql(sql: postgres.Sql, contentId: string, supabaseUserId: string) {
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

export async function engagementState(
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

export async function insertAudit(
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
