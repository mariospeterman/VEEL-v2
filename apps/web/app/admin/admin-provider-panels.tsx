import type {
  AdminAgeCheck,
  AdminAiSession,
  AdminAiToolCall,
  AdminIdentityCheck,
  AdminLiveRoom,
  AdminMediaAsset,
  AdminMutualsSafety,
  AdminNotificationHealth,
  AdminPage,
  AdminProviderEvent,
  ApiResult
} from "@/api-client";
import {
  EmptyState,
  Fact,
  UnavailableState,
  timestampLabel
} from "./admin-ui";
import {
  AgeCheckRow,
  AiSessionRow,
  AiToolCallRow,
  IdentityCheckRow,
  LiveProviderRow,
  MediaProviderRow,
  ProviderEventRow
} from "./admin-rows";

export function ProviderEventsPanel({
  providerEvents
}: {
  providerEvents: ApiResult<AdminPage<AdminProviderEvent>>;
}) {
  if (!providerEvents.ok) {
    return <UnavailableState result={providerEvents} />;
  }

  if (providerEvents.data.items.length === 0) {
    return <EmptyState label="No provider events" />;
  }

  return (
    <div className="grid gap-2">
      {providerEvents.data.items.map((event) => (
        <ProviderEventRow event={event} key={event.id} />
      ))}
    </div>
  );
}

export function MutualsSafetyPanel({ mutualsSafety }: { mutualsSafety: ApiResult<AdminMutualsSafety> }) {
  if (!mutualsSafety.ok) {
    return <UnavailableState result={mutualsSafety} />;
  }

  return (
    <div className="grid gap-2">
      <article className="grid gap-3 rounded border border-[var(--line)] bg-[var(--background)] p-3 text-sm md:grid-cols-3">
        <Fact label="Open reports" value={mutualsSafety.data.openReports.toString()} />
        <Fact label="Active Mutuals" value={mutualsSafety.data.activeMutuals.toString()} />
        <Fact label="Stale Mutuals" value={mutualsSafety.data.staleMutuals.toString()} />
      </article>
      <div className="rounded border border-[var(--line)] bg-[var(--background)] p-3 text-sm text-[var(--muted)]">
        Money never buys people, visibility, Mutuals, or social priority.
      </div>
    </div>
  );
}

export function LiveMediaProviderPanel({
  liveRooms,
  mediaAssets
}: {
  liveRooms: ApiResult<AdminPage<AdminLiveRoom>>;
  mediaAssets: ApiResult<AdminPage<AdminMediaAsset>>;
}) {
  if (!liveRooms.ok) {
    return <UnavailableState result={liveRooms} />;
  }

  if (!mediaAssets.ok) {
    return <UnavailableState result={mediaAssets} />;
  }

  if (liveRooms.data.items.length === 0 && mediaAssets.data.items.length === 0) {
    return <EmptyState label="No live rooms or media assets" />;
  }

  return (
    <div className="grid gap-2">
      {liveRooms.data.items.map((room) => (
        <LiveProviderRow key={room.id} room={room} />
      ))}
      {mediaAssets.data.items.map((asset) => (
        <MediaProviderRow asset={asset} key={asset.id} />
      ))}
    </div>
  );
}

export function AgeKycProviderPanel({
  ageChecks,
  identityChecks
}: {
  ageChecks: ApiResult<AdminPage<AdminAgeCheck>>;
  identityChecks: ApiResult<AdminPage<AdminIdentityCheck>>;
}) {
  if (!ageChecks.ok) {
    return <UnavailableState result={ageChecks} />;
  }

  if (!identityChecks.ok) {
    return <UnavailableState result={identityChecks} />;
  }

  if (ageChecks.data.items.length === 0 && identityChecks.data.items.length === 0) {
    return <EmptyState label="No age or identity checks" />;
  }

  return (
    <div className="grid gap-2">
      {ageChecks.data.items.map((check) => (
        <AgeCheckRow check={check} key={check.id} />
      ))}
      {identityChecks.data.items.map((check) => (
        <IdentityCheckRow check={check} key={check.id} />
      ))}
    </div>
  );
}

export function AiOperationsPanel({
  aiSessions,
  aiToolCalls
}: {
  aiSessions: ApiResult<AdminPage<AdminAiSession>>;
  aiToolCalls: ApiResult<AdminPage<AdminAiToolCall>>;
}) {
  if (!aiSessions.ok) {
    return <UnavailableState result={aiSessions} />;
  }

  if (!aiToolCalls.ok) {
    return <UnavailableState result={aiToolCalls} />;
  }

  if (aiSessions.data.items.length === 0 && aiToolCalls.data.items.length === 0) {
    return <EmptyState label="No AI operations" />;
  }

  return (
    <div className="grid gap-2">
      {aiSessions.data.items.map((session) => (
        <AiSessionRow key={session.id} session={session} />
      ))}
      {aiToolCalls.data.items.map((toolCall) => (
        <AiToolCallRow key={toolCall.id} toolCall={toolCall} />
      ))}
    </div>
  );
}

export function NotificationHealthPanel({
  notificationHealth
}: {
  notificationHealth: ApiResult<AdminNotificationHealth>;
}) {
  if (!notificationHealth.ok) {
    return <UnavailableState result={notificationHealth} />;
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
      <Fact label="Unread" value={notificationHealth.data.unreadCount.toString()} />
      <Fact label="Read" value={notificationHealth.data.readCount.toString()} />
      <Fact label="Archived" value={notificationHealth.data.archivedCount.toString()} />
      <Fact label="Active devices" value={notificationHealth.data.activeDeviceCount.toString()} />
      <Fact label="Revoked devices" value={notificationHealth.data.revokedDeviceCount.toString()} />
      <Fact label="Push enabled" value={notificationHealth.data.pushEnabledPreferenceCount.toString()} />
      <Fact label="Delivery queued" value={notificationHealth.data.queuedDeliveryCount.toString()} />
      <Fact label="Delivery leased" value={notificationHealth.data.leasedDeliveryCount.toString()} />
      <Fact label="Delivered" value={notificationHealth.data.deliveredDeliveryCount.toString()} />
      <Fact label="Delivery failed" value={notificationHealth.data.failedDeliveryCount.toString()} />
      <Fact label="Delivery skipped" value={notificationHealth.data.skippedDeliveryCount.toString()} />
      <Fact label="Delivery revoked" value={notificationHealth.data.revokedDeliveryCount.toString()} />
      <Fact label="Latest notification" value={timestampLabel(notificationHealth.data.latestNotificationAt)} />
      <Fact label="Latest device seen" value={timestampLabel(notificationHealth.data.latestDeviceSeenAt)} />
      <Fact label="Latest delivery" value={timestampLabel(notificationHealth.data.latestDeliveryAt)} />
    </div>
  );
}
