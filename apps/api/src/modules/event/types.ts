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

export interface AccessPassOffer {
  event: Event;
  accessPassType: EventAccessPassType;
  alreadyIssuedAccessPass: AccessPass | null;
}

export interface FindAccessPassOfferInput {
  supabaseUserId: string;
  eventId: string;
  accessPassTypeId: string;
}

export interface RecordAccessPassPurchaseRequestInput {
  supabaseUserId: string;
  eventId: string;
  accessPassTypeId: string;
  paymentIntentId: string;
  amountMinor: number;
  currency: "SOL";
}

export interface GrantFreeAccessPassInput {
  supabaseUserId: string;
  eventId: string;
  accessPassTypeId: string;
}

export interface CreateAccessPassRequestInput {
  supabaseUserId: string;
  eventId: string;
  accessPassTypeId: string;
  note?: string | null;
}

export interface CheckInAccessPassInput {
  supabaseUserId: string;
  accessPassId: string;
  qrToken: string;
}

export interface ListAccessPassesInput {
  supabaseUserId: string;
  limit: number;
  cursor?: string;
}

export interface EventRepository {
  createEvent(input: CreateEventInput): Promise<Event>;
  findEvent(input: FindEventInput): Promise<Event | null>;
  updateEvent(input: UpdateEventInput): Promise<Event | null>;
  findAccessPassOffer(input: FindAccessPassOfferInput): Promise<AccessPassOffer | null>;
  recordAccessPassPurchaseRequest(input: RecordAccessPassPurchaseRequestInput): Promise<void>;
  grantFreeAccessPass(input: GrantFreeAccessPassInput): Promise<AccessPass | null>;
  createAccessPassRequest(input: CreateAccessPassRequestInput): Promise<AccessPassRequest | null>;
  checkInAccessPass(input: CheckInAccessPassInput): Promise<AccessPass | null>;
  listAccessPasses(input: ListAccessPassesInput): Promise<AccessPassPage>;
  close?(): Promise<void>;
}
