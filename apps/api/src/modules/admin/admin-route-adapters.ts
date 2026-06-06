import type { AccessPass, Ticket } from "./types.js";

export function toAccessPass(ticket: Ticket): AccessPass {
  return {
    id: ticket.id,
    eventId: ticket.eventId,
    accessPassTypeId: ticket.ticketTypeId,
    holderUserId: ticket.holderUserId,
    state: ticket.state,
    qrToken: ticket.qrToken,
    createdAt: ticket.createdAt,
    ...(ticket.paymentIntentId !== undefined ? { paymentIntentId: ticket.paymentIntentId } : {}),
    ...(ticket.checkedInAt !== undefined ? { checkedInAt: ticket.checkedInAt } : {})
  };
}
