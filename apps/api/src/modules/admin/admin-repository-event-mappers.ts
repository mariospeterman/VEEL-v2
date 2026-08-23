import type {
  AdminLiveRoom,
  AdminMediaAsset,
  AdminAgeCheck,
  AdminIdentityCheck,
  AdminAiSession,
  AdminAiToolCall,
  AccessPass,
  Event,
  EventAccessPassType
} from "./types.js";

import { nullableNumber } from "./admin-repository-mapper-utils.js";

export interface EventRow {
  id: string;
  title: string;
  description: string | null;
  starts_at: Date;
  ends_at: Date | null;
  access_rule: Event["accessRule"];
  location_type: Event["location"]["type"];
  location_label: string | null;
  location_lat: string | number | null;
  location_lng: string | number | null;
  state: Event["state"];
  created_at: Date;
}

export interface EventAccessPassTypeRow {
  id: string;
  event_id: string;
  label: string;
  price_minor: string | number | null;
  currency: EventAccessPassType["currency"];
  capacity: number;
  sale_starts_at: Date | null;
  sale_ends_at: Date | null;
  per_user_limit: number;
  state: EventAccessPassType["state"];
  issued_count: string | number;
}

export interface AccessPassRow {
  id: string;
  event_id: string;
  access_pass_type_id: string;
  holder_user_id: string;
  payment_intent_id: string | null;
  state: AccessPass["state"];
  checked_in_at: Date | null;
  created_at: Date;
}

export interface LiveRoomRow {
  id: string;
  creator_user_id: string;
  title: string;
  provider: AdminLiveRoom["provider"];
  provider_stream_id: string | null;
  provider_playback_id: string | null;
  provider_state: string;
  state: AdminLiveRoom["state"];
  access_rule: AdminLiveRoom["accessMode"];
  event_price_minor: string | number | null;
  currency: AdminLiveRoom["currency"];
  members_only_chat: boolean;
  members_included_in_paid_event: boolean;
  replay_window_hours: number;
  has_playback_url: boolean;
  has_host_stream_key: boolean;
  monitoring_state: AdminLiveRoom["monitoringState"];
  monitoring_healthy: boolean;
  monitoring_heartbeat_expires_at: Date | null;
  monitoring_hold_reason_code: string | null;
  pending_provider_action: boolean;
  starts_at: Date | null;
  ended_at: Date | null;
  created_at: Date;
  updated_at: Date | null;
}

export interface MediaAssetRow {
  id: string;
  content_item_id: string;
  asset_kind: AdminMediaAsset["assetKind"];
  position: number | null;
  provider: AdminMediaAsset["provider"];
  provider_asset_id: string;
  provider_state: string;
  provider_playable: boolean;
  has_playback_url: boolean;
  ready_at: Date | null;
  provider_checked_at: Date | null;
  retired_at: Date | null;
  provider_cleanup_state: AdminMediaAsset["providerCleanupState"];
  provider_cleanup_error_code: string | null;
  created_at: Date;
}

export interface AgeCheckRow {
  id: string;
  user_id: string;
  provider: string;
  provider_reference: string;
  state: AdminAgeCheck["state"];
  jurisdiction: string | null;
  rule: string | null;
  has_provider_reference: boolean;
  verified_at: Date | null;
  expires_at: Date | null;
  created_at: Date;
}

export interface IdentityCheckRow {
  id: string;
  user_id: string;
  provider: string;
  provider_reference: string;
  verification_type: AdminIdentityCheck["verificationType"];
  state: AdminIdentityCheck["state"];
  country_code: string | null;
  document_type: string | null;
  liveness_state: string | null;
  wallet_ownership_state: string | null;
  has_provider_reference: boolean;
  has_legal_name_hash: boolean;
  verified_at: Date | null;
  expires_at: Date | null;
  created_at: Date;
}

export interface AiSessionRow {
  id: string;
  actor_user_id: string;
  scope: AdminAiSession["scope"];
  state: AdminAiSession["state"];
  allowed_tool_count: string | number;
  created_at: Date;
  expires_at: Date;
}

export interface AiToolCallRow {
  id: string;
  session_id: string;
  actor_user_id: string;
  scope: AdminAiToolCall["scope"];
  tool_name: AdminAiToolCall["toolName"];
  state: AdminAiToolCall["state"];
  confirmation_state: AdminAiToolCall["confirmationState"];
  subject_type: Exclude<AdminAiToolCall["subjectType"], undefined>;
  subject_id: string | null;
  input_summary: string;
  output_summary: string;
  created_at: Date;
}

export function toLiveRoom(row: LiveRoomRow): AdminLiveRoom {
  return {
    id: row.id,
    creatorUserId: row.creator_user_id,
    title: row.title,
    provider: row.provider,
    providerStreamId: row.provider_stream_id,
    providerPlaybackId: row.provider_playback_id,
    providerState: row.provider_state,
    state: row.state,
    accessMode: row.access_rule,
    eventPriceMinor: nullableNumber(row.event_price_minor),
    currency: row.currency,
    membersOnlyChat: row.members_only_chat,
    membersIncludedInPaidEvent: row.members_included_in_paid_event,
    replayWindowHours: row.replay_window_hours,
    hasPlaybackUrl: row.has_playback_url,
    hasHostStreamKey: row.has_host_stream_key,
    monitoringState: row.monitoring_state,
    monitoringHealthy: row.monitoring_healthy,
    monitoringHeartbeatExpiresAt: row.monitoring_heartbeat_expires_at?.toISOString() ?? null,
    monitoringHoldReasonCode: row.monitoring_hold_reason_code,
    pendingProviderAction: row.pending_provider_action,
    startsAt: row.starts_at?.toISOString() ?? null,
    endedAt: row.ended_at?.toISOString() ?? null,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at?.toISOString() ?? null
  };
}

