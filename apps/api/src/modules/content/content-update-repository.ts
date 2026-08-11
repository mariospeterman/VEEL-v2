import { createHash, randomUUID } from "node:crypto";
import type postgres from "postgres";
import { ContentEventDraftConflictError } from "./content-errors.js";
import { extractHashtagSlugs, toContentItem } from "./content-repository-mappers.js";
import type { ContentRow } from "./content-repository-rows.js";
import type { ContentRepository, UpdateOwnedContentInput } from "./types.js";
import { recordContentSafetyDeclaration } from "./content-safety-repository.js";

export function createContentUpdateRepositoryMethods(
  sql: postgres.Sql
): Pick<ContentRepository, "updateOwnedContent"> {
  return {
    async updateOwnedContent(input) {
      const result = await sql.begin(async (transaction) => {
        const rows = await transaction<ContentRow[]>`
          with actor as (
            select id
            from users
            where supabase_user_id = ${input.supabaseUserId}
            limit 1
          ),
          updated_content as (
            update content_items ci
            set
              caption = case when ${input.captionProvided} then ${input.caption ?? null} else ci.caption end,
              visibility = case when ${Boolean(input.visibility)} then ${input.visibility ?? ""} else ci.visibility end,
              nsfw_label = case when ${Boolean(input.nsfwLabel)} then ${input.nsfwLabel ?? ""} else ci.nsfw_label end,
              updated_at = now()
            from actor
            where ci.id = ${input.contentId}
              and ci.creator_user_id = actor.id
              and ci.state <> 'deleted'
            returning ci.id, ci.creator_user_id, ci.media_type, ci.caption, ci.nsfw_label
          ),
          updated_media as (
            update media_assets ma
            set
              teaser_start_ms = case
                when ${input.teaserStartMsProvided} then ${input.teaserStartMs ?? null}
                else ma.teaser_start_ms
              end,
              teaser_end_ms = case
                when ${input.teaserEndMsProvided} then ${input.teaserEndMs ?? null}
                else ma.teaser_end_ms
              end,
              thumbnail_frame_ms = case
                when ${input.thumbnailFrameMsProvided} then ${input.thumbnailFrameMs ?? null}
                else ma.thumbnail_frame_ms
              end
            where ma.content_item_id = (select id from updated_content)
            returning ma.id
          )
          select
            ci.id,
            ci.media_type,
            ci.caption,
            ci.nsfw_label,
            u.id as creator_id,
            p.handle,
            p.display_name,
            p.avatar_url
          from updated_content ci
          join users u on u.id = ci.creator_user_id
          left join profiles p on p.user_id = u.id
          limit 1
        `;

        const row = rows[0];

        if (!row) {
          return null;
        }

        if (input.captionProvided) {
          await replaceCaptionHashtags(transaction, row.id, input.caption);
        }

        if (input.nsfwLabel || input.representationMode) {
          await recordContentSafetyDeclaration(transaction, {
            contentId: row.id,
            creatorUserId: row.creator_id,
            rating: row.nsfw_label ?? "none",
            representationMode:
              row.nsfw_label === "none" ? "not_declared" : input.representationMode ?? "not_declared",
            policyAccepted: row.nsfw_label === "none" ? false : input.contentSafetyPolicyAccepted
          });
        }

        await upsertLinkedEventDraft(transaction, input, row.id, row.creator_id);

        return toContentItem(row, null);
      });

      return result;
    }
  };
}

async function upsertLinkedEventDraft(
  transaction: postgres.TransactionSql,
  input: UpdateOwnedContentInput,
  contentId: string,
  creatorUserId: string
): Promise<void> {
  if (!input.eventDraftProvided || !input.eventDraft) {
    return;
  }

  const existingRows = await transaction<{ id: string; state: string }[]>`
    select id, state
    from events
    where content_item_id = ${contentId}
      and creator_user_id = ${creatorUserId}
    limit 1
  `;
  const existing = existingRows[0];

  if (existing && existing.state !== "draft") {
    throw new ContentEventDraftConflictError();
  }

  const eventDraft = input.eventDraft;
  const eventId = existing?.id ?? randomUUID();

  if (existing) {
    await transaction`
      update events
      set
        title = ${eventDraft.title.trim()},
        description = ${eventDraft.description?.trim() || null},
        starts_at = ${eventDraft.startsAt},
        ends_at = ${eventDraft.endsAt ?? null},
        event_type = ${eventDraft.location.type},
        location_type = ${eventDraft.location.type},
        location_label = ${eventDraft.location.label?.trim() || null},
        location_lat = ${eventDraft.location.latitude ?? null},
        location_lng = ${eventDraft.location.longitude ?? null},
        access_rule = ${eventDraft.accessRule},
        request_hash = ${hashJson(eventDraft)},
        updated_at = now()
      where id = ${eventId}
    `;
  } else {
    await transaction`
      insert into events (
        id,
        creator_user_id,
        content_item_id,
        title,
        description,
        starts_at,
        ends_at,
        event_type,
        location_type,
        location_label,
        location_lat,
        location_lng,
        access_rule,
        idempotency_key,
        request_hash
      )
      values (
        ${eventId},
        ${creatorUserId},
        ${contentId},
        ${eventDraft.title.trim()},
        ${eventDraft.description?.trim() || null},
        ${eventDraft.startsAt},
        ${eventDraft.endsAt ?? null},
        ${eventDraft.location.type},
        ${eventDraft.location.type},
        ${eventDraft.location.label?.trim() || null},
        ${eventDraft.location.latitude ?? null},
        ${eventDraft.location.longitude ?? null},
        ${eventDraft.accessRule},
        ${`content:${contentId}:${input.idempotencyKey}`},
        ${hashJson(eventDraft)}
      )
    `;
  }

  await transaction`
    delete from event_access_pass_types
    where event_id = ${eventId}
  `;

  for (const accessPassType of eventDraft.accessPassTypes) {
    await transaction`
      insert into event_access_pass_types (
        id,
        event_id,
        label,
        price_minor,
        currency,
        capacity,
        sale_starts_at,
        sale_ends_at,
        per_user_limit
      )
      values (
        ${randomUUID()},
        ${eventId},
        ${accessPassType.label.trim()},
        ${accessPassType.priceMinor ?? null},
        ${accessPassType.currency},
        ${accessPassType.capacity},
        ${accessPassType.saleStartsAt ?? null},
        ${accessPassType.saleEndsAt ?? null},
        ${accessPassType.perUserLimit ?? 1}
      )
    `;
  }
}

function hashJson(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

async function replaceCaptionHashtags(
  transaction: postgres.TransactionSql,
  contentId: string,
  caption: string | null | undefined
): Promise<void> {
  await transaction`
    delete from content_hashtags
    where content_item_id = ${contentId}
      and source = 'caption'
  `;

  const hashtags = extractHashtagSlugs(caption);
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
