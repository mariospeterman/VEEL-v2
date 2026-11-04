import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createContentPublishRepositoryMethods } from "../src/modules/content/content-publish-repository.js";
import { createContentUpdateRepositoryMethods } from "../src/modules/content/content-update-repository.js";
import { createEventCoreRepositoryMethods } from "../src/modules/event/event-core-repository.js";
import { hashIdempotencyPayload } from "../src/shared/idempotency.js";
import { MutationCommandIdempotencyConflictError } from "../src/shared/mutation-command-receipt.js";
import { createPostgresClient } from "../src/shared/postgres.js";
import { guardedIntegrationDatabaseUrl } from "./integration-database.js";

const enabled = ["1", "true"].includes(
  process.env.VEEL_ENABLE_REAL_API_INTEGRATION_TESTS ?? ""
);
const describeIntegration = enabled ? describe : describe.skip;

describeIntegration("durable content and event commands against migrated Postgres", () => {
  it("replays original responses and rejects changed-body or changed-target key reuse", async () => {
    const sql = createPostgresClient(guardedIntegrationDatabaseUrl());
    const userId = randomUUID();
    const contentA = randomUUID();
    const contentB = randomUUID();
    const publishA = randomUUID();
    const publishB = randomUUID();
    const eventA = randomUUID();
    const eventB = randomUUID();
    const suffix = userId.replaceAll("-", "").slice(0, 10);
    const updateRepository = createContentUpdateRepositoryMethods(sql);
    const publishRepository = createContentPublishRepositoryMethods(sql);
    const eventRepository = createEventCoreRepositoryMethods(sql);

    try {
      await sql`
        insert into users (id, supabase_user_id, state)
        values (${userId}, ${userId}, 'active')
      `;
      await sql`
        insert into profiles (user_id, handle, display_name, visibility)
        values (${userId}, ${`commands_${suffix}`}, 'Command creator', 'public')
      `;
      await sql`
        insert into content_items (
          id, creator_user_id, media_type, state, visibility, caption,
          body_text, nsfw_label, moderation_state, publish_state
        ) values
          (${contentA}, ${userId}, 'text', 'ready', 'private', 'Initial A', 'A', 'none', 'pending', 'draft'),
          (${contentB}, ${userId}, 'text', 'ready', 'private', 'Initial B', 'B', 'none', 'pending', 'draft'),
          (${publishA}, ${userId}, 'text', 'ready', 'public', 'Publish A', 'A', 'none', 'pending', 'draft'),
          (${publishB}, ${userId}, 'text', 'ready', 'public', 'Publish B', 'B', 'none', 'pending', 'draft')
      `;
      await sql`
        insert into media_safety_cases (
          content_item_id, declared_rating, state, decision_source,
          reason_code, policy_version, provider_release_allowed, decided_at
        ) values
          (${publishA}, 'none', 'approved', 'staff', 'test_approved', 'test-v1', true, now()),
          (${publishB}, 'none', 'approved', 'staff', 'test_approved', 'test-v1', true, now())
      `;
      await sql`
        update content_items
        set moderation_state = 'approved'
        where id in (${publishA}, ${publishB})
      `;
      await sql`
        insert into events (
          id, creator_user_id, title, starts_at, event_type, location_type,
          access_rule, state, idempotency_key, request_hash
        ) values
          (${eventA}, ${userId}, 'Event A', '2030-11-05T12:00:00.000Z',
            'digital_live_stream', 'digital_live_stream', 'public_sale', 'draft',
            ${`fixture-a-${suffix}`}, ${hashIdempotencyPayload({ fixture: "event-a" })}),
          (${eventB}, ${userId}, 'Event B', '2030-11-06T12:00:00.000Z',
            'digital_live_stream', 'digital_live_stream', 'public_sale', 'draft',
            ${`fixture-b-${suffix}`}, ${hashIdempotencyPayload({ fixture: "event-b" })})
      `;

      const updateKey = `content-update-${suffix}`;
      const updateA = contentUpdateInput(userId, contentA, updateKey, "Response A");
      const firstUpdate = await updateRepository.updateOwnedContent!(updateA);
      const laterUpdate = await updateRepository.updateOwnedContent!(
        contentUpdateInput(userId, contentA, `content-update-later-${suffix}`, "Canonical B")
      );
      expect(laterUpdate).toMatchObject({ caption: "Canonical B" });
      await expect(updateRepository.updateOwnedContent!(updateA)).resolves.toEqual(firstUpdate);
      await expect(updateRepository.updateOwnedContent!({
        ...updateA,
        caption: "Changed input",
        requestHash: hashIdempotencyPayload({ contentId: contentA, body: { caption: "Changed input" } })
      })).rejects.toMatchObject({
        reason: "idempotency_conflict"
      });
      await expect(updateRepository.updateOwnedContent!(
        contentUpdateInput(userId, contentB, updateKey, "Response A")
      )).rejects.toMatchObject({
        reason: "idempotency_conflict"
      });
      const canonicalContent = await sql<Array<{ caption: string | null }>>`
        select caption from content_items where id = ${contentA}
      `;
      expect(canonicalContent[0]?.caption).toBe("Canonical B");

      const eventKey = `event-update-${suffix}`;
      const eventBodyA = { title: "Event response A" };
      const firstEvent = await eventRepository.updateEvent({
        supabaseUserId: userId,
        eventId: eventA,
        idempotencyKey: eventKey,
        requestHash: hashIdempotencyPayload({ eventId: eventA, body: eventBodyA }),
        body: eventBodyA
      });
      await eventRepository.updateEvent({
        supabaseUserId: userId,
        eventId: eventA,
        idempotencyKey: `event-update-later-${suffix}`,
        requestHash: hashIdempotencyPayload({ eventId: eventA, body: { title: "Event canonical B" } }),
        body: { title: "Event canonical B" }
      });
      await expect(eventRepository.updateEvent({
        supabaseUserId: userId,
        eventId: eventA,
        idempotencyKey: eventKey,
        requestHash: hashIdempotencyPayload({ eventId: eventA, body: eventBodyA }),
        body: eventBodyA
      })).resolves.toEqual(firstEvent);
      await expect(eventRepository.updateEvent({
        supabaseUserId: userId,
        eventId: eventA,
        idempotencyKey: eventKey,
        requestHash: hashIdempotencyPayload({ eventId: eventA, body: { title: "Changed event" } }),
        body: { title: "Changed event" }
      })).rejects.toBeInstanceOf(MutationCommandIdempotencyConflictError);
      await expect(eventRepository.updateEvent({
        supabaseUserId: userId,
        eventId: eventB,
        idempotencyKey: eventKey,
        requestHash: hashIdempotencyPayload({ eventId: eventB, body: eventBodyA }),
        body: eventBodyA
      })).rejects.toBeInstanceOf(MutationCommandIdempotencyConflictError);
      await expect(eventRepository.findEvent({ supabaseUserId: userId, eventId: eventA }))
        .resolves.toMatchObject({ title: "Event canonical B" });

      const publishKey = `content-publish-${suffix}`;
      const publishBody = { confirmation: "submit_for_review" };
      const publishInput = {
        supabaseUserId: userId,
        contentId: publishA,
        idempotencyKey: publishKey,
        requestHash: hashIdempotencyPayload({ contentId: publishA, body: publishBody }),
        scheduledFor: null,
        scheduledForProvided: false
      };
      const firstPublish = await publishRepository.publishOwnedContent!(publishInput);
      expect(firstPublish).toMatchObject({ id: publishA });
      await sql`update content_items set caption = 'Newer caption' where id = ${publishA}`;
      await expect(publishRepository.publishOwnedContent!(publishInput)).resolves.toEqual(firstPublish);
      await expect(publishRepository.publishOwnedContent!({
        ...publishInput,
        requestHash: hashIdempotencyPayload({ contentId: publishA, body: { ...publishBody, scheduledFor: null } })
      })).rejects.toBeInstanceOf(MutationCommandIdempotencyConflictError);
      await expect(publishRepository.publishOwnedContent!({
        ...publishInput,
        contentId: publishB,
        requestHash: hashIdempotencyPayload({ contentId: publishB, body: publishBody })
      })).rejects.toBeInstanceOf(MutationCommandIdempotencyConflictError);
    } finally {
      await sql`delete from audit_events where actor_user_id = ${userId}`;
      await sql`delete from mutation_command_receipts where actor_user_id = ${userId}`;
      await sql`delete from idempotency_keys where actor_user_id = ${userId}`;
      await sql`delete from events where id in (${eventA}, ${eventB})`;
      await sql`delete from content_items where id in (${contentA}, ${contentB}, ${publishA}, ${publishB})`;
      await sql`delete from profiles where user_id = ${userId}`;
      await sql`delete from users where id = ${userId}`;
      await sql.end({ timeout: 5 });
    }
  });
});

function contentUpdateInput(
  userId: string,
  contentId: string,
  idempotencyKey: string,
  caption: string
) {
  return {
    supabaseUserId: userId,
    contentId,
    idempotencyKey,
    caption,
    captionProvided: true,
    bodyTextProvided: false,
    requestHash: hashIdempotencyPayload({ contentId, body: { caption } }),
    scheduledForProvided: false,
    contentSafetyPolicyAccepted: false,
    teaserStartMsProvided: false,
    teaserEndMsProvided: false,
    thumbnailFrameMsProvided: false,
    eventDraftProvided: false
  };
}
