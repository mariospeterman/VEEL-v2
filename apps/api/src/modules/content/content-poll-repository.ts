import type postgres from "postgres";
import { ContentPollVoteConflictError } from "./content-errors.js";
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

        const polls = await transaction<{ state: Poll["state"]; closes_at: Date | null }[]>`
          select poll.state, poll.closes_at
          from content_polls poll
          join content_items item on item.id = poll.content_item_id
          where poll.content_item_id = ${input.contentId}
            and item.media_type = 'poll'
            and item.publish_state = 'published'
            and exists (
              select 1 from private.eligible_content(${input.appUserId}, null) eligible
              where eligible.content_item_id = item.id
            )
          for update of poll
        `;
        const poll = polls[0];
        if (!poll) return null;
        if (poll.state !== "open" || (poll.closes_at && poll.closes_at.getTime() <= Date.now())) {
          throw new ContentPollVoteConflictError("poll_closed");
        }

        const options = await transaction<{ id: string }[]>`
          select id from content_poll_options
          where content_item_id = ${input.contentId} and id = ${input.optionId}
        `;
        if (!options[0]) return null;
        if (!receipt.response_body?.contentId) {
          const previous = await transaction<{ option_id: string }[]>`
            select option_id from content_poll_votes
            where content_item_id = ${input.contentId} and voter_user_id = ${input.appUserId}
          `;
          const optionIds = [...new Set([input.optionId, previous[0]?.option_id].filter((value): value is string => Boolean(value)))].sort();
          await transaction`
            select id from content_poll_options
            where content_item_id = ${input.contentId} and id = any(${optionIds})
            order by id for update
          `;
          await transaction`
            insert into content_poll_votes (content_item_id, option_id, voter_user_id, idempotency_key, request_hash)
            values (${input.contentId}, ${input.optionId}, ${input.appUserId}, ${input.idempotencyKey}, ${input.requestHash})
            on conflict (content_item_id, voter_user_id) do update set
              option_id = excluded.option_id,
              idempotency_key = excluded.idempotency_key,
              request_hash = excluded.request_hash,
              updated_at = now()
          `;
          await transaction`
            update idempotency_keys set response_status = 200,
              response_body = ${transaction.json({ contentId: input.contentId, optionId: input.optionId })}::jsonb
            where key = ${storedKey}
          `;
        }
        return selectPoll(transaction, input.contentId, input.appUserId);
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
    from content_polls poll where poll.content_item_id = ${contentId}
  `;
  return rows[0] ? normalizeContentPoll(rows[0].poll) : null;
}
