import { randomUUID } from "node:crypto";
import type postgres from "postgres";
import {
  ContentDraftIdempotencyConflictError,
  ContentDraftQuotaExceededError,
  ContentRepositoryConfigurationError
} from "./content-errors.js";
import { extractHashtagSlugs, toContentItem } from "./content-repository-mappers.js";
import type { ContentRow } from "./content-repository-rows.js";
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
          delete from idempotency_keys
          where key = ${storedKey}
            and expires_at <= now()
        `;
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
            now() + interval '24 hours'
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
          if (existing) return existing;
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
            caption,
            visibility,
            nsfw_label
          )
          values (
            ${contentId},
            ${user.id},
            ${input.mediaType},
            ${input.caption ?? null},
            ${input.visibility},
            ${input.nsfwLabel}
          )
        `;

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

async function selectContentRow(
  sql: postgres.TransactionSql,
  input: { contentId: string; creatorUserId: string }
): Promise<ContentRow | null> {
  const rows = await sql<ContentRow[]>`
    select
      ci.id,
      ci.media_type,
      ci.caption,
      ci.nsfw_label,
      u.id as creator_id,
      p.handle,
      p.display_name,
      p.avatar_url
    from content_items ci
    join users u on u.id = ci.creator_user_id
    left join profiles p on p.user_id = u.id
    where ci.id = ${input.contentId}
      and ci.creator_user_id = ${input.creatorUserId}
    limit 1
  `;

  return rows[0] ?? null;
}
