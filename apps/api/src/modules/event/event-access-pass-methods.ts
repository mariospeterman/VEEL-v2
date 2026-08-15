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
      return sql.begin(async (transaction) => {
        // Acquire inventory serialization before the capacity statement. Keeping the
        // lock inside that statement would let a waiter retain its pre-lock snapshot.
        await transaction`
          select pg_advisory_xact_lock(hashtextextended(${input.accessPassTypeId}, 0))
        `;
        const rows = await transaction<{ payment_intent_id: string }[]>`
          with buyer as (
            select id from users
            where supabase_user_id = ${input.supabaseUserId}
            limit 1
          ),
          payment as (
            select pi.id, pi.expires_at
            from payment_intents pi
            join buyer on buyer.id = pi.user_id
            where pi.id = ${input.paymentIntentId}
              and pi.target_id = ${input.eventId}
              and pi.amount_minor = ${input.amountMinor}
              and pi.currency = ${input.currency}
              and pi.state in ('pending', 'transaction_requested')
              and pi.expires_at > now()
          ),
          existing as (
            select eapr.payment_intent_id
            from event_access_purchase_requests eapr
            join buyer on buyer.id = eapr.buyer_user_id
            where eapr.payment_intent_id = ${input.paymentIntentId}
              and eapr.event_id = ${input.eventId}
              and eapr.access_pass_type_id = ${input.accessPassTypeId}
              and eapr.state = 'pending_payment'
              and eapr.reserved_until > now()
          ),
          available as (
            select tt.id
            from event_access_pass_types tt
            where tt.id = ${input.accessPassTypeId}
              and tt.event_id = ${input.eventId}
              and tt.state = 'active'
              and not exists (select 1 from existing)
              and (
                select count(*) from event_access_passes eap
                where eap.access_pass_type_id = tt.id
                  and eap.state in ('active', 'checked_in')
              ) + (
                select count(*) from event_access_purchase_requests eapr
                where eapr.access_pass_type_id = tt.id
                  and eapr.state = 'pending_payment'
                  and eapr.reserved_until > now()
              ) < tt.capacity
              and (
                select count(*) from event_access_passes eap, buyer
                where eap.access_pass_type_id = tt.id
                  and eap.holder_user_id = buyer.id
                  and eap.state in ('active', 'checked_in')
              ) + (
                select count(*) from event_access_purchase_requests eapr, buyer
                where eapr.access_pass_type_id = tt.id
                  and eapr.buyer_user_id = buyer.id
                  and eapr.state = 'pending_payment'
                  and eapr.reserved_until > now()
              ) < tt.per_user_limit
          ),
          inserted as (
            insert into event_access_purchase_requests (
              payment_intent_id, event_id, access_pass_type_id, buyer_user_id,
              amount_minor, currency, reserved_until
            )
            select
              payment.id, ${input.eventId}, available.id, buyer.id,
              ${input.amountMinor}, ${input.currency}, payment.expires_at
            from buyer, payment, available
            returning payment_intent_id
          )
          select payment_intent_id from inserted
          union all
          select payment_intent_id from existing
          limit 1
        `;

        if (!rows[0]) {
          await transaction`
            update payment_intents
            set state = 'cancelled', updated_at = now()
            where id = ${input.paymentIntentId}
              and state in ('pending', 'transaction_requested')
          `;
          return false;
        }
        return true;
      });
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
