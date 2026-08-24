import type {
  AdminNotificationHealth,
  AdminOpsSummary,
  AdminUser,
  AdminContentItem,
  AdminReport,
  AdminPaymentIntent,
  AdminUnlock,
  AdminProviderEvent,
  AuditEvent
} from "./types.js";

export interface CountRow {
  total: string | number;
  pending: string | number;
  submitted: string | number;
  confirmed: string | number;
  failed: string | number;
}

export interface NotificationHealthRow {
  unread_count: string | number;
  read_count: string | number;
  archived_count: string | number;
  active_device_count: string | number;
  revoked_device_count: string | number;
  push_enabled_preference_count: string | number;
  queued_delivery_count: string | number;
  leased_delivery_count: string | number;
  delivered_delivery_count: string | number;
  failed_delivery_count: string | number;
  dead_letter_delivery_count: string | number;
  skipped_delivery_count: string | number;
  revoked_delivery_count: string | number;
  latest_notification_at: Date | null;
  latest_device_seen_at: Date | null;
  latest_delivery_at: Date | null;
}

export interface WorkerQueueHealthRow {
  name:
    | "subscription_collections"
    | "notification_deliveries"
    | "payment_confirmation_emails"
    | "provider_event_replays"
    | "media_moderation"
    | "analytics_projections"
    | "live_safety"
    | "scheduled_publications";
  pending_count: string | number;
  processing_count: string | number;
  failed_count: string | number;
  dead_letter_count: string | number;
  oldest_pending_at: Date | null;
}

export interface AdminUserRow {
  id: string;
  handle: string;
  state: AdminUser["state"];
  age_state: AdminUser["ageState"];
  wallet_connected: boolean;
  wallet_chain: AdminUser["walletState"]["chain"] | null;
  wallet_address: string | null;
  created_at: Date;
}

export interface AdminContentRow {
  id: string;
  creator_id: string;
  handle: string;
  display_name: string;
  avatar_url: string | null;
  moderation_state: string;
  state: AdminContentItem["state"];
  created_at: Date;
}

export interface AdminReportRow {
  id: string;
  subject_type: string;
  subject_id: string;
  state: AdminReport["state"];
  reason: string;
  created_at: Date;
}

export interface PaymentRow {
  id: string;
  product_type: AdminPaymentIntent["productType"];
  amount_minor: string | number;
  currency: AdminPaymentIntent["currency"];
  state: AdminPaymentIntent["state"];
  user_id: string;
  target_id: string;
  reference_address: string;
  submitted_signature: string | null;
  confirmed_signature: string | null;
  settlement_attempt_count: string | number;
  entitlement_id: string | null;
  created_at: Date;
  confirmed_at: Date | null;
}

export interface UnlockRow {
  id: string;
  user_id: string;
  target_type: AdminUnlock["targetType"];
  target_id: string;
  product_type: AdminUnlock["productType"];
  payment_intent_id: string | null;
  state: AdminUnlock["state"];
  granted_at: Date;
  expires_at: Date | null;
}

export interface ProviderEventRow {
  id: string;
  provider: string;
  event_type: string;
  normalized_state: AdminProviderEvent["state"];
  received_at: Date;
  processed_at: Date | null;
  latest_replay_request_id: string | null;
  latest_replay_state: AdminProviderEvent["latestReplayState"];
  latest_replay_failure_code: string | null;
  latest_replay_requested_at: Date | null;
  latest_replay_processed_at: Date | null;
}

export interface AuditEventRow {
  id: string;
  subject_type: string;
  action: string;
  created_at: Date;
}

export function toCounts(row: CountRow | undefined): AdminOpsSummary["paymentCounts"] {
  return {
    total: Number(row?.total ?? 0),
    pending: Number(row?.pending ?? 0),
    submitted: Number(row?.submitted ?? 0),
    confirmed: Number(row?.confirmed ?? 0),
    failed: Number(row?.failed ?? 0)
  };
}

