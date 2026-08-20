import type postgres from "postgres";
import type { PostgresSql } from "../../shared/postgres.js";
import {
  PlatformPlaybackNotQualifyingError,
  PlatformUsageLimitReachedError,
  PlatformUsageSequenceConflictError,
  SubscriptionIdempotencyConflictError,
  SubscriptionRepositoryConfigurationError
} from "./subscription-errors.js";
import type {
  PlatformAccess,
  PlatformPlaybackSession,
  SubscriptionRepository
} from "./types.js";

const heartbeatIntervalSeconds = 15;
const maxHeartbeatSeconds = 30;
const heartbeatClockSkewSeconds = 5;
type QuerySql = postgres.Sql | postgres.TransactionSql;

export function createPlatformAccessRepositoryMethods(
  sql: PostgresSql
): Pick<
  SubscriptionRepository,
  | "getPlatformAccess"
  | "getPlatformPlaybackDecision"
  | "createPlatformPlaybackSession"
  | "recordPlatformPlaybackHeartbeat"
> {
  return {
    async getPlatformAccess(input) {
      return sql.begin(async (transaction) => {
        const actorId = await findActorId(transaction, input.supabaseUserId);
        return resolvePlatformAccess(transaction, actorId);
      });
    },

    async getPlatformPlaybackDecision(input) {
      return sql.begin(async (transaction) => {
        const actorId = await findActorId(transaction, input.supabaseUserId);
        const countsTowardAllowance = await isQualifyingPublicPlayback(transaction, {
          actorId,
          targetType: input.targetType,
          targetId: input.targetId
        });

        if (!countsTowardAllowance) {
          return { countsTowardAllowance: false, limitReached: false };
        }

        const access = await resolvePlatformAccess(transaction, actorId);
        return {
          countsTowardAllowance: true,
          limitReached: access.usage.limitReached
        };
      });
    },

    async createPlatformPlaybackSession(input) {
      return sql.begin(async (transaction) => {
        const actorId = await findActorId(transaction, input.supabaseUserId);
        const existing = await findSessionByIdempotency(transaction, actorId, input.idempotencyKey);

        if (existing) {
          if (existing.request_hash !== input.requestHash) {
            throw new SubscriptionIdempotencyConflictError();
          }

          return toPlaybackSession(existing, await resolvePlatformAccess(transaction, actorId));
        }

        if (!await isQualifyingPublicPlayback(transaction, {
          actorId,
          targetType: input.targetType,
          targetId: input.targetId
        })) {
          throw new PlatformPlaybackNotQualifyingError();
        }

        const access = await resolvePlatformAccess(transaction, actorId);
        if (access.usage.limitReached) {
          throw new PlatformUsageLimitReachedError();
        }

        const rows = await transaction<PlaybackSessionRow[]>`
          insert into platform_playback_sessions (
            user_id,
            target_type,
            target_id,
            window_starts_at,
            window_ends_at,
            idempotency_key,
            request_hash
          )
          values (
            ${actorId},
            ${input.targetType},
            ${input.targetId},
            ${access.usage.windowStartsAt},
            ${access.usage.windowEndsAt},
            ${input.idempotencyKey},
            ${input.requestHash}
          )
          on conflict (user_id, idempotency_key) do nothing
          returning *
        `;
        const session = rows[0] ?? await findSessionByIdempotency(
          transaction,
          actorId,
          input.idempotencyKey
        );
        if (!session) throw new SubscriptionRepositoryConfigurationError();
        if (session.request_hash !== input.requestHash) {
          throw new SubscriptionIdempotencyConflictError();
        }

        return toPlaybackSession(session, access);
      });
    },

    async recordPlatformPlaybackHeartbeat(input) {
      return sql.begin(async (transaction) => {
        const actorId = await findActorId(transaction, input.supabaseUserId);
        const priorRows = await transaction<HeartbeatReplayRow[]>`
          select heartbeat.request_hash as heartbeat_request_hash, session.*
          from platform_playback_heartbeats heartbeat
          join platform_playback_sessions session on session.id = heartbeat.session_id
          where session.id = ${input.playbackSessionId}
            and session.user_id = ${actorId}
            and (
              heartbeat.idempotency_key = ${input.idempotencyKey}
              or heartbeat.sequence = ${input.sequence}
            )
          limit 1
        `;
        const prior = priorRows[0];

        if (prior) {
          if (prior.heartbeat_request_hash !== input.requestHash) {
            throw new SubscriptionIdempotencyConflictError();
          }

          return toPlaybackSession(prior, await resolvePlatformAccess(transaction, actorId));
        }

        const sessionRows = await transaction<PlaybackSessionRow[]>`
          select *
          from platform_playback_sessions
          where id = ${input.playbackSessionId}
            and user_id = ${actorId}
          for update
        `;
        const session = sessionRows[0];
        if (!session) return null;

        if (session.state !== "active") {
          return toPlaybackSession(session, await resolvePlatformAccess(transaction, actorId));
        }

        if (input.sequence !== session.last_sequence + 1) {
          throw new PlatformUsageSequenceConflictError();
        }

        const nowRows = await transaction<{ now: Date }[]>`select now() as now`;
        const now = nowRows[0]?.now ?? new Date();
        if (now >= session.window_ends_at) {
          const expired = await updateSessionState(transaction, session.id, "expired");
          return toPlaybackSession(expired, await resolvePlatformAccess(transaction, actorId));
        }

        if (!await isQualifyingPublicPlayback(transaction, {
          actorId,
          targetType: session.target_type,
          targetId: session.target_id
        })) {
          const closed = await updateSessionState(transaction, session.id, "closed");
          return toPlaybackSession(closed, await resolvePlatformAccess(transaction, actorId));
        }

        await transaction`
          insert into platform_usage_windows (
            user_id,
            window_starts_at,
            window_ends_at,
            public_media_seconds
          )
          values (${actorId}, ${session.window_starts_at}, ${session.window_ends_at}, 0)
          on conflict (user_id, window_starts_at) do nothing
        `;
        const usageRows = await transaction<{ public_media_seconds: string | number }[]>`
          select public_media_seconds
          from platform_usage_windows
          where user_id = ${actorId}
            and window_starts_at = ${session.window_starts_at}
          for update
        `;
        const accessBefore = await resolvePlatformAccess(transaction, actorId);
        const currentUsage = Number(usageRows[0]?.public_media_seconds ?? 0);
        const allowance = accessBefore.currentTier.publicMediaAllowanceSeconds;
        const remaining = allowance === null ? null : Math.max(0, allowance - currentUsage);
        const elapsedSeconds = Math.max(
          0,
          Math.floor((now.getTime() - session.last_heartbeat_at.getTime()) / 1_000)
        );
        const creditedSeconds = Math.max(
          0,
          Math.min(
            input.playedSeconds,
            maxHeartbeatSeconds,
            elapsedSeconds + heartbeatClockSkewSeconds,
            remaining ?? maxHeartbeatSeconds
          )
        );

        await transaction`
          insert into platform_playback_heartbeats (
            session_id,
            sequence,
            reported_seconds,
            credited_seconds,
            idempotency_key,
            request_hash
          )
          values (
            ${session.id},
            ${input.sequence},
            ${input.playedSeconds},
            ${creditedSeconds},
            ${input.idempotencyKey},
            ${input.requestHash}
          )
        `;
        await transaction`
          update platform_usage_windows
          set
            public_media_seconds = public_media_seconds + ${creditedSeconds},
            updated_at = now()
          where user_id = ${actorId}
            and window_starts_at = ${session.window_starts_at}
        `;
        const exhausted = remaining !== null && creditedSeconds >= remaining;
        const updatedRows = await transaction<PlaybackSessionRow[]>`
          update platform_playback_sessions
          set
            state = case when ${exhausted} then 'exhausted' else state end,
            consumed_seconds = consumed_seconds + ${creditedSeconds},
            last_sequence = ${input.sequence},
            last_heartbeat_at = ${now},
            updated_at = now()
          where id = ${session.id}
          returning *
        `;
        const updated = updatedRows[0];
        if (!updated) throw new SubscriptionRepositoryConfigurationError();

        return toPlaybackSession(updated, await resolvePlatformAccess(transaction, actorId));
      });
    }
  };
}

