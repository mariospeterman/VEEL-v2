import { randomUUID } from "node:crypto";
import type postgres from "postgres";
import {
  EngagementIdempotencyConflictError,
  EngagementNotFoundError,
  EngagementPolicyError
} from "./engagement-errors.js";
import type { EngagementRepository, FollowState } from "./types.js";
import { visibleContentSql } from "./engagement-repository-sql.js";

interface FollowActorTargetRow {
  actor_id: string;
  target_id: string;
}

interface CurrentFollowRelationshipRow {
  blocked: boolean;
  following: boolean;
  target_followable: boolean;
}

interface FollowReceiptRow {
  target_user_id: string;
  action: "follow" | "unfollow";
}

interface FollowStateRow {
  target_id: string;
  following: boolean;
  follower_count: string | number;
  following_count: string | number;
}

export function createEngagementSocialRepositoryMethods(
  sql: postgres.Sql
): Pick<EngagementRepository, "getFollowState" | "setFollowState" | "recordFeedImpression"> {
  return {
    async getFollowState(input) {
      return readFollowState(sql, input.supabaseUserId, input.targetUserId);
    },

    async setFollowState(input) {
      return sql.begin(async (transaction) => {
        const relationships = await transaction<FollowActorTargetRow[]>`
          select
            actor.id as actor_id,
            target.id as target_id
          from users actor
          join users target on target.id = ${input.targetUserId}
          where actor.supabase_user_id = ${input.supabaseUserId}
        `;

        const relationship = relationships[0];
        if (!relationship) throw new EngagementNotFoundError();
        if (relationship.actor_id === relationship.target_id) {
          throw new EngagementPolicyError("You cannot follow your own profile");
        }

        // Every follow edge locks both user rows in UUID order. Reciprocal follows
        // therefore cannot deadlock while their count projections update both rows.
        await transaction`
          select id
          from users
          where id in (${relationship.actor_id}, ${relationship.target_id})
          order by id
          for update
        `;

        const action = input.following ? "follow" : "unfollow";
        const priorReceipts = await transaction<FollowReceiptRow[]>`
          select target_user_id, action
          from follow_action_receipts
          where actor_user_id = ${relationship.actor_id}
            and idempotency_key = ${input.idempotencyKey}
          limit 1
        `;
        const priorReceipt = priorReceipts[0];
        if (priorReceipt) {
          if (priorReceipt.target_user_id !== relationship.target_id || priorReceipt.action !== action) {
            throw new EngagementIdempotencyConflictError();
          }
          return readFollowStateForMutation(
            transaction,
            relationship.actor_id,
            relationship.target_id
          );
        }

        const currentRelationships = await transaction<CurrentFollowRelationshipRow[]>`
          select
            exists (
              select 1 from blocks block
              where (block.blocker_user_id = ${relationship.actor_id} and block.blocked_user_id = ${relationship.target_id})
                 or (block.blocker_user_id = ${relationship.target_id} and block.blocked_user_id = ${relationship.actor_id})
            ) as blocked,
            exists (
              select 1
              from users target
              join profiles profile on profile.user_id = target.id
              where target.id = ${relationship.target_id}
                and target.state = 'active'
                and profile.visibility = 'public'
            ) as target_followable,
            exists (
              select 1 from user_follows follow
              where follow.follower_user_id = ${relationship.actor_id}
                and follow.followed_user_id = ${relationship.target_id}
                and follow.state = 'active'
            ) as following
        `;
        const currentRelationship = currentRelationships[0];
        if (
          !currentRelationship ||
          (input.following && (currentRelationship.blocked || !currentRelationship.target_followable))
        ) {
          throw new EngagementPolicyError("Follow is unavailable for this profile");
        }

        const receipts = await transaction<FollowReceiptRow[]>`
          insert into follow_action_receipts (
            actor_user_id,
            target_user_id,
            action,
            idempotency_key
          )
          values (
            ${relationship.actor_id},
            ${relationship.target_id},
            ${action},
            ${input.idempotencyKey}
          )
          on conflict (actor_user_id, idempotency_key) do nothing
          returning target_user_id, action
        `;

        if (receipts.length === 0) {
          const replay = await transaction<FollowReceiptRow[]>`
            select target_user_id, action
            from follow_action_receipts
            where actor_user_id = ${relationship.actor_id}
              and idempotency_key = ${input.idempotencyKey}
            limit 1
          `;
          if (replay[0]?.target_user_id !== relationship.target_id || replay[0]?.action !== action) {
            throw new EngagementIdempotencyConflictError();
          }
          return readFollowStateForMutation(
            transaction,
            relationship.actor_id,
            relationship.target_id
          );
        }

        await transaction`
          insert into user_follows (
            follower_user_id,
            followed_user_id,
            state,
            updated_at
          )
          values (
            ${relationship.actor_id},
            ${relationship.target_id},
            ${input.following ? "active" : "inactive"},
            now()
          )
          on conflict (follower_user_id, followed_user_id) do update
          set state = excluded.state, updated_at = now()
        `;

        await transaction`
          insert into audit_events (
            id,
            actor_user_id,
            subject_type,
            subject_id,
            action,
            idempotency_key,
            metadata
          ) values (
            ${randomUUID()},
            ${relationship.actor_id},
            'user',
            ${relationship.target_id},
            ${input.following ? "user.followed" : "user.unfollowed"},
            ${input.idempotencyKey},
            jsonb_build_object('social_only', true)
          )
          on conflict do nothing
        `;

        if (input.following && !currentRelationship.following) {
          await transaction`
            insert into notifications (
              id,
              user_id,
              kind,
              title,
              body,
              action_url,
              related_resource_type,
              related_resource_id,
              idempotency_key
            )
            select
              ${randomUUID()},
              ${relationship.target_id},
              'engagement',
              'New follower',
              '@' || actor_profile.handle || ' followed you.',
              '/profile/' || actor_profile.handle,
              'user',
              ${relationship.actor_id},
              'follow:' || ${relationship.actor_id} || ':' || ${input.idempotencyKey}
            from profiles actor_profile
            where actor_profile.user_id = ${relationship.actor_id}
            on conflict (user_id, idempotency_key) do nothing
          `;
        }

        return readFollowStateForMutation(
          transaction,
          relationship.actor_id,
          relationship.target_id
        );
      });
    },

    async recordFeedImpression(input) {
      return sql.begin(async (transaction) => {
        const actors = await transaction<{ id: string }[]>`
          select id from users where supabase_user_id = ${input.supabaseUserId} limit 1
        `;
        const actorId = actors[0]?.id;
        if (!actorId) throw new EngagementPolicyError("Content is not available in this feed");

        const visibleRows = await transaction<{ id: string }[]>`
          ${visibleContentSql(transaction, input.body.contentId, input.supabaseUserId)}
        `;
        if (visibleRows[0]?.id !== input.body.contentId) {
          throw new EngagementPolicyError("Content is not available in this feed");
        }

        await transaction`
          delete from feed_impression_receipts
          where user_id = ${actorId}
            and idempotency_key = ${input.idempotencyKey}
            and expires_at <= now()
        `;

        await transaction`
          delete from feed_impression_receipts receipt
          using (
            select user_id, idempotency_key
            from feed_impression_receipts
            where expires_at <= now()
            order by expires_at
            limit 100
          ) expired
          where receipt.user_id = expired.user_id
            and receipt.idempotency_key = expired.idempotency_key
        `;

        const receipts = await transaction<{ content_item_id: string }[]>`
          insert into feed_impression_receipts (
            user_id,
            idempotency_key,
            content_item_id
          ) values (
            ${actorId},
            ${input.idempotencyKey},
            ${input.body.contentId}
          )
          on conflict (user_id, idempotency_key) do nothing
          returning content_item_id
        `;

        if (receipts.length === 0) {
          const replay = await transaction<{ content_item_id: string }[]>`
            select content_item_id
            from feed_impression_receipts
            where user_id = ${actorId}
              and idempotency_key = ${input.idempotencyKey}
            limit 1
          `;
          if (replay[0]?.content_item_id !== input.body.contentId) {
            throw new EngagementIdempotencyConflictError();
          }
          return;
        }

        await transaction`
          insert into viewer_content_impressions (
            user_id,
            content_item_id,
            impression_count,
            first_seen_at,
            last_seen_at
          ) values (
            ${actorId},
            ${input.body.contentId},
            1,
            now(),
            now()
          )
          on conflict (user_id, content_item_id) do update
          set
            impression_count = least(2147483647, viewer_content_impressions.impression_count + 1),
            last_seen_at = now()
        `;
      });
    }
  };
}

