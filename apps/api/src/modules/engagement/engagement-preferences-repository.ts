import type postgres from "postgres";
import type { EngagementRepository } from "./types.js";
import { EngagementRepositoryConfigurationError } from "./engagement-errors.js";
import { toPreferences } from "./engagement-repository-mappers.js";
import type { PreferencesRow } from "./engagement-repository-rows.js";
import { insertAudit } from "./engagement-repository-sql.js";

type EngagementPreferencesRepositoryMethods = Pick<
  EngagementRepository,
  | "getFeedPreferences"
  | "hideCreator"
  | "hideTopic"
  | "resetFeedRecommendations"
  | "updateFeedPreferences"
>;

export function createEngagementPreferencesRepositoryMethods(
  sql: postgres.Sql
): EngagementPreferencesRepositoryMethods {
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
            coalesce(vfp.default_feed_mode, 'latest') as default_feed_mode,
            coalesce(vfp.nsfw_preference, 'both') as nsfw_preference
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
      return sql.begin(async (transaction) => {
        const actorRows = await transaction<{ id: string }[]>`
          select id from users where supabase_user_id = ${input.supabaseUserId} limit 1
        `;
        const actor = actorRows[0];
        if (!actor) return toPreferences(undefined);
        await transaction`
          insert into viewer_feed_preferences (
            user_id,
            default_feed_mode,
            nsfw_preference,
            updated_at
          )
          values (
            ${actor.id},
            coalesce(${input.body.defaultMode ?? null}, 'latest'),
            coalesce(${input.body.nsfwPreference ?? null}, 'both'),
            now()
          )
          on conflict (user_id) do update
          set
            default_feed_mode = coalesce(${input.body.defaultMode ?? null}, viewer_feed_preferences.default_feed_mode),
            nsfw_preference = coalesce(${input.body.nsfwPreference ?? null}, viewer_feed_preferences.nsfw_preference),
            updated_at = now()
        `;
        return toPreferences((await selectPreferencesForUser(transaction, actor.id))[0]);
      });
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
          values (${actor.id}, 'latest', 'both', now())
          on conflict (user_id) do update
          set default_feed_mode = 'latest', nsfw_preference = 'both', updated_at = now()
        `;
        await insertAudit(transaction, actor.id, "feed_preferences", actor.id, "feed.reset", {
          idempotencyKey: input.idempotencyKey
        });
      });
    },
    async hideCreator(input) {
      return sql.begin(async (transaction) => {
        const actorRows = await transaction<{ id: string }[]>`
          select id from users where supabase_user_id = ${input.supabaseUserId} limit 1
        `;
        const actor = actorRows[0];
        if (!actor) return toPreferences(undefined);
        await transaction`
          insert into viewer_hidden_creators (user_id, creator_user_id, idempotency_key)
          values (${actor.id}, ${input.creatorUserId}, ${input.idempotencyKey})
          on conflict (user_id, creator_user_id) do update
          set idempotency_key = viewer_hidden_creators.idempotency_key
        `;
        await transaction`
          insert into viewer_feed_preferences (user_id) values (${actor.id})
          on conflict (user_id) do nothing
        `;
        return toPreferences((await selectPreferencesForUser(transaction, actor.id))[0]);
      });
    },
    async hideTopic(input) {
      return sql.begin(async (transaction) => {
        const actorRows = await transaction<{ id: string }[]>`
          select id from users where supabase_user_id = ${input.supabaseUserId} limit 1
        `;
        const actor = actorRows[0];
        if (!actor) return toPreferences(undefined);
        await transaction`
          insert into viewer_hidden_topics (user_id, topic, idempotency_key)
          values (${actor.id}, lower(${input.topic}), ${input.idempotencyKey})
          on conflict (user_id, topic) do update
          set idempotency_key = viewer_hidden_topics.idempotency_key
        `;
        await transaction`
          insert into viewer_feed_preferences (user_id) values (${actor.id})
          on conflict (user_id) do nothing
        `;
        return toPreferences((await selectPreferencesForUser(transaction, actor.id))[0]);
      });
    }
  };
}

function selectPreferencesForUser(
  sql: postgres.Sql | postgres.TransactionSql,
  userId: string
): Promise<PreferencesRow[]> {
  return sql<PreferencesRow[]>`
    select
      vfp.default_feed_mode,
      vfp.nsfw_preference,
      coalesce(
        array_agg(distinct vhc.creator_user_id::text)
          filter (where vhc.creator_user_id is not null),
        array[]::text[]
      ) as hidden_creator_ids,
      coalesce(
        array_agg(distinct vht.topic)
          filter (where vht.topic is not null),
        array[]::text[]
      ) as hidden_topics
    from viewer_feed_preferences vfp
    left join viewer_hidden_creators vhc on vhc.user_id = vfp.user_id
    left join viewer_hidden_topics vht on vht.user_id = vfp.user_id
    where vfp.user_id = ${userId}
    group by vfp.user_id, vfp.default_feed_mode, vfp.nsfw_preference
  `;
}
