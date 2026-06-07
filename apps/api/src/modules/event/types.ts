import type { components } from "@veel/contracts";

export type CheckInAccessPassRequest = components["schemas"]["CheckInAccessPassRequest"];
export type CreateEventRequest = components["schemas"]["CreateEventRequest"];
export type CreateAccessPassIntentRequest = components["schemas"]["CreateAccessPassIntentRequest"];
export type CreateAccessPassRequestRequest = components["schemas"]["CreateAccessPassRequestRequest"];
export type AccessPass = components["schemas"]["AccessPass"];
export type AccessPassIntent = components["schemas"]["AccessPassIntent"];
export type AccessPassPage = components["schemas"]["AccessPassPage"];
export type AccessPassRequest = components["schemas"]["AccessPassRequest"];
export type Event = components["schemas"]["Event"];
export type EventAccessPassType = components["schemas"]["EventAccessPassType"];
export type EventTicketType = components["schemas"]["EventTicketType"];
export type Ticket = components["schemas"]["Ticket"];
export type TicketPage = components["schemas"]["TicketPage"];
export type TicketRequest = components["schemas"]["TicketRequest"];
export type UpdateEventRequest = components["schemas"]["UpdateEventRequest"];

export interface CreateEventInput {
  supabaseUserId: string;
  idempotencyKey: string;
  requestHash: string;
  body: CreateEventRequest;
}

export interface UpdateEventInput {
  supabaseUserId: string;
  eventId: string;
  body: UpdateEventRequest;
}

export interface FindEventInput {
  supabaseUserId: string;
  eventId: string;
}

export interface TicketOffer {
  event: Event;
  ticketType: EventTicketType;
  alreadyIssuedTicket: Ticket | null;
}

export interface FindTicketOfferInput {
  supabaseUserId: string;
  eventId: string;
  ticketTypeId: string;
}

export interface RecordTicketPurchaseRequestInput {
  supabaseUserId: string;
  eventId: string;
  ticketTypeId: string;
  paymentIntentId: string;
  amountMinor: number;
  currency: "SOL";
}

export interface GrantFreeTicketInput {
  supabaseUserId: string;
  eventId: string;
  ticketTypeId: string;
}

export interface CreateTicketRequestInput {
  supabaseUserId: string;
  eventId: string;
  ticketTypeId: string;
  note?: string | null;
}

export interface CheckInTicketInput {
  supabaseUserId: string;
  ticketId: string;
  qrToken: string;
}

export interface ListTicketsInput {
  supabaseUserId: string;
  limit: number;
  cursor?: string;
}

export interface EventRepository {
  createEvent(input: CreateEventInput): Promise<Event>;
  findEvent(input: FindEventInput): Promise<Event | null>;
  updateEvent(input: UpdateEventInput): Promise<Event | null>;
  findTicketOffer(input: FindTicketOfferInput): Promise<TicketOffer | null>;
  recordTicketPurchaseRequest(input: RecordTicketPurchaseRequestInput): Promise<void>;
  grantFreeTicket(input: GrantFreeTicketInput): Promise<Ticket | null>;
  createTicketRequest(input: CreateTicketRequestInput): Promise<TicketRequest | null>;
  checkInTicket(input: CheckInTicketInput): Promise<Ticket | null>;
  listTickets(input: ListTicketsInput): Promise<TicketPage>;
  close?(): Promise<void>;
}