type QueryableSql = postgres.Sql | postgres.TransactionSql;

async function readFollowState(
  sql: QueryableSql,
  supabaseUserId: string,
  targetUserId: string
): Promise<FollowState> {
  const rows = await sql<FollowStateRow[]>`
    select
      target.id as target_id,
      coalesce(follow.state = 'active', false) as following,
      coalesce(counts.follower_count, 0) as follower_count,
      coalesce(counts.following_count, 0) as following_count
    from users actor
    join users target on target.id = ${targetUserId}
    join profiles profile on profile.user_id = target.id
    left join user_follows follow
      on follow.follower_user_id = actor.id and follow.followed_user_id = target.id
    left join user_social_counts counts on counts.user_id = target.id
    where actor.supabase_user_id = ${supabaseUserId}
      and actor.id <> target.id
      and target.state = 'active'
      and profile.visibility = 'public'
      and not exists (
        select 1 from blocks block
        where (block.blocker_user_id = actor.id and block.blocked_user_id = target.id)
           or (block.blocker_user_id = target.id and block.blocked_user_id = actor.id)
      )
    limit 1
  `;
  const row = rows[0];
  if (!row) throw new EngagementNotFoundError();
  return {
    userId: row.target_id,
    following: row.following,
    followerCount: Number(row.follower_count),
    followingCount: Number(row.following_count)
  };
}

async function readFollowStateForMutation(
  sql: QueryableSql,
  actorUserId: string,
  targetUserId: string
): Promise<FollowState> {
  const rows = await sql<FollowStateRow[]>`
    select
      target.id as target_id,
      coalesce(follow.state = 'active', false) as following,
      coalesce(counts.follower_count, 0) as follower_count,
      coalesce(counts.following_count, 0) as following_count
    from users target
    left join user_follows follow
      on follow.follower_user_id = ${actorUserId} and follow.followed_user_id = target.id
    left join user_social_counts counts on counts.user_id = target.id
    where target.id = ${targetUserId}
    limit 1
  `;
  const row = rows[0];
  if (!row) throw new EngagementNotFoundError();
  return {
    userId: row.target_id,
    following: row.following,
    followerCount: Number(row.follower_count),
    followingCount: Number(row.following_count)
  };
}
