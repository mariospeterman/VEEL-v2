import type { components } from "@veel/contracts";

export type CreateLiveRoomRequest = components["schemas"]["CreateLiveRoomRequest"];
export type CreateLivePassIntentRequest = components["schemas"]["CreateLivePassIntentRequest"];
export type CreateLiveChatMessageRequest = components["schemas"]["CreateLiveChatMessageRequest"];
export type HostConnection = components["schemas"]["HostConnection"];
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
  state: "waiting" | "live" | "ended" | "replay_ready";
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
  createPlaybackJwt(input: { playbackId: string; supabaseUserId: string }): Promise<string | null>;
}

export interface CreateLiveRoomInput {
  supabaseUserId: string;
  idempotencyKey: string;
  requestHash: string;
  title: string;
  teaserSeconds: number;
  passPriceMinor: number;
  providerRoom: CreatedLiveProviderRoom;
}

export interface ReserveLiveRoomInput {
  supabaseUserId: string;
  idempotencyKey: string;
  requestHash: string;
  title: string;
  teaserSeconds: number;
  passPriceMinor: number;
}

export interface AttachLiveProviderRoomInput {
  supabaseUserId: string;
  roomId: string;
  providerRoom: CreatedLiveProviderRoom;
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
  durationMinutes: 30 | 60 | 180;
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
}

export interface UpdateLiveRoomFromWebhookInput {
  providerEventId: string;
  providerStreamId: string;
  providerPlaybackId: string | null;
  providerState: string;
  state: "waiting" | "live" | "ended" | "replay_ready";
  playbackUrl: string | null;
}

export interface CreateLiveChatMessageInput {
  supabaseUserId: string;
  roomId: string;
  body: string;
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
  attachProviderRoom(input: AttachLiveProviderRoomInput): Promise<StoredLiveRoom | null>;
  findRoom(input: FindLiveRoomInput): Promise<StoredLiveRoom | null>;
  findOwnedRoom(input: FindOwnedLiveRoomInput): Promise<StoredLiveRoom | null>;
  findOwnedRoomByIdempotency(input: FindOwnedLiveRoomByIdempotencyInput): Promise<StoredLiveRoom | null>;
  recordLivePassPurchaseRequest(input: CreateLivePassPurchaseRequestInput): Promise<void>;
  recordLiveProviderWebhook?(input: RecordLiveProviderWebhookInput): Promise<boolean>;
  updateRoomStatus(input: UpdateLiveRoomStatusInput): Promise<void>;
  updateRoomFromWebhook?(input: UpdateLiveRoomFromWebhookInput): Promise<boolean>;
  listChatMessages(input: FindLiveRoomInput): Promise<LiveChatPage | null>;
  createChatMessage(input: CreateLiveChatMessageInput): Promise<LiveChatMessage | null>;
  close?(): Promise<void>;
}