export function toMediaAsset(row: MediaAssetRow): AdminMediaAsset {
  return {
    id: row.id,
    contentItemId: row.content_item_id,
    assetKind: row.asset_kind,
    position: row.position,
    provider: row.provider,
    providerAssetId: row.provider_asset_id,
    providerState: row.provider_state,
    providerPlayable: row.provider_playable,
    hasPlaybackUrl: row.has_playback_url,
    readyAt: row.ready_at?.toISOString() ?? null,
    providerCheckedAt: row.provider_checked_at?.toISOString() ?? null,
    retiredAt: row.retired_at?.toISOString() ?? null,
    providerCleanupState: row.provider_cleanup_state,
    providerCleanupErrorCode: row.provider_cleanup_error_code,
    createdAt: row.created_at.toISOString()
  };
}

export function toAgeCheck(row: AgeCheckRow): AdminAgeCheck {
  return {
    id: row.id,
    userId: row.user_id,
    provider: row.provider,
    providerReference: row.provider_reference,
    state: row.state,
    jurisdiction: row.jurisdiction,
    rule: row.rule,
    hasProviderReference: row.has_provider_reference,
    privacyBoundary: "sanitized_age_state_no_raw_identity_payloads",
    verifiedAt: row.verified_at?.toISOString() ?? null,
    expiresAt: row.expires_at?.toISOString() ?? null,
    createdAt: row.created_at.toISOString()
  };
}

export function toIdentityCheck(row: IdentityCheckRow): AdminIdentityCheck {
  return {
    id: row.id,
    userId: row.user_id,
    provider: row.provider,
    providerReference: row.provider_reference,
    verificationType: row.verification_type,
    state: row.state,
    countryCode: row.country_code,
    documentType: row.document_type,
    livenessState: row.liveness_state,
    walletOwnershipState: row.wallet_ownership_state,
    hasProviderReference: row.has_provider_reference,
    hasLegalNameHash: row.has_legal_name_hash,
    privacyBoundary: "sanitized_identity_minimized_no_raw_documents_or_pii",
    verifiedAt: row.verified_at?.toISOString() ?? null,
    expiresAt: row.expires_at?.toISOString() ?? null,
    createdAt: row.created_at.toISOString()
  };
}

export function toAiSession(row: AiSessionRow): AdminAiSession {
  return {
    id: row.id,
    actorUserId: row.actor_user_id,
    scope: row.scope,
    state: row.state,
    allowedToolCount: Number(row.allowed_tool_count),
    createdAt: row.created_at.toISOString(),
    expiresAt: row.expires_at.toISOString()
  };
}

export function toAiToolCall(row: AiToolCallRow): AdminAiToolCall {
  return {
    id: row.id,
    sessionId: row.session_id,
    actorUserId: row.actor_user_id,
    scope: row.scope,
    toolName: row.tool_name,
    state: row.state,
    confirmationState: row.confirmation_state,
    subjectType: row.subject_type,
    subjectId: row.subject_id,
    inputSummary: row.input_summary,
    outputSummary: row.output_summary,
    redactionBoundary: "summaries_only_no_tool_payloads_or_secrets",
    createdAt: row.created_at.toISOString()
  };
}

export function toEvent(row: EventRow, accessPassTypeRows: EventAccessPassTypeRow[]): Event {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    startsAt: row.starts_at.toISOString(),
    endsAt: row.ends_at?.toISOString() ?? null,
    accessRule: row.access_rule,
    location: {
      type: row.location_type,
      ...(row.location_label ? { label: row.location_label } : {}),
      ...(row.location_lat !== null ? { latitude: Number(row.location_lat) } : {}),
      ...(row.location_lng !== null ? { longitude: Number(row.location_lng) } : {})
    },
    state: row.state,
    accessPassTypes: accessPassTypeRows.map(toEventAccessPassType)
  };
}

export function toEventAccessPassType(row: EventAccessPassTypeRow): EventAccessPassType {
  const issued = Number(row.issued_count);

  return {
    id: row.id,
    label: row.label,
    priceMinor: nullableNumber(row.price_minor),
    currency: row.currency,
    capacity: row.capacity,
    remaining: Math.max(row.capacity - issued, 0),
    state: issued >= row.capacity ? "sold_out" : row.state,
    saleStartsAt: row.sale_starts_at?.toISOString() ?? null,
    saleEndsAt: row.sale_ends_at?.toISOString() ?? null,
    perUserLimit: row.per_user_limit
  };
}

export function toEventAccessPass(row: AccessPassRow): AccessPass {
  return {
    id: row.id,
    eventId: row.event_id,
    accessPassTypeId: row.access_pass_type_id,
    holderUserId: row.holder_user_id,
    paymentIntentId: row.payment_intent_id,
    state: row.state,
    qrToken: "redacted",
    checkedInAt: row.checked_in_at?.toISOString() ?? null,
    createdAt: row.created_at.toISOString()
  };
}
