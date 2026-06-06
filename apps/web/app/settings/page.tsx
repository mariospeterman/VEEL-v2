import { appShellNavItems } from "@veel/ui";
import type { ReactNode } from "react";
import {
  getAgeStatus,
  getFeedPreferences,
  getSession,
  getWallets,
  type AgeStatus,
  type ApiResult,
  type FeedPreferences,
  type SessionState,
  type WalletList
} from "@/api-client";

const notificationRows = [
  { label: "Messages", value: "backend preference mutation required" },
  { label: "Live reminders", value: "backend preference mutation required" },
  { label: "Mutuals", value: "quiet by product default" },
  { label: "Safety and admin", value: "always on" }
];

export default async function SettingsPage() {
  const [session, ageStatus, wallets, feedPreferences] = await Promise.all([
    getSession(),
    getAgeStatus(),
    getWallets(),
    getFeedPreferences()
  ]);

  return (
    <main className="min-h-screen bg-[var(--background)] text-[var(--foreground)]">
      <AppNav />

      <section className="mx-auto grid w-full max-w-6xl gap-5 px-5 py-6 lg:grid-cols-[280px_minmax(0,1fr)]">
        <aside className="grid content-start gap-2 border-b border-[var(--line)] pb-4 lg:border-b-0 lg:border-r lg:pr-5">
          {["Profile", "Security", "Feed", "Privacy", "Notifications"].map((item) => (
            <a
              className="rounded px-3 py-2 text-sm font-medium text-[var(--muted)] transition hover:bg-[var(--panel)] hover:text-[var(--foreground)]"
              href={`#${item.toLowerCase()}`}
              key={item}
            >
              {item}
            </a>
          ))}
        </aside>

        <section className="grid content-start gap-5">
          <header>
            <p className="text-sm font-medium text-[var(--accent)]">Settings</p>
            <h1 className="mt-1 text-2xl font-semibold tracking-normal">Account controls</h1>
          </header>

          <SettingsGroup id="profile" title="Profile">
            <ProfileFacts session={session} />
          </SettingsGroup>

          <SettingsGroup id="security" title="Security">
            <SecurityFacts ageStatus={ageStatus} session={session} wallets={wallets} />
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
            <div className="grid gap-3 sm:grid-cols-2">
              {notificationRows.map((row) => (
                <Fact label={row.label} value={row.value} key={row.label} />
              ))}
            </div>
          </SettingsGroup>
        </section>
      </section>
    </main>
  );
}

function FeedFacts({ feedPreferences }: { feedPreferences: ApiResult<FeedPreferences> }) {
  if (!feedPreferences.ok) {
    return <UnavailableState result={feedPreferences} />;
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
    return <UnavailableState result={session} />;
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

function AppNav() {
  return (
    <nav className="mx-auto flex w-full max-w-6xl items-center justify-between border-b border-[var(--line)] px-5 py-4">
      <a className="text-lg font-semibold tracking-normal" href="/">
        VEEL
      </a>
      <div className="flex gap-1 overflow-x-auto">
        {appShellNavItems.map((item) => (
          <a
            className="rounded px-3 py-2 text-sm text-[var(--muted)] transition hover:bg-[var(--panel)] hover:text-[var(--foreground)]"
            href={item.href}
            key={item.href}
          >
            {item.label}
          </a>
        ))}
      </div>
    </nav>
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
    <section className="rounded border border-[var(--line)] bg-[var(--panel)] p-4" id={id}>
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="text-base font-semibold tracking-normal">{title}</h2>
        <span className="rounded bg-[var(--background)] px-2 py-1 text-xs text-[var(--muted)]">server-owned</span>
      </div>
      {children}
    </section>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <p className="text-xs uppercase text-[var(--muted)]">{label}</p>
      <p className="mt-1 truncate font-medium">{value}</p>
    </div>
  );
}

function UnavailableState<T>({ result }: { result: Extract<ApiResult<T>, { ok: false }> }) {
  return (
    <div className="rounded border border-[var(--line)] bg-[var(--background)] p-3 text-sm">
      <p className="font-medium">Settings API unavailable</p>
      <p className="mt-1 text-[var(--muted)]">HTTP {result.status}</p>
      <p className="mt-1 text-[var(--muted)]">{result.message}</p>
    </div>
  );
}

function resultLabel<T>(result: ApiResult<T>) {
  return result.ok ? "ready" : `HTTP ${result.status}`;
}

function shorten(value: string) {
  return `${value.slice(0, 6)}...${value.slice(-4)}`;
}
