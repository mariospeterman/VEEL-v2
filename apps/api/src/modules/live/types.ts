import type { components } from "@veel/contracts";

export type CreateLiveRoomRequest = components["schemas"]["CreateLiveRoomRequest"];
export type CreateLiveChatMessageRequest = components["schemas"]["CreateLiveChatMessageRequest"];
export type HostConnection = components["schemas"]["HostConnection"];
export type RevealedHostConnection = components["schemas"]["RevealedHostConnection"];
export type RevealLiveHostConnectionRequest = components["schemas"]["RevealLiveHostConnectionRequest"];
export type LiveChatMessage = components["schemas"]["LiveChatMessage"];
export type LiveChatPage = components["schemas"]["LiveChatPage"];
export type LiveRoom = components["schemas"]["LiveRoom"];

export interface CreatedLiveProviderRoom {
  provider: "livepeer";
  providerStreamId: string;
  providerPlaybackId: string | null;
  providerState: string;
  hostIngestUrl: string;
  hostStreamKey: string;
  playbackUrl: string | null;
}

export interface LiveProviderRoomStatus {
  providerStreamId: string;
  providerPlaybackId: string | null;
  providerState: string;
  state: "waiting" | "live" | "suspended" | "ended" | "replay_ready";
  playbackUrl: string | null;
  replayProviderAssetId?: string | null;
  replayProviderPlaybackId?: string | null;
  replayPlaybackUrl?: string | null;
}

export interface CreateLiveProviderRoomInput {
  roomId: string;
  title: string;
}

export interface GetLiveProviderRoomStatusInput {
  providerStreamId: string;
  providerPlaybackId: string | null;
}

export interface LiveProviderAdapter {
  isConfigured(): boolean;
  createRoom(input: CreateLiveProviderRoomInput): Promise<CreatedLiveProviderRoom>;
  getRoomStatus(input: GetLiveProviderRoomStatusInput): Promise<LiveProviderRoomStatus>;
  createPlaybackJwt(input: { playbackId: string; appUserId: string }): Promise<string | null>;
  setRoomSuspended(input: { providerStreamId: string; suspended: boolean }): Promise<void>;
  terminateRoom(input: { providerStreamId: string }): Promise<void>;
}

export interface CreateLiveRoomInput {
  supabaseUserId: string;
  idempotencyKey: string;
  requestHash: string;
  title: string;
  accessMode: NonNullable<CreateLiveRoomRequest["accessMode"]>;
  previewSeconds: number;
  eventPriceMinor: number | null;
  membersOnlyChat: boolean;
  membersIncludedInPaidEvent: boolean;
  replayWindowHours: number;
  providerRoom: CreatedLiveProviderRoom;
}

export interface ReserveLiveRoomInput {
  supabaseUserId: string;
  idempotencyKey: string;
  requestHash: string;
  title: string;
  accessMode: NonNullable<CreateLiveRoomRequest["accessMode"]>;
  previewSeconds: number;
  eventPriceMinor: number | null;
  membersOnlyChat: boolean;
  membersIncludedInPaidEvent: boolean;
  replayWindowHours: number;
}

export interface AttachLiveProviderRoomInput {
  supabaseUserId: string;
  roomId: string;
  claimId: string;
  providerRoom: CreatedLiveProviderRoom;
}

export interface ClaimLiveProviderRoomInput {
  supabaseUserId: string;
  roomId: string;
  claimId: string;
}

export interface FindLiveRoomInput {
  supabaseUserId: string;
  roomId: string;
}

export interface FindOwnedLiveRoomInput {
  supabaseUserId: string;
  roomId: string;
}

export interface FindOwnedLiveRoomByIdempotencyInput {
  supabaseUserId: string;
  idempotencyKey: string;
}

export interface CreateLivePassPurchaseRequestInput {
  supabaseUserId: string;
  roomId: string;
  paymentIntentId: string;
  amountMinor: number;
  currency: "SOL";
}