async function findActorId(sql: QuerySql, supabaseUserId: string): Promise<string> {
  const rows = await sql<{ id: string }[]>`
    select id from users where supabase_user_id = ${supabaseUserId} limit 1
  `;
  const actor = rows[0];
  if (!actor) throw new SubscriptionRepositoryConfigurationError();
  return actor.id;
}

async function resolvePlatformAccess(sql: QuerySql, actorId: string): Promise<PlatformAccess> {
  const tiers = await sql<PlatformTierRow[]>`
    select
      policy.tier_key,
      policy.label,
      policy.rank,
      policy.monthly_price_minor,
      policy.currency,
      policy.public_media_allowance_seconds,
      policy.subscription_plan_id,
      policy.capabilities,
      plan.state as subscription_plan_state,
      plan.provider_state
    from platform_tier_policies policy
    left join subscription_plans plan on plan.id = policy.subscription_plan_id
    where policy.state = 'active'
    order by policy.rank
  `;
  const freeTier = tiers.find((tier) => tier.tier_key === "free_verified");
  if (!freeTier) throw new SubscriptionRepositoryConfigurationError();

  const candidates = await sql<{ tier_key: PlatformTierRow["tier_key"] }[]>`
    select policy.tier_key
    from platform_tier_policies policy
    where policy.state = 'active'
      and (
        exists (
          select 1
          from subscriptions subscription
          where subscription.subscriber_user_id = ${actorId}
            and subscription.plan_id = policy.subscription_plan_id
            and subscription.state in ('active', 'renewal_pending', 'grace_period')
            and subscription.current_period_starts_at is not null
            and subscription.current_period_starts_at <= now()
            and subscription.current_period_ends_at is not null
            and subscription.current_period_ends_at > now()
        )
        or exists (
          select 1
          from tier_waivers waiver
          where waiver.subject_type in ('user', 'creator')
            and waiver.subject_id = ${actorId}
            and waiver.tier_key = policy.tier_key
            and waiver.state = 'active'
            and waiver.starts_at <= now()
            and (waiver.ends_at is null or waiver.ends_at > now())
        )
        or (
          policy.tier_key = 'enterprise'
          and exists (
            select 1
            from organization_memberships membership
            join organizations organization on organization.id = membership.organization_id
            join tier_waivers waiver
              on waiver.subject_type = 'organization'
             and waiver.subject_id = organization.id
             and waiver.tier_key = 'enterprise'
             and waiver.state = 'active'
             and waiver.starts_at <= now()
             and (waiver.ends_at is null or waiver.ends_at > now())
            where membership.user_id = ${actorId}
              and membership.state = 'active'
              and organization.state = 'active'
              and organization.kyb_state = 'verified'
          )
        )
      )
    order by policy.rank desc
    limit 1
  `;
  const currentTier = tiers.find((tier) => tier.tier_key === candidates[0]?.tier_key) ?? freeTier;
  const usageRows = await sql<PlatformUsageRow[]>`
    select window_starts_at, window_ends_at, public_media_seconds
    from platform_usage_windows
    where user_id = ${actorId}
      and window_starts_at <= now()
      and window_ends_at > now()
    order by window_starts_at desc
    limit 1
  `;
  const clockRows = await sql<{ window_starts_at: Date; window_ends_at: Date }[]>`
    select
      date_trunc('month', now()) as window_starts_at,
      date_trunc('month', now()) + interval '1 month' as window_ends_at
  `;
  const clock = clockRows[0];
  if (!clock) throw new SubscriptionRepositoryConfigurationError();
  const usage = usageRows[0];
  const publicMediaSeconds = Number(usage?.public_media_seconds ?? 0);
  const allowance = nullableNumber(currentTier.public_media_allowance_seconds);
  const remaining = allowance === null ? null : Math.max(0, allowance - publicMediaSeconds);

  return {
    currentTier: toPlatformTier(currentTier),
    usage: {
      windowStartsAt: (usage?.window_starts_at ?? clock.window_starts_at).toISOString(),
      windowEndsAt: (usage?.window_ends_at ?? clock.window_ends_at).toISOString(),
      publicMediaSeconds,
      remainingPublicMediaSeconds: remaining,
      limitReached: remaining !== null && remaining === 0
    },
    tiers: tiers.map(toPlatformTier),
    policyBoundary: "platform_tiers_buy_software_and_public_media_allowance_never_social_priority"
  };
}

