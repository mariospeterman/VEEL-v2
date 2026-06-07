import type { Event, EventTicketType, Ticket, TicketRequest } from "./types.js";
import type { TicketRequestRow, TicketRow, TicketTypeRow } from "./event-repository-rows.js";

export function stripRequestHash(event: Event & { requestHash?: string }): Event {
  const { requestHash: _requestHash, ...publicEvent } = event;
  return publicEvent;
}

export function toTicketType(row: TicketTypeRow): EventTicketType {
  const issued = Number(row.issued_count);

  return {
    id: row.id,
    label: row.label,
    priceMinor: row.price_minor === null ? null : Number(row.price_minor),
    currency: row.currency,
    capacity: row.capacity,
    remaining: Math.max(row.capacity - issued, 0),
    state: issued >= row.capacity ? "sold_out" : row.state,
    saleStartsAt: row.sale_starts_at?.toISOString() ?? null,
    saleEndsAt: row.sale_ends_at?.toISOString() ?? null,
    perUserLimit: row.per_user_limit
  };
}

export function toTicket(row: TicketRow): Ticket {
  return {
    id: row.id,
    eventId: row.event_id,
    ticketTypeId: row.access_pass_type_id,
    holderUserId: row.holder_user_id,
    paymentIntentId: row.payment_intent_id,
    state: row.state,
    qrToken: row.qr_token,
    checkedInAt: row.checked_in_at?.toISOString() ?? null,
    createdAt: row.created_at.toISOString()
  };
}

export function toTicketRequest(row: TicketRequestRow): TicketRequest {
  return {
    id: row.id,
    eventId: row.event_id,
    ticketTypeId: row.access_pass_type_id,
    state: row.state,
    createdAt: row.created_at.toISOString()
  };
}
