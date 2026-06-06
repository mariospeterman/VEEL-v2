import type { components } from "@veel/contracts";
import { appShellNavItems } from "@veel/ui";
import type { ReactNode } from "react";

type FeedPreferences = components["schemas"]["FeedPreferences"];
type Wallet = components["schemas"]["Wallet"];
type AgeStatus = components["schemas"]["AgeStatus"];

const feedPreferences: FeedPreferences = {
  defaultMode: "following",
  nsfwPreference: "recommended",
  hiddenCreatorIds: [
    "00000000-0000-4000-8000-000000000011",
    "00000000-0000-4000-8000-000000000012"
  ],
  hiddenTopics: ["spoilers", "low-quality-live"]
};

const primaryWallet: Wallet = {
  id: "00000000-0000-4000-8000-000000000020",
  chain: "solana_devnet",
  address: "VeelWallet111111111111111111111111111111111",
  provider: "embedded_privy",
  isPrimary: true
};

const ageStatus: AgeStatus = {
  state: "verified",
  provider: "yoti"
};

const securityRows = [
  { label: "Session", value: "Supabase verified" },
  { label: "Age assurance", value: `${ageStatus.state} via ${ageStatus.provider}` },
  { label: "Primary wallet", value: shorten(primaryWallet.address) },
  { label: "Wallet chain", value: primaryWallet.chain }
];

const notificationRows = [
  { label: "Messages", value: "on" },
  { label: "Live reminders", value: "on" },
  { label: "Mutuals", value: "quiet" },
  { label: "Safety and admin", value: "always on" }
];

export default function SettingsPage() {
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
            <div className="grid gap-3 sm:grid-cols-2">
              <Fact label="Handle" value="@maki" />
              <Fact label="Display name" value="Maki" />
              <Fact label="Visibility" value="public" />
              <Fact label="Creator mode" value="enabled" />
            </div>
          </SettingsGroup>

          <SettingsGroup id="security" title="Security">
            <div className="grid gap-3 sm:grid-cols-2">
              {securityRows.map((row) => (
                <Fact label={row.label} value={row.value} key={row.label} />
              ))}
            </div>
          </SettingsGroup>

          <SettingsGroup id="feed" title="Feed">
            <div className="grid gap-3 sm:grid-cols-3">
              <Fact label="Default mode" value={feedPreferences.defaultMode} />
              <Fact label="Hidden creators" value={String(feedPreferences.hiddenCreatorIds?.length ?? 0)} />
              <Fact label="Hidden topics" value={String(feedPreferences.hiddenTopics?.length ?? 0)} />
            </div>
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

function shorten(value: string) {
  return `${value.slice(0, 6)}...${value.slice(-4)}`;
}
