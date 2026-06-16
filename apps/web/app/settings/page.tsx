import type { ReactNode } from "react";
import {
  getAgeStatus,
  getFeedPreferences,
  getMcpConnections,
  getNotificationPreferences,
  getNotificationPushConfig,
  getSession,
  getWallets,
  type AgeStatus,
  type ApiResult,
  type FeedPreferences,
  type NotificationPreferences,
  type NotificationPushConfig,
  type SessionState,
  type WalletList
} from "@/api-client";
import { requireConfiguredSession } from "@/supabase/route-guard";
import { AppShell } from "../app-shell";
import { Card, ErrorState, Fact, PageHeader, StatusPill } from "../ui";
import { mapApiFailure } from "@/api-errors";
import { McpConnectionsPanel } from "./mcp-connections-panel";
import { NotificationEnrollment } from "./notification-enrollment";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  await requireConfiguredSession("/app/settings");

  const [session, ageStatus, wallets, feedPreferences, notificationPreferences, pushConfig, mcpConnections] = await Promise.all([
    getSession(),
    getAgeStatus(),
    getWallets(),
    getFeedPreferences(),
    getNotificationPreferences(),
    getNotificationPushConfig(),
    getMcpConnections()
  ]);

  return (
    <AppShell>
      <section className="grid gap-5 lg:grid-cols-[260px_minmax(0,1fr)]">
        <aside className="grid content-start gap-2 border-b border-(--line) pb-4 lg:border-b-0 lg:border-r lg:pr-5">
          {["Profile", "Security", "MCP", "Feed", "Privacy", "Notifications"].map((item) => (
            <a
              className="rounded px-3 py-3 text-sm font-medium text-(--muted) transition hover:bg-(--glass) hover:text-(--foreground)"
              href={`#${item.toLowerCase()}`}
              key={item}
            >
              {item}
            </a>
          ))}
        </aside>

        <section className="grid content-start gap-5">
          <PageHeader eyebrow="Settings" title="Account controls">
            Privacy, security, notifications, and connected external MCP clients.
          </PageHeader>

          <SettingsGroup id="profile" title="Profile">
            <ProfileFacts session={session} />
          </SettingsGroup>

          <SettingsGroup id="security" title="Security">
            <SecurityFacts
              ageStatus={ageStatus}
              session={session}
              wallets={wallets}
            />
          </SettingsGroup>

          <SettingsGroup id="mcp" title="MCP connections">
            <McpConnectionsPanel connections={mcpConnections} />
          </SettingsGroup>

          <SettingsGroup id="feed" title="Feed">
            <FeedFacts feedPreferences={feedPreferences} />
          </SettingsGroup>

          <SettingsGroup id="privacy" title="Privacy">
            <div className="grid gap-3 sm:grid-cols-2">
              <Fact label="Telemetry" value="privacy-safe only" />
              <Fact label="Raw provider payloads" value="not exposed" />
              <Fact label="Money ranking" value="disabled" />
              <Fact label="Activity receipts" value="account only" />
            </div>
          </SettingsGroup>

          <SettingsGroup id="notifications" title="Notifications">
            <NotificationFacts notificationPreferences={notificationPreferences} pushConfig={pushConfig} />
          </SettingsGroup>
        </section>
      </section>
    </AppShell>
  );
}