export interface UpdateLiveRoomStatusInput {
  roomId: string;
  status: LiveProviderRoomStatus;
}

export interface RecordLiveProviderWebhookInput {
  providerEventId: string;
  eventType: string;
  normalizedState: string;
  signatureHash?: string | null;
  replayPayload?: Record<string, unknown>;
}

export interface UpdateLiveRoomFromWebhookInput {
  providerEventId: string;
  providerStreamId: string;
  providerPlaybackId: string | null;
  providerState: string;
  state: "waiting" | "live" | "suspended" | "ended" | "replay_ready";
  playbackUrl: string | null;
  preventStateRegression?: boolean;
}

export interface CreateLiveChatMessageInput {
  supabaseUserId: string;
  roomId: string;
  body: string;
  idempotencyKey: string;
  requestHash: string;
}

export type LiveControlAction =
  | "host_credentials_revealed"
  | "creator_ended"
  | "staff_suspended"
  | "staff_resumed";

export interface LiveControlReservation {
  id: string;
  roomId: string;
  providerStreamId: string;
  action: LiveControlAction;
  state: "pending" | "completed" | "failed";
}

export interface StoredLiveRoom extends LiveRoom {
  providerStreamId: string | null;
  providerPlaybackId: string | null;
  hostIngestUrl: string | null;
  hostStreamKey: string | null;
  requestHash?: string;
}

export interface LiveRepository {
  createRoom(input: CreateLiveRoomInput): Promise<StoredLiveRoom>;
  reserveRoom(input: ReserveLiveRoomInput): Promise<StoredLiveRoom>;
  claimProviderCreation(input: ClaimLiveProviderRoomInput): Promise<boolean>;
  attachProviderRoom(input: AttachLiveProviderRoomInput): Promise<StoredLiveRoom | null>;
  findRoom(input: FindLiveRoomInput): Promise<StoredLiveRoom | null>;
  findOwnedRoom(input: FindOwnedLiveRoomInput): Promise<StoredLiveRoom | null>;
  findOwnedRoomByIdempotency(input: FindOwnedLiveRoomByIdempotencyInput): Promise<StoredLiveRoom | null>;
  listOwnedRooms(input: { supabaseUserId: string }): Promise<{ items: StoredLiveRoom[]; nextCursor: null }>;
  revealHostConnection(input: {
    supabaseUserId: string;
    roomId: string;
    idempotencyKey: string;
    requestHash: string;
  }): Promise<RevealedHostConnection | null>;
  reserveOwnedControl(input: {
    supabaseUserId: string;
    roomId: string;
    action: "creator_ended";
    idempotencyKey: string;
    requestHash: string;
  }): Promise<LiveControlReservation | null>;
  reserveStaffControl(input: {
    supabaseUserId: string;
    roomId: string;
    action: "staff_suspended" | "staff_resumed";
    reason: string;
    idempotencyKey: string;
    requestHash: string;
  }): Promise<LiveControlReservation | null>;
  completeControl(input: {
    controlId: string;
    state: "ended" | "suspended" | "waiting" | "live";
    providerState: string;
  }): Promise<void>;
  failControl(input: {
    controlId: string;
    providerFailureKind: string;
    providerStatusCode: number | null;
  }): Promise<void>;
  recordLivePassPurchaseRequest(input: CreateLivePassPurchaseRequestInput): Promise<void>;
  recordLiveProviderWebhook?(input: RecordLiveProviderWebhookInput): Promise<boolean>;
  updateRoomStatus(input: UpdateLiveRoomStatusInput): Promise<void>;
  updateRoomFromWebhook?(input: UpdateLiveRoomFromWebhookInput): Promise<boolean>;
  listChatMessages(input: FindLiveRoomInput): Promise<LiveChatPage | null>;
  createChatMessage(input: CreateLiveChatMessageInput): Promise<LiveChatMessage | null>;
  close?(): Promise<void>;
}
