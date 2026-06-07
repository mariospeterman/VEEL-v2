import type { Event, EventTicketType, Ticket, TicketRequest } from "./types.js";

export interface EventRow {
  id: string;
  title: string;
  description: string | null;
  starts_at: Date;
  ends_at: Date | null;
  access_rule: Event["accessRule"];
  location_type: NonNullable<Event["location"]>["type"];
  location_label: string | null;
  location_lat: string | number | null;
  location_lng: string | number | null;
  state: Event["state"];
  request_hash?: string;
}

export interface TicketTypeRow {
  id: string;
  event_id: string;
  label: string;
  price_minor: string | number | null;
  currency: EventTicketType["currency"];
  capacity: number;
  issued_count: string | number;
  sale_starts_at: Date | null;
  sale_ends_at: Date | null;
  per_user_limit: number;
  state: EventTicketType["state"];
}

export interface TicketRow {
  id: string;
  event_id: string;
  access_pass_type_id: string;
  holder_user_id: string;
  payment_intent_id: string | null;
  qr_token: string;
  state: Ticket["state"];
  checked_in_at: Date | null;
  created_at: Date;
}

export interface TicketRequestRow {
  id: string;
  event_id: string;
  access_pass_type_id: string;
  state: TicketRequest["state"];
  created_at: Date;
}
