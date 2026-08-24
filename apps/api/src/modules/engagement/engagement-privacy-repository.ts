import { randomUUID } from "node:crypto";
import type postgres from "postgres";
import { EngagementIdempotencyConflictError, EngagementPolicyError } from "./engagement-errors.js";
import type { DataRequestRow, PrivacyUserRow } from "./engagement-repository-rows.js";
import type { EngagementRepository } from "./types.js";

interface ActorTargetRow {
  actor_id: string;
  target_id: string;
}

interface ReceiptRow {
  target_id: string;
}

export function createEngagementPrivacyRepositoryMethods(
  sql: postgres.Sql
): Pick<EngagementRepository, "blockUser" | "unblockUser" | "setMute" | "getPrivacySettings" | "createDataRequest"> {
  return {
    async blockUser(input) {
      const blocked = await setRelationship(sql, {
        supabaseUserId: input.supabaseUserId,
        targetUserId: input.blockedUserId,
        idempotencyKey: input.idempotencyKey,
        action: "user.block"
      });
      return { blocked, blockedUserId: input.blockedUserId };
    },

    async unblockUser(input) {
      const blocked = await setRelationship(sql, {
        supabaseUserId: input.supabaseUserId,
        targetUserId: input.blockedUserId,
        idempotencyKey: input.idempotencyKey,
        action: "user.unblock"
      });
      return { blocked, blockedUserId: input.blockedUserId };
    },

    async setMute(input) {
      const muted = await setRelationship(sql, {
        supabaseUserId: input.supabaseUserId,
        targetUserId: input.mutedUserId,
        idempotencyKey: input.idempotencyKey,
        action: input.muted ? "user.mute" : "user.unmute"
      });
      return { muted, mutedUserId: input.mutedUserId };
    },

    async getPrivacySettings(input) {
      const users = await sql<PrivacyUserRow[]>`
        with actor as (
          select id from users where supabase_user_id = ${input.supabaseUserId} limit 1
        ), relationships as (
          select 'blocked'::text as relationship, block.blocked_user_id as user_id
          from blocks block, actor
          where block.blocker_user_id = actor.id
          union all
          select 'muted'::text as relationship, mute.muted_user_id as user_id
          from user_mutes mute, actor
          where mute.muting_user_id = actor.id
        )
        select relationships.relationship, account.id, profile.handle, profile.display_name, profile.avatar_url
        from relationships
        join users account on account.id = relationships.user_id
        left join profiles profile on profile.user_id = account.id
        order by relationships.relationship, lower(coalesce(profile.handle, '')), account.id
      `;
      const requests = await sql<DataRequestRow[]>`
        with actor as (
          select id from users where supabase_user_id = ${input.supabaseUserId} limit 1
        )
        select request.id, request.type, request.state, request.created_at, request.updated_at, request.completed_at
        from data_requests request, actor
        where request.requester_user_id = actor.id
        order by request.created_at desc
        limit 20
      `;

      const toUser = (row: PrivacyUserRow) => ({
        id: row.id,
        handle: row.handle ?? "",
        displayName: row.display_name ?? "",
        avatarUrl: row.avatar_url,
        badges: []
      });

      return {
        blockedUsers: users.filter((user) => user.relationship === "blocked").map(toUser),
        mutedUsers: users.filter((user) => user.relationship === "muted").map(toUser),
        dataRequests: requests.map(toDataRequest)
      };
    },

    async createDataRequest(input) {
      return sql.begin(async (transaction) => {
        const actors = await transaction<{ id: string }[]>`
          select id
          from users
          where supabase_user_id = ${input.supabaseUserId}
          for update
        `;
        const actor = actors[0];
        if (!actor) throw new EngagementPolicyError("Data request is not allowed");

        const replays = await transaction<(DataRequestRow & { reason: string | null })[]>`
          select id, type, state, reason, created_at, updated_at, completed_at
          from data_requests
          where requester_user_id = ${actor.id}
            and idempotency_key = ${input.idempotencyKey}
          limit 1
        `;
        const replay = replays[0];
        if (replay) {
          if (replay.type !== input.body.type || replay.reason !== (input.body.reason ?? null)) {
            throw new EngagementIdempotencyConflictError();
          }
          return toDataRequest(replay);
        }

        const active = await transaction<{ id: string }[]>`
          select id
          from data_requests
          where requester_user_id = ${actor.id}
            and type = ${input.body.type}
            and state in ('requested', 'verifying', 'processing')
          limit 1
        `;
        if (active[0]) {
          throw new EngagementPolicyError(`An active ${input.body.type} request already exists`);
        }

        const rows = await transaction<DataRequestRow[]>`
          insert into data_requests (
            id, requester_user_id, type, state, reason, idempotency_key, updated_at
          ) values (
            ${randomUUID()}, ${actor.id}, ${input.body.type}, 'requested', ${input.body.reason ?? null},
            ${input.idempotencyKey}, now()
          )
          returning id, type, state, created_at, updated_at, completed_at
        `;
        const row = rows[0];
        if (!row) throw new EngagementPolicyError("Data request is not allowed");

        await transaction`
          insert into audit_events (
            id, actor_user_id, subject_type, subject_id, action, idempotency_key, metadata
          ) values (
            ${randomUUID()}, ${actor.id}, 'data_request', ${row.id},
            'privacy.data_request.created', ${input.idempotencyKey}, jsonb_build_object('type', ${row.type})
          )
          on conflict do nothing
        `;
        return toDataRequest(row);
      });
    }
  };
}

