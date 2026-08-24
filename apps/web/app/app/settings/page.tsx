import type { ReactNode } from "react";
import {
  getAgeStatus,
  getFeedPreferences,
  getMcpConnections,
  getNotificationPreferences,
  getNotificationPushConfig,
  getPrivacySettings,
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
import { AppShell } from "../../app-shell";
import { Card, ErrorState, Fact, PageHeader } from "../../ui";
import { mapApiFailure } from "@/api-errors";
import { McpConnectionsPanel } from "../../settings/mcp-connections-panel";
import { NotificationEnrollment } from "../../settings/notification-enrollment";
import { NotificationPreferencesPanel } from "../../settings/notification-preferences-panel";
import { RecoveryAccessPanel } from "../../settings/recovery-access-panel";
import { SessionSecurityActions } from "../../settings/session-security-actions";
import { ContentPreferenceControl } from "./content-preference-control";
import { PrivacyControls } from "./privacy-controls";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  await requireConfiguredSession("/app/settings");

  const [session, ageStatus, wallets, feedPreferences, notificationPreferences, pushConfig, mcpConnections, privacy] = await Promise.all([
    getSession(),
    getAgeStatus(),
    getWallets(),
    getFeedPreferences(),
    getNotificationPreferences(),
    getNotificationPushConfig(),
    getMcpConnections(),
    getPrivacySettings()
  ]);

  return (
    <AppShell>
      <section className="grid gap-5 lg:grid-cols-[260px_minmax(0,1fr)]">
        <aside className="grid content-start gap-2 border-b border-(--line) pb-4 lg:border-b-0 lg:border-r lg:pr-5">
          {["Profile", "Security", "Assistants", "Feed", "Privacy", "Notifications"].map((item) => (
            <a
              className="rounded px-3 py-3 text-sm font-medium text-(--muted) transition hover:bg-(--glass) hover:text-(--foreground)"
              href={item === "Assistants" ? "#mcp" : `#${item.toLowerCase()}`}
              key={item}
            >
              {item}
            </a>
          ))}
        </aside>

        <section className="grid content-start gap-5">
          <PageHeader eyebrow="Settings" title="Account controls">
            Privacy, security, notifications, and connected assistants.
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

          <SettingsGroup id="mcp" title="Connected assistants">
            <McpConnectionsPanel connections={mcpConnections} />
          </SettingsGroup>

          <SettingsGroup id="feed" title="Feed">
            <FeedFacts feedPreferences={feedPreferences} />
          </SettingsGroup>

          <SettingsGroup id="privacy" title="Privacy">
            {privacy.ok ? <PrivacyControls initial={privacy.data} /> : <ErrorState result={privacy} title="Privacy controls unavailable" context="Privacy" />}
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
      <NotificationPreferencesPanel initial={preferences} />
      <NotificationEnrollment pushConfig={pushConfig} />
    </div>
  );
}

function FeedFacts({ feedPreferences }: { feedPreferences: ApiResult<FeedPreferences> }) {
  if (!feedPreferences.ok) {
    return <ErrorState result={feedPreferences} title="Feed preferences unavailable" context="Feed preferences" />;
  }

  return (
    <div className="grid gap-4">
      <div>
        <h3 className="mb-2 text-sm font-semibold">Content you want to see</h3>
        <ContentPreferenceControl initialPreference={feedPreferences.data.nsfwPreference} />
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <Fact label="Feed" value={feedPreferences.data.defaultMode === "following" ? "Following" : "For you"} />
        <Fact label="Hidden creators" value={String(feedPreferences.data.hiddenCreatorIds?.length ?? 0)} />
        <Fact label="Hidden topics" value={String(feedPreferences.data.hiddenTopics?.length ?? 0)} />
      </div>
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
      <Fact label="Session" value={session.data.authenticated ? "application session active" : "not authenticated"} />
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
      <Fact label="Session" value={session.ok && session.data.authenticated ? "application session active" : resultLabel(session)} />
      <Fact label="Age assurance" value={ageStatus.ok ? ageStateLabel(ageStatus.data.state) : resultLabel(ageStatus)} />
      <Fact label="Primary wallet" value={primaryWallet ? shorten(primaryWallet.address) : resultLabel(wallets)} />
      <Fact label="Wallet chain" value={primaryWallet?.chain ?? "not ready"} />
      <RecoveryAccessPanel />
      <SessionSecurityActions />
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
      </div>
      {children}
    </Card>
  );
}

function resultLabel<T>(result: ApiResult<T>) {
  return result.ok ? "ready" : mapApiFailure(result, "Settings").title;
}

function shorten(value: string) {
  return `${value.slice(0, 6)}...${value.slice(-4)}`;
}

function ageStateLabel(state: AgeStatus["state"]) {
  if (state === "verified") return "Verified";
  if (state === "pending") return "Verification in progress";
  if (state === "failed") return "Try verification again";
  return "Verification needed";
}
