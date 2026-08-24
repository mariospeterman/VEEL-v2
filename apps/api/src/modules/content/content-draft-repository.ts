import { randomUUID } from "node:crypto";
import type postgres from "postgres";
import {
  ContentDraftIdempotencyConflictError,
  ContentDraftOriginConflictError,
  ContentDraftPollCloseError,
  ContentDraftQuotaExceededError,
  ContentRepositoryConfigurationError
} from "./content-errors.js";
import { extractHashtagSlugs, toContentItem } from "./content-repository-mappers.js";
import type { ContentRow } from "./content-repository-rows.js";
import { recordContentSafetyDeclaration } from "./content-safety-repository.js";
import type { ContentRepository } from "./types.js";

export function createContentDraftRepositoryMethods(
  sql: postgres.Sql
): Pick<ContentRepository, "createDraft"> {
  return {
    async createDraft(input) {
      const hashtags = extractHashtagSlugs(input.caption);
      const row = await sql.begin(async (transaction) => {
        const users = await transaction<{ id: string }[]>`
          select id
          from users
          where supabase_user_id = ${input.supabaseUserId}
          limit 1
        `;
        const user = users[0];

        if (!user) {
          throw new ContentRepositoryConfigurationError();
        }

        await transaction`select pg_advisory_xact_lock(hashtextextended(${user.id}, 0))`;
        const storedKey = `content:create:${user.id}:${input.idempotencyKey}`;

        await transaction`
          insert into idempotency_keys (
            key,
            actor_user_id,
            scope,
            request_hash,
            expires_at
          )
          values (
            ${storedKey},
            ${user.id},
            'content.create',
            ${input.requestHash},
            'infinity'::timestamptz
          )
          on conflict (key) do nothing
        `;

        const idempotencyRows = await transaction<{
          request_hash: string;
          response_body: { contentId?: string } | null;
        }[]>`
          select request_hash, response_body
          from idempotency_keys
          where key = ${storedKey}
          for update
        `;
        const idempotency = idempotencyRows[0];

        if (!idempotency || idempotency.request_hash !== input.requestHash) {
          throw new ContentDraftIdempotencyConflictError();
        }

        if (idempotency.response_body?.contentId) {
          const existing = await selectContentRow(transaction, {
            contentId: idempotency.response_body.contentId,
            creatorUserId: user.id
          });
          if (existing) {
            await recordDraftOrigin(transaction, user.id, existing.id, input.origin);
            return existing;
          }
        }

        if (
          input.poll?.closesAt &&
          (Number.isNaN(Date.parse(input.poll.closesAt)) || Date.parse(input.poll.closesAt) <= Date.now())
        ) {
          throw new ContentDraftPollCloseError();
        }

        const counts = await transaction<{ count: number }[]>`
          select count(*)::integer as count
          from content_items
          where creator_user_id = ${user.id}
            and created_at >= ${input.quotaWindowStart}
        `;

        if ((counts[0]?.count ?? 0) >= input.dailyDraftQuota) {
          throw new ContentDraftQuotaExceededError();
        }

        const contentId = randomUUID();
        await transaction`
          insert into content_items (
            id,
            creator_user_id,
            media_type,
            distribution_mode,
            scheduled_for,
            caption,
            body_text,
            visibility,
            nsfw_label
          )
          values (
            ${contentId},
            ${user.id},
            ${input.mediaType},
            ${input.distributionMode ?? "post"},
            ${input.scheduledFor ?? null},
            ${input.caption ?? null},
            ${input.bodyText ?? null},
            ${input.visibility},
            ${input.nsfwLabel}
          )
        `;

        if (input.poll) {
          await transaction`
            insert into content_polls (
              content_item_id,
              question,
              closes_at
            )
            values (
              ${contentId},
              ${input.poll.question},
              ${input.poll.closesAt ?? null}
            )
          `;

          for (const [position, optionText] of input.poll.options.entries()) {
            await transaction`
              insert into content_poll_options (
                id,
                content_item_id,
                position,
                option_text
              )
              values (
                ${randomUUID()},
                ${contentId},
                ${position},
                ${optionText}
              )
            `;
          }
        }

        await recordContentSafetyDeclaration(transaction, {
          contentId,
          creatorUserId: user.id,
          rating: input.nsfwLabel,
          representationMode: input.representationMode,
          policyAccepted: input.contentSafetyPolicyAccepted
        });

        await recordDraftOrigin(transaction, user.id, contentId, input.origin);

        if (hashtags.length > 0) {
          for (const slug of hashtags) {
            const displayName = `#${slug}`;
            await transaction`
              insert into hashtags (id, slug, display_name)
              values (${randomUUID()}, ${slug}, ${displayName})
              on conflict (slug) do nothing
            `;
            await transaction`
              insert into content_hashtags (content_item_id, hashtag_id, source)
              select ${contentId}, id, 'caption'
              from hashtags
              where slug = ${slug}
              on conflict (content_item_id, hashtag_id) do nothing
            `;
          }
        }

        await transaction`
          update idempotency_keys
          set
            response_status = 201,
            response_body = ${transaction.json({ contentId })}::jsonb
          where key = ${storedKey}
        `;

        const created = await selectContentRow(transaction, {
          contentId,
          creatorUserId: user.id
        });
        if (!created) throw new ContentRepositoryConfigurationError();
        return created;
      });

      return toContentItem(row, null);
    }
  };
}