async function isQualifyingPublicPlayback(
  sql: QuerySql,
  input: { actorId: string; targetType: "content" | "live_room"; targetId: string }
): Promise<boolean> {
  if (input.targetType === "content") {
    const rows = await sql<{ qualifies: boolean }[]>`
      select exists (
        select 1
        from content_items content
        where content.id = ${input.targetId}
          and content.creator_user_id <> ${input.actorId}
          and content.media_type in ('vod', 'live_replay')
          and content.state = 'ready'
          and content.publish_state = 'published'
          and content.visibility = 'public'
          and content.moderation_state = 'approved'
          and not exists (
            select 1
            from content_access_rules rule
            where rule.content_item_id = content.id
              and rule.state = 'active'
              and (rule.starts_at is null or rule.starts_at <= now())
              and (rule.ends_at is null or rule.ends_at > now())
              and rule.access_type <> 'free'
          )
          and not exists (
            select 1
            from entitlements entitlement
            where entitlement.user_id = ${input.actorId}
              and entitlement.target_type = 'content'
              and entitlement.target_id = content.id
              and entitlement.state = 'active'
              and entitlement.starts_at <= now()
              and (entitlement.ends_at is null or entitlement.ends_at > now())
          )
      ) as qualifies
    `;
    return Boolean(rows[0]?.qualifies);
  }

  const rows = await sql<{ qualifies: boolean }[]>`
    select exists (
      select 1
      from live_rooms room
      where room.id = ${input.targetId}
        and room.creator_user_id <> ${input.actorId}
        and room.access_rule = 'public'
        and room.state = 'live'
    ) as qualifies
  `;
  return Boolean(rows[0]?.qualifies);
}

