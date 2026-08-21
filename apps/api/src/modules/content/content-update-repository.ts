import { createHash, randomUUID } from "node:crypto";
import type postgres from "postgres";
import { ContentCompositionConflictError, ContentEventDraftConflictError } from "./content-errors.js";
import { extractHashtagSlugs, toContentItem } from "./content-repository-mappers.js";
import type { ContentRow } from "./content-repository-rows.js";
import type { ContentRepository, UpdateOwnedContentInput } from "./types.js";
import { recordContentSafetyDeclaration } from "./content-safety-repository.js";

interface ContentUpdateRow extends ContentRow {
  representation_mode: UpdateOwnedContentInput["representationMode"] | "not_declared" | null;
}

export function createContentUpdateRepositoryMethods(
  sql: postgres.Sql
): Pick<ContentRepository, "findOwnedContentForUpdate" | "updateOwnedContent"> {
  return {
    async findOwnedContentForUpdate(input) {
      const rows = await sql<{
        id: string;
        media_type: ContentRow["media_type"];
        caption: string | null;
        nsfw_label: NonNullable<ContentRow["nsfw_label"]>;
      }[]>`
        select ci.id, ci.media_type, ci.caption, ci.nsfw_label
        from content_items ci
        join users u on u.id = ci.creator_user_id
        where ci.id = ${input.contentId}
          and u.supabase_user_id = ${input.supabaseUserId}
          and ci.state <> 'deleted'
        limit 1
      `;
      const row = rows[0];
      return row
        ? {
            id: row.id,
            mediaType: row.media_type,
            caption: row.caption,
            nsfwLabel: row.nsfw_label
          }
        : null;
    },
    async updateOwnedContent(input) {
      const result = await sql.begin(async (transaction) => {
        const actorRows = await transaction<{ id: string }[]>`
          select id from users where supabase_user_id = ${input.supabaseUserId} limit 1
        `;
        const actor = actorRows[0];
        if (!actor) return null;

        let compositionReceiptKey: string | null = null;
        if (input.bodyTextProvided) {
          compositionReceiptKey = `content:update:${actor.id}:${input.idempotencyKey}`;
          await transaction`
            insert into idempotency_keys (key, actor_user_id, scope, request_hash, expires_at)
            values (${compositionReceiptKey}, ${actor.id}, 'content.update', ${input.requestHash ?? ""}, 'infinity'::timestamptz)
            on conflict (key) do nothing
          `;
          const receipts = await transaction<{ request_hash: string; response_body: { contentId?: string } | null }[]>`
            select request_hash, response_body from idempotency_keys where key = ${compositionReceiptKey} for update
          `;
          const receipt = receipts[0];
          if (!receipt || receipt.request_hash !== input.requestHash) {
            throw new ContentCompositionConflictError("idempotency_conflict");
          }
          if (receipt.response_body?.contentId) {
            const replay = await selectOwnedCompositionRow(transaction, receipt.response_body.contentId, actor.id);
            return replay ? toContentItem(replay, null) : null;
          }

          const drafts = await transaction<{ media_type: string; publish_state: string; asset_revision: number }[]>`
            select media_type, publish_state, asset_revision
            from content_items
            where id = ${input.contentId} and creator_user_id = ${actor.id}
            for update
          `;
          const draft = drafts[0];
          if (!draft) return null;
          if (draft.media_type !== "text" || !["draft", "unpublished"].includes(draft.publish_state)) {
            throw new ContentCompositionConflictError("composition_locked");
          }
          if (Number(draft.asset_revision) !== input.expectedCompositionRevision) {
            throw new ContentCompositionConflictError("revision_conflict");
          }
        }

        const rows = await transaction<ContentUpdateRow[]>`
          with actor as (
            select id
            from users
            where supabase_user_id = ${input.supabaseUserId}
            limit 1
          ),
          current_safety as (
            select
              ci.id,
              coalesce((
                select declaration.representation_mode
                from content_safety_declarations declaration
                where declaration.content_item_id = ci.id
                  and declaration.state = 'active'
                limit 1
              ), 'not_declared') as representation_mode
            from content_items ci
            where ci.id = ${input.contentId}
          ),
          updated_content as (
            update content_items ci
            set
              caption = case when ${input.captionProvided} then ${input.caption ?? null} else ci.caption end,
              body_text = case when ${input.bodyTextProvided} then ${input.bodyText ?? null} else ci.body_text end,
              asset_revision = case when ${input.bodyTextProvided} then ci.asset_revision + 1 else ci.asset_revision end,
              visibility = case when ${Boolean(input.visibility)} then ${input.visibility ?? ""} else ci.visibility end,
              nsfw_label = case when ${Boolean(input.nsfwLabel)} then ${input.nsfwLabel ?? ""} else ci.nsfw_label end,
              publish_state = case
                when ci.publish_state = 'published' and (
                  (${Boolean(input.nsfwLabel)} and ci.nsfw_label is distinct from ${input.nsfwLabel ?? ""})
                  or (
                    ${Boolean(input.representationMode)}
                    and safety.representation_mode is distinct from ${input.representationMode ?? "not_declared"}
                  )
                ) then 'submitted_for_review'
                else ci.publish_state
              end,
              moderation_state = case
                when ci.publish_state = 'published' and (
                  (${Boolean(input.nsfwLabel)} and ci.nsfw_label is distinct from ${input.nsfwLabel ?? ""})
                  or (
                    ${Boolean(input.representationMode)}
                    and safety.representation_mode is distinct from ${input.representationMode ?? "not_declared"}
                  )
                ) then 'pending'
                else ci.moderation_state
              end,
              published_at = case
                when ci.publish_state = 'published' and (
                  (${Boolean(input.nsfwLabel)} and ci.nsfw_label is distinct from ${input.nsfwLabel ?? ""})
                  or (
                    ${Boolean(input.representationMode)}
                    and safety.representation_mode is distinct from ${input.representationMode ?? "not_declared"}
                  )
                ) then null
                else ci.published_at
              end,
              updated_at = now()
            from actor, current_safety safety
            where ci.id = ${input.contentId}
              and safety.id = ci.id
              and ci.creator_user_id = actor.id
              and ci.state <> 'deleted'
            returning ci.id, ci.creator_user_id, ci.media_type, ci.caption, ci.body_text, ci.asset_revision, ci.nsfw_label
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
            ci.body_text,
            ci.asset_revision,
            ci.nsfw_label,
            u.id as creator_id,
            p.handle,
            p.display_name,
            p.avatar_url,
            (
              select declaration.representation_mode
              from content_safety_declarations declaration
              where declaration.content_item_id = ci.id
                and declaration.state = 'active'
              limit 1
            ) as representation_mode
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
            representationMode: input.representationMode ?? row.representation_mode ?? "not_declared",
            policyAccepted: input.contentSafetyPolicyAccepted
          });
        }

        await upsertLinkedEventDraft(transaction, input, row.id, row.creator_id);

        if (compositionReceiptKey) {
          await transaction`
            update idempotency_keys
            set response_status = 200, response_body = ${transaction.json({ contentId: row.id })}::jsonb
            where key = ${compositionReceiptKey}
          `;
        }

        return toContentItem(row, null);
      });

      return result;
    }
  };
}

async function selectOwnedCompositionRow(
  transaction: postgres.TransactionSql,
  contentId: string,
  creatorUserId: string
): Promise<ContentUpdateRow | null> {
  const rows = await transaction<ContentUpdateRow[]>`
    select ci.id, ci.media_type, ci.caption, ci.body_text, ci.asset_revision, ci.nsfw_label,
      u.id as creator_id, p.handle, p.display_name, p.avatar_url, 'not_declared'::text as representation_mode
    from content_items ci
    join users u on u.id = ci.creator_user_id
    left join profiles p on p.user_id = u.id
    where ci.id = ${contentId} and ci.creator_user_id = ${creatorUserId}
    limit 1
  `;
  return rows[0] ?? null;
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