async function recordDraftOrigin(
  sql: postgres.TransactionSql,
  creatorUserId: string,
  contentId: string,
  origin: Parameters<ContentRepository["createDraft"]>[0]["origin"]
): Promise<void> {
  if (!origin) return;

  await sql`
    insert into mcp_private_draft_origins (
      id,
      connection_id,
      actor_user_id,
      content_item_id,
      tool_name,
      tool_version,
      request_hash
    )
    select
      ${randomUUID()},
      connection.id,
      ${creatorUserId},
      ${contentId},
      ${origin.toolName},
      ${origin.toolVersion},
      ${origin.requestHash}
    from mcp_connections connection
    where connection.id = ${origin.connectionId}
      and connection.actor_user_id = ${creatorUserId}
      and connection.state = 'active'
      and connection.expires_at > now()
    on conflict (content_item_id) do nothing
  `;

  const rows = await sql<Array<{
    connection_id: string;
    actor_user_id: string;
    tool_name: string;
    tool_version: string;
    request_hash: string;
  }>>`
    select connection_id, actor_user_id, tool_name, tool_version, request_hash
    from mcp_private_draft_origins
    where content_item_id = ${contentId}
    limit 1
  `;
  const recorded = rows[0];
  if (
    !recorded ||
    recorded.connection_id !== origin.connectionId ||
    recorded.actor_user_id !== creatorUserId ||
    recorded.tool_name !== origin.toolName ||
    recorded.tool_version !== origin.toolVersion ||
    recorded.request_hash !== origin.requestHash
  ) {
    throw new ContentDraftOriginConflictError();
  }
}

async function selectContentRow(
  sql: postgres.TransactionSql,
  input: { contentId: string; creatorUserId: string }
): Promise<ContentRow | null> {
  const rows = await sql<ContentRow[]>`
    select
      ci.id,
      ci.media_type,
      ci.distribution_mode,
      ci.expires_at,
      ci.scheduled_for,
      ci.caption,
      ci.body_text,
      ci.asset_revision,
      ci.nsfw_label,
      u.id as creator_id,
      p.handle,
      p.display_name,
      p.avatar_url,
      poll_projection.poll
    from content_items ci
    join users u on u.id = ci.creator_user_id
    left join profiles p on p.user_id = u.id
    left join lateral (
      select jsonb_build_object(
        'question', poll.question,
        'options', coalesce((
          select jsonb_agg(
            jsonb_build_object(
              'id', option.id,
              'position', option.position,
              'text', option.option_text,
              'voteCount', option.vote_count
            )
            order by option.position
          )
          from content_poll_options option
          where option.content_item_id = poll.content_item_id
        ), '[]'::jsonb),
        'state', poll.state,
        'totalVoteCount', coalesce((
          select sum(option.vote_count)
          from content_poll_options option
          where option.content_item_id = poll.content_item_id
        ), 0),
        'closesAt', poll.closes_at,
        'viewerOptionId', null
      ) as poll
      from content_polls poll
      where poll.content_item_id = ci.id
    ) poll_projection on true
    where ci.id = ${input.contentId}
      and ci.creator_user_id = ${input.creatorUserId}
    limit 1
  `;

  return rows[0] ?? null;
}