async function findSessionByIdempotency(
  sql: QuerySql,
  actorId: string,
  idempotencyKey: string
): Promise<PlaybackSessionRow | null> {
  const rows = await sql<PlaybackSessionRow[]>`
    select *
    from platform_playback_sessions
    where user_id = ${actorId}
      and idempotency_key = ${idempotencyKey}
    limit 1
  `;
  return rows[0] ?? null;
}

async function updateSessionState(
  sql: QuerySql,
  sessionId: string,
  state: "closed" | "expired"
): Promise<PlaybackSessionRow> {
  const rows = await sql<PlaybackSessionRow[]>`
    update platform_playback_sessions
    set state = ${state}, updated_at = now()
    where id = ${sessionId}
    returning *
  `;
  const row = rows[0];
  if (!row) throw new SubscriptionRepositoryConfigurationError();
  return row;
}

function toPlaybackSession(
  row: PlaybackSessionRow,
  access: PlatformAccess
): PlatformPlaybackSession {
  return {
    id: row.id,
    state: row.state,
    heartbeatIntervalSeconds,
    consumedSeconds: Number(row.consumed_seconds),
    usage: access.usage
  };
}

interface PlatformTierRow {
  tier_key: "free_verified" | "veel_plus" | "veel_ultra" | "veel_studio" | "enterprise";
  label: string;
  rank: number;
  monthly_price_minor: string | number | null;
  currency: "USDC" | null;
  public_media_allowance_seconds: string | number | null;
  subscription_plan_id: string | null;
  capabilities: string[];
  subscription_plan_state: "active" | "disabled" | null;
  provider_state: "staging_required" | "launch_approved" | "disabled" | null;
}

interface PlatformUsageRow {
  window_starts_at: Date;
  window_ends_at: Date;
  public_media_seconds: string | number;
}

interface PlaybackSessionRow {
  id: string;
  user_id: string;
  target_type: "content" | "live_room";
  target_id: string;
  state: PlatformPlaybackSession["state"];
  window_starts_at: Date;
  window_ends_at: Date;
  consumed_seconds: string | number;
  last_sequence: number;
  last_heartbeat_at: Date;
  idempotency_key: string;
  request_hash: string;
}

interface HeartbeatReplayRow extends PlaybackSessionRow {
  heartbeat_request_hash: string;
}

function nullableNumber(value: string | number | null): number | null {
  return value === null ? null : Number(value);
}

function toPlatformTier(row: PlatformTierRow): PlatformAccess["currentTier"] {
  const purchaseState = row.tier_key === "free_verified"
    ? "included" as const
    : row.tier_key === "enterprise"
      ? "contact_sales" as const
      : row.subscription_plan_state === "active" && row.provider_state === "launch_approved"
        ? "available" as const
        : "unavailable" as const;

  return {
    key: row.tier_key,
    label: row.label,
    rank: row.rank,
    monthlyPriceMinor: nullableNumber(row.monthly_price_minor),
    currency: row.currency,
    publicMediaAllowanceSeconds: nullableNumber(row.public_media_allowance_seconds),
    capabilities: row.capabilities,
    purchaseState,
    subscriptionPlanId: row.subscription_plan_id
  };
}
