import { randomUUID } from "node:crypto";
import type postgres from "postgres";
import type { EventRepository, AccessPassOffer } from "./types.js";
import { grantAccessPass, hashQrToken } from "./event-access-pass-repository.js";
import { toEventAccessPass, toEventAccessPassRequest } from "./event-repository-mappers.js";
import type { AccessPassRequestRow, AccessPassRow } from "./event-repository-rows.js";

type FindEventMethod = EventRepository["findEvent"];

export function createEventAccessPassRepositoryMethods(
  sql: postgres.Sql,
  findEvent: FindEventMethod
): Pick<
  EventRepository,
  | "findAccessPassOffer"
  | "recordAccessPassPurchaseRequest"
  | "grantFreeAccessPass"
  | "createAccessPassRequest"
  | "checkInAccessPass"
  | "listAccessPasses"
> {
  return {
    async findAccessPassOffer(input) {
      const event = await findEvent({
        supabaseUserId: input.supabaseUserId,
        eventId: input.eventId
      });

      if (!event || event.state !== "published") {
        return null;
      }

      const accessPassType = event.accessPassTypes.find((candidate) => candidate.id === input.accessPassTypeId);

      if (!accessPassType || accessPassType.state !== "active") {
        return null;
      }

      const accessPassRows = await sql<AccessPassRow[]>`
        with actor as (
          select id
          from users
          where supabase_user_id = ${input.supabaseUserId}
          limit 1
        )
        select
          te.id,
          te.event_id,
          te.access_pass_type_id,
          te.holder_user_id,
          te.payment_intent_id,
          te.qr_token,
          te.state,
          te.checked_in_at,
          te.created_at
        from event_access_passes te
        join actor on actor.id = te.holder_user_id
        where te.event_id = ${input.eventId}
          and te.access_pass_type_id = ${input.accessPassTypeId}
          and te.state in ('active', 'checked_in')
        order by te.created_at desc
        limit 1
      `;

      return {
        event,
        accessPassType,
        alreadyIssuedAccessPass: accessPassRows[0] ? toEventAccessPass(accessPassRows[0]) : null
      } satisfies AccessPassOffer;
    },
    async recordAccessPassPurchaseRequest(input) {
      await sql`
        with buyer as (
          select id
          from users
          where supabase_user_id = ${input.supabaseUserId}
          limit 1
        )
        insert into event_access_purchase_requests (
          payment_intent_id,
          event_id,
          access_pass_type_id,
          buyer_user_id,
          amount_minor,
          currency
        )
        select
          ${input.paymentIntentId},
          ${input.eventId},
          ${input.accessPassTypeId},
          id,
          ${input.amountMinor},
          ${input.currency}
        from buyer
        on conflict (payment_intent_id) do nothing
      `;
    },
    async grantFreeAccessPass(input) {
      const rows = await grantAccessPass(sql, {
        supabaseUserId: input.supabaseUserId,
        eventId: input.eventId,
        accessPassTypeId: input.accessPassTypeId,
        paymentIntentId: null
      });

      return rows[0] ? toEventAccessPass(rows[0]) : null;
    },
    async createAccessPassRequest(input) {
      const rows = await sql<AccessPassRequestRow[]>`
        with requester as (
          select id
          from users
          where supabase_user_id = ${input.supabaseUserId}
          limit 1
        )
        insert into event_access_requests (
          id,
          event_id,
          access_pass_type_id,
          requester_user_id,
          note
        )
        select
          ${randomUUID()},
          ${input.eventId},
          ${input.accessPassTypeId},
          id,
          ${input.note ?? null}
        from requester
        on conflict (event_id, access_pass_type_id, requester_user_id) do update
        set note = coalesce(excluded.note, event_access_requests.note)
        returning id, event_id, access_pass_type_id, state, created_at
      `;

      return rows[0] ? toEventAccessPassRequest(rows[0]) : null;
    },
    async checkInAccessPass(input) {
      const rows = await sql<AccessPassRow[]>`
        with actor as (
          select id
          from users
          where supabase_user_id = ${input.supabaseUserId}
          limit 1
        ),
        matched_access_pass as (
          select te.*
          from event_access_passes te
          join events e on e.id = te.event_id
          where te.id = ${input.accessPassId}
            and te.qr_token_hash = ${hashQrToken(input.qrToken)}
            and (e.creator_user_id = (select id from actor) or private.is_staff_member())
          limit 1
        ),
        updated_access_pass as (
          update event_access_passes te
          set
            state = case when state = 'active' then 'checked_in' else state end,
            checked_in_at = case when state = 'active' then now() else checked_in_at end,
            updated_at = now()
          from matched_access_pass mt
          where te.id = mt.id
            and te.state in ('active', 'checked_in')
          returning te.*
        )
        select
          id,
          event_id,
          access_pass_type_id,
          holder_user_id,
          payment_intent_id,
          qr_token,
          state,
          checked_in_at,
          created_at
        from updated_access_pass
      `;

      return rows[0] ? toEventAccessPass(rows[0]) : null;
    },
    async listAccessPasses(input) {
      const rows = await sql<AccessPassRow[]>`
        with actor as (
          select id
          from users
          where supabase_user_id = ${input.supabaseUserId}
          limit 1
        )
        select
          te.id,
          te.event_id,
          te.access_pass_type_id,
          te.holder_user_id,
          te.payment_intent_id,
          te.qr_token,
          te.state,
          te.checked_in_at,
          te.created_at
        from event_access_passes te
        join actor on actor.id = te.holder_user_id
        where (${input.cursor ?? null}::timestamptz is null or te.created_at < ${input.cursor ?? null}::timestamptz)
        order by te.created_at desc
        limit ${input.limit + 1}
      `;

      const pageRows = rows.slice(0, input.limit);
      const extraRow = rows[input.limit];

      return {
        items: pageRows.map(toEventAccessPass),
        nextCursor: extraRow ? extraRow.created_at.toISOString() : null
      };
    }
  };
}