export function toNotificationHealth(row: NotificationHealthRow | undefined): AdminNotificationHealth {
  return {
    unreadCount: Number(row?.unread_count ?? 0),
    readCount: Number(row?.read_count ?? 0),
    archivedCount: Number(row?.archived_count ?? 0),
    activeDeviceCount: Number(row?.active_device_count ?? 0),
    revokedDeviceCount: Number(row?.revoked_device_count ?? 0),
    pushEnabledPreferenceCount: Number(row?.push_enabled_preference_count ?? 0),
    queuedDeliveryCount: Number(row?.queued_delivery_count ?? 0),
    leasedDeliveryCount: Number(row?.leased_delivery_count ?? 0),
    deliveredDeliveryCount: Number(row?.delivered_delivery_count ?? 0),
    failedDeliveryCount: Number(row?.failed_delivery_count ?? 0),
    deadLetterDeliveryCount: Number(row?.dead_letter_delivery_count ?? 0),
    skippedDeliveryCount: Number(row?.skipped_delivery_count ?? 0),
    revokedDeliveryCount: Number(row?.revoked_delivery_count ?? 0),
    latestNotificationAt: row?.latest_notification_at?.toISOString() ?? null,
    latestDeviceSeenAt: row?.latest_device_seen_at?.toISOString() ?? null,
    latestDeliveryAt: row?.latest_delivery_at?.toISOString() ?? null
  };
}

export function toWorkerQueueHealth(row: WorkerQueueHealthRow): AdminOpsSummary["workerQueues"][number] {
  return {
    name: row.name,
    pendingCount: Number(row.pending_count),
    processingCount: Number(row.processing_count),
    failedCount: Number(row.failed_count),
    deadLetterCount: Number(row.dead_letter_count),
    oldestPendingAt: row.oldest_pending_at?.toISOString() ?? null
  };
}

export function toAdminUser(row: AdminUserRow): AdminUser {
  return {
    id: row.id,
    handle: row.handle,
    state: row.state,
    ageState: row.age_state,
    walletState: {
      connected: row.wallet_connected,
      chain: row.wallet_chain ?? "solana_devnet",
      address: row.wallet_address
    }
  };
}

export function toAdminContentItem(row: AdminContentRow): AdminContentItem {
  return {
    id: row.id,
    creator: {
      id: row.creator_id,
      handle: row.handle,
      displayName: row.display_name,
      avatarUrl: row.avatar_url,
      badges: []
    },
    moderationState: row.moderation_state,
    state: row.state
  };
}

export function toAdminReport(row: AdminReportRow): AdminReport {
  return {
    id: row.id,
    subjectType: row.subject_type,
    subjectId: row.subject_id,
    state: row.state,
    reason: row.reason
  };
}

export function toPaymentIntent(row: PaymentRow): AdminPaymentIntent {
  return {
    id: row.id,
    productType: row.product_type,
    amountMinor: Number(row.amount_minor),
    currency: row.currency,
    state: row.state,
    userId: row.user_id,
    targetId: row.target_id,
    referenceAddress: row.reference_address,
    submittedSignature: row.submitted_signature,
    confirmedSignature: row.confirmed_signature,
    settlementAttemptCount: Number(row.settlement_attempt_count),
    entitlementId: row.entitlement_id,
    createdAt: row.created_at.toISOString(),
    confirmedAt: row.confirmed_at?.toISOString() ?? null
  };
}

export function toUnlock(row: UnlockRow): AdminUnlock {
  return {
    id: row.id,
    userId: row.user_id,
    targetType: row.target_type,
    targetId: row.target_id,
    productType: row.product_type,
    paymentIntentId: row.payment_intent_id,
    state: row.state,
    grantedAt: row.granted_at.toISOString(),
    expiresAt: row.expires_at?.toISOString() ?? null
  };
}

export function toProviderEvent(row: ProviderEventRow): AdminProviderEvent {
  return {
    id: row.id,
    provider: row.provider,
    eventType: row.event_type,
    state: row.normalized_state,
    receivedAt: row.received_at.toISOString(),
    processedAt: row.processed_at?.toISOString() ?? null,
    latestReplayRequestId: row.latest_replay_request_id ?? null,
    latestReplayState: row.latest_replay_state ?? null,
    latestReplayFailureCode: row.latest_replay_failure_code ?? null,
    latestReplayRequestedAt: row.latest_replay_requested_at?.toISOString() ?? null,
    latestReplayProcessedAt: row.latest_replay_processed_at?.toISOString() ?? null
  };
}

export function toAuditEvent(row: AuditEventRow): AuditEvent {
  return {
    id: row.id,
    subjectType: row.subject_type,
    action: row.action,
    createdAt: row.created_at.toISOString()
  };
}

export function contentModerationForAction(action: string): {
  moderationState: string;
  state: AdminContentItem["state"];
} {
  switch (action) {
    case "approve":
    case "reinstate":
      return { moderationState: "approved", state: "ready" };
    case "restrict":
      return { moderationState: "restricted", state: "ready" };
    case "request_changes":
      return { moderationState: "pending", state: "ready" };
    case "block":
      return { moderationState: "blocked", state: "blocked" };
    case "delete":
      return { moderationState: "deleted", state: "deleted" };
    default:
      return { moderationState: "pending", state: "draft" };
  }
}
