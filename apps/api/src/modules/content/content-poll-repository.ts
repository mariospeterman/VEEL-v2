import type postgres from "postgres";
import { ContentFormatRetiredError, ContentPollVoteConflictError } from "./content-errors.js";
import { normalizeContentPoll } from "./content-repository-mappers.js";
import type { ContentItem, ContentRepository } from "./types.js";

type Poll = NonNullable<ContentItem["poll"]>;

export function createContentPollRepositoryMethods(sql: postgres.Sql): Pick<ContentRepository, "voteOnPoll"> {
  return {
    async voteOnPoll(input) {
      return sql.begin(async (transaction) => {
        await transaction`select pg_advisory_xact_lock(hashtextextended(${`${input.contentId}:${input.appUserId}`}, 0))`;
        const storedKey = `content:poll-vote:${input.appUserId}:${input.idempotencyKey}`;
        await transaction`
          insert into idempotency_keys (key, actor_user_id, scope, request_hash, expires_at)
          values (${storedKey}, ${input.appUserId}, 'content.poll_vote', ${input.requestHash}, 'infinity'::timestamptz)
          on conflict (key) do nothing
        `;
        const receipts = await transaction<{ request_hash: string; response_body: { contentId?: string } | null }[]>`
          select request_hash, response_body from idempotency_keys where key = ${storedKey} for update
        `;
        const receipt = receipts[0];
        if (!receipt || receipt.request_hash !== input.requestHash) throw new ContentPollVoteConflictError("idempotency_conflict");

        if (receipt.response_body?.contentId) {
          return selectPoll(transaction, input.contentId, input.appUserId);
        }

        throw new ContentFormatRetiredError();
      });
    }
  };
}

async function selectPoll(sql: postgres.TransactionSql, contentId: string, appUserId: string): Promise<Poll | null> {
  const rows = await sql<{ poll: Poll }[]>`
    select jsonb_build_object(
      'question', poll.question,
      'options', coalesce((select jsonb_agg(jsonb_build_object(
        'id', option.id, 'position', option.position, 'text', option.option_text, 'voteCount', option.vote_count
      ) order by option.position) from content_poll_options option where option.content_item_id = poll.content_item_id), '[]'::jsonb),
      'state', poll.state,
      'totalVoteCount', coalesce((select sum(option.vote_count) from content_poll_options option where option.content_item_id = poll.content_item_id), 0),
      'closesAt', poll.closes_at,
      'viewerOptionId', (select vote.option_id from content_poll_votes vote where vote.content_item_id = poll.content_item_id and vote.voter_user_id = ${appUserId})
    ) as poll
    from content_polls poll
    where poll.content_item_id = ${contentId}
      and exists (
        select 1
        from private.eligible_content(${appUserId}, null) eligible
        where eligible.content_item_id = poll.content_item_id
      )
  `;
  return rows[0] ? normalizeContentPoll(rows[0].poll) : null;
}
