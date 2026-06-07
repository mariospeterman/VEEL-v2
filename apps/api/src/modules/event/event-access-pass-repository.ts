import { createHash, randomUUID } from "node:crypto";
import type postgres from "postgres";
import type { TicketRow } from "./event-repository-rows.js";

export function hashQrToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function grantAccessPass(
  sql: postgres.Sql,
  input: {
    supabaseUserId: string;
    eventId: string;
    ticketTypeId: string;
    paymentIntentId: string | null;
  }
): Promise<TicketRow[]> {
  const qrToken = newQrToken();

  return sql<TicketRow[]>`
    with holder as (
      select id
      from users
      where supabase_user_id = ${input.supabaseUserId}
      limit 1
    ),
    existing_ticket as (
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
      join holder on holder.id = te.holder_user_id
      where te.event_id = ${input.eventId}
        and te.access_pass_type_id = ${input.ticketTypeId}
        and te.state in ('active', 'checked_in')
      limit 1
    ),
    ticket_lock as (
      select pg_advisory_xact_lock(hashtextextended(${input.ticketTypeId}, 0))
    ),
    inventory as (
      select
        tt.id,
        tt.event_id,
        tt.capacity,
        count(te.id) filter (where te.state in ('active', 'checked_in')) as issued_count
      from event_access_pass_types tt
      cross join ticket_lock
      left join event_access_passes te on te.access_pass_type_id = tt.id
      where tt.id = ${input.ticketTypeId}
        and tt.event_id = ${input.eventId}
        and tt.state = 'active'
        and not exists (select 1 from existing_ticket)
      group by tt.id
      having count(te.id) filter (where te.state in ('active', 'checked_in')) < tt.capacity
      limit 1
    ),
    inserted_ticket as (
      insert into event_access_passes (
        id,
        event_id,
        access_pass_type_id,
        holder_user_id,
        payment_intent_id,
        qr_token,
        qr_token_hash
      )
      select
        ${randomUUID()},
        inventory.event_id,
        inventory.id,
        holder.id,
        ${input.paymentIntentId},
        ${qrToken},
        ${hashQrToken(qrToken)}
      from holder, inventory
      on conflict (payment_intent_id) do update
      set state = event_access_passes.state
      returning *
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
    from inserted_ticket
    union all
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
    from existing_ticket
    limit 1
  `;
}

function newQrToken(): string {
  return `veel_access_pass_${randomUUID().replaceAll("-", "")}`;
}