function NotificationFacts({
  notificationPreferences,
  pushConfig
}: {
  notificationPreferences: ApiResult<NotificationPreferences>;
  pushConfig: ApiResult<NotificationPushConfig>;
}) {
  if (!notificationPreferences.ok) {
    return (
      <div className="grid gap-4">
        <ErrorState result={notificationPreferences} title="Notification preferences unavailable" context="Notifications" />
        <NotificationEnrollment pushConfig={pushConfig} />
      </div>
    );
  }

  const preferences = notificationPreferences.data;

  return (
    <div className="grid gap-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <Fact label="Messages" value={enabledLabel(preferences.messagesEnabled)} />
        <Fact label="Engagement" value={enabledLabel(preferences.engagementEnabled)} />
        <Fact label="Live" value={enabledLabel(preferences.liveEnabled)} />
        <Fact label="Payments" value={enabledLabel(preferences.paymentsEnabled)} />
        <Fact label="Memberships" value={enabledLabel(preferences.membershipsEnabled)} />
        <Fact label="Event access" value={enabledLabel(preferences.eventAccessEnabled)} />
        <Fact label="Mutuals" value={enabledLabel(preferences.mutualsEnabled)} />
        <Fact label="Safety" value={enabledLabel(preferences.safetyEnabled)} />
        <Fact label="Wallet" value={enabledLabel(preferences.walletEnabled)} />
        <Fact label="Creator setup" value={enabledLabel(preferences.creatorSetupEnabled)} />
        <Fact label="Studio setup" value={enabledLabel(preferences.studioSetupEnabled)} />
        <Fact label="Push" value={enabledLabel(preferences.pushEnabled)} />
      </div>
      <NotificationEnrollment pushConfig={pushConfig} />
    </div>
  );
}

function FeedFacts({ feedPreferences }: { feedPreferences: ApiResult<FeedPreferences> }) {
  if (!feedPreferences.ok) {
    return <ErrorState result={feedPreferences} title="Feed preferences unavailable" context="Feed preferences" />;
  }

  return (
    <div className="grid gap-3 sm:grid-cols-3">
      <Fact label="Default mode" value={feedPreferences.data.defaultMode} />
      <Fact label="NSFW preference" value={feedPreferences.data.nsfwPreference} />
      <Fact label="Hidden creators" value={String(feedPreferences.data.hiddenCreatorIds?.length ?? 0)} />
      <Fact label="Hidden topics" value={String(feedPreferences.data.hiddenTopics?.length ?? 0)} />
    </div>
  );
}

function ProfileFacts({ session }: { session: ApiResult<SessionState> }) {
  if (!session.ok) {
    return <ErrorState result={session} title="Profile settings unavailable" context="Profile settings" />;
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Fact label="Handle" value={session.data.user?.handle ? `@${session.data.user.handle}` : "not set"} />
      <Fact label="Display name" value={session.data.user?.displayName ?? "not set"} />
      <Fact label="Session" value={session.data.authenticated ? "Supabase verified" : "not authenticated"} />
      <Fact label="Access" value={session.data.appAccessState.allowed ? "ready" : session.data.appAccessState.reason} />
    </div>
  );
}

function SecurityFacts({
  ageStatus,
  session,
  wallets
}: {
  ageStatus: ApiResult<AgeStatus>;
  session: ApiResult<SessionState>;
  wallets: ApiResult<WalletList>;
}) {
  const primaryWallet = wallets.ok ? wallets.data.items.find((wallet) => wallet.isPrimary) : null;

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Fact label="Session" value={session.ok && session.data.authenticated ? "Supabase verified" : resultLabel(session)} />
      <Fact label="Age assurance" value={ageStatus.ok ? `${ageStatus.data.state} via ${ageStatus.data.provider ?? "none"}` : resultLabel(ageStatus)} />
      <Fact label="Primary wallet" value={primaryWallet ? shorten(primaryWallet.address) : resultLabel(wallets)} />
      <Fact label="Wallet chain" value={primaryWallet?.chain ?? "not ready"} />
    </div>
  );
}

function SettingsGroup({
  children,
  id,
  title
}: {
  children: ReactNode;
  id: string;
  title: string;
}) {
  return (
    <Card className="p-4" id={id}>
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="text-base font-semibold tracking-normal">{title}</h2>
        <StatusPill>server-owned</StatusPill>
      </div>
      {children}
    </Card>
  );
}

function resultLabel<T>(result: ApiResult<T>) {
  return result.ok ? "ready" : mapApiFailure(result, "Settings").title;
}

function enabledLabel(enabled: boolean) {
  return enabled ? "enabled" : "disabled";
}

function shorten(value: string) {
  return `${value.slice(0, 6)}...${value.slice(-4)}`;
}