async function setRelationship(
  sql: postgres.Sql,
  input: {
    supabaseUserId: string;
    targetUserId: string;
    idempotencyKey: string;
    action: "user.block" | "user.unblock" | "user.mute" | "user.unmute";
  }
): Promise<boolean> {
  return sql.begin(async (transaction) => {
    const replayBeforePolicy = await transaction<(ReceiptRow & { actor_id: string })[]>`
      select actor.id as actor_id, receipt.target_id
      from users actor
      left join engagement_action_receipts receipt
        on receipt.actor_user_id = actor.id
        and receipt.action = ${input.action}
        and receipt.idempotency_key = ${input.idempotencyKey}
      where actor.supabase_user_id = ${input.supabaseUserId}
        and receipt.target_id is not null
      limit 1
    `;
    if (replayBeforePolicy[0]) {
      if (replayBeforePolicy[0].target_id !== input.targetUserId) throw new EngagementIdempotencyConflictError();
      return currentRelationshipState(transaction, replayBeforePolicy[0].actor_id, input.targetUserId, input.action);
    }

    const relationships = await transaction<ActorTargetRow[]>`
      select actor.id as actor_id, target.id as target_id
      from users actor
      join users target on target.id = ${input.targetUserId}
      where actor.supabase_user_id = ${input.supabaseUserId}
        and actor.id <> target.id
    `;
    const relationship = relationships[0];
    if (!relationship) throw new EngagementPolicyError("Privacy action is not allowed");

    await transaction`
      select id from users
      where id in (${relationship.actor_id}, ${relationship.target_id})
      order by id
      for update
    `;

    const prior = await transaction<ReceiptRow[]>`
      select target_id
      from engagement_action_receipts
      where actor_user_id = ${relationship.actor_id}
        and action = ${input.action}
        and idempotency_key = ${input.idempotencyKey}
      limit 1
    `;
    if (prior[0]) {
      if (prior[0].target_id !== relationship.target_id) throw new EngagementIdempotencyConflictError();
      return currentRelationshipState(transaction, relationship.actor_id, relationship.target_id, input.action);
    }

    const receipt = await transaction<ReceiptRow[]>`
      insert into engagement_action_receipts (actor_user_id, action, target_id, idempotency_key)
      values (${relationship.actor_id}, ${input.action}, ${relationship.target_id}, ${input.idempotencyKey})
      on conflict do nothing
      returning target_id
    `;
    if (receipt[0]?.target_id !== relationship.target_id) throw new EngagementIdempotencyConflictError();

    if (input.action === "user.block") {
      await transaction`
        insert into blocks (blocker_user_id, blocked_user_id, idempotency_key)
        values (${relationship.actor_id}, ${relationship.target_id}, ${input.idempotencyKey})
        on conflict (blocker_user_id, blocked_user_id) do update
        set idempotency_key = excluded.idempotency_key
      `;
      await transaction`
        update user_follows set state = 'inactive', updated_at = now()
        where state = 'active' and (
          (follower_user_id = ${relationship.actor_id} and followed_user_id = ${relationship.target_id})
          or (follower_user_id = ${relationship.target_id} and followed_user_id = ${relationship.actor_id})
        )
      `;
    } else if (input.action === "user.unblock") {
      await transaction`
        delete from blocks
        where blocker_user_id = ${relationship.actor_id} and blocked_user_id = ${relationship.target_id}
      `;
    } else if (input.action === "user.mute") {
      await transaction`
        insert into user_mutes (muting_user_id, muted_user_id)
        values (${relationship.actor_id}, ${relationship.target_id})
        on conflict do nothing
      `;
    } else {
      await transaction`
        delete from user_mutes
        where muting_user_id = ${relationship.actor_id} and muted_user_id = ${relationship.target_id}
      `;
    }

    await transaction`
      insert into audit_events (
        id, actor_user_id, subject_type, subject_id, action, idempotency_key, metadata
      ) values (
        ${randomUUID()}, ${relationship.actor_id}, 'user', ${relationship.target_id}, ${auditAction(input.action)},
        ${input.idempotencyKey}, jsonb_build_object('social_only', true)
      )
      on conflict do nothing
    `;

    return input.action === "user.block" || input.action === "user.mute";
  });
}

function auditAction(action: "user.block" | "user.unblock" | "user.mute" | "user.unmute") {
  if (action === "user.block") return "user.blocked";
  if (action === "user.unblock") return "user.unblocked";
  if (action === "user.mute") return "user.muted";
  return "user.unmuted";
}

async function currentRelationshipState(
  sql: postgres.TransactionSql,
  actorUserId: string,
  targetUserId: string,
  action: "user.block" | "user.unblock" | "user.mute" | "user.unmute"
): Promise<boolean> {
  const table = action === "user.block" || action === "user.unblock" ? "block" : "mute";
  const rows = table === "block"
    ? await sql<{ active: boolean }[]>`
        select exists (select 1 from blocks where blocker_user_id = ${actorUserId} and blocked_user_id = ${targetUserId}) as active
      `
    : await sql<{ active: boolean }[]>`
        select exists (select 1 from user_mutes where muting_user_id = ${actorUserId} and muted_user_id = ${targetUserId}) as active
      `;
  return rows[0]?.active ?? false;
}

function toDataRequest(row: DataRequestRow) {
  return {
    id: row.id,
    type: row.type,
    state: row.state,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at?.toISOString() ?? null,
    completedAt: row.completed_at?.toISOString() ?? null
  };
}
