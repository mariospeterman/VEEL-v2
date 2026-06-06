import type { components } from "@veel/contracts";
import { appShellNavItems } from "@veel/ui";

type DatingFeedItem = components["schemas"]["DatingFeedItem"];
type DatingProfile = components["schemas"]["DatingProfile"];

const datingProfile: DatingProfile = {
  enabled: true,
  consentVersion: "dating-consent-2026-06-04",
  activeMatchLimit: 10,
  visibleOnMedia: true,
  safetyState: "clear",
  createdAt: "2026-06-04T22:30:00.000Z",
  updatedAt: "2026-06-04T22:30:00.000Z"
};

const feedItems: DatingFeedItem[] = [
  {
    contentId: "00000000-0000-4000-8000-000000000040",
    creatorUserId: "00000000-0000-4000-8000-000000000011",
    handle: "maki",
    displayName: "Maki",
    avatarUrl: null,
    title: "Mutuals profile card",
    mediaKind: "image",
    posterUrl: "https://images.unsplash.com/photo-1517841905240-472988babdf9?auto=format&fit=crop&w=1200&q=80",
    createdAt: "2026-06-04T22:31:00.000Z"
  }
];

export default function DatingPage() {
  return (
    <main className="min-h-screen bg-[var(--background)] text-[var(--foreground)]">
      <AppNav />

      <section className="mx-auto grid w-full max-w-6xl gap-5 px-5 py-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <section className="grid content-start gap-5">
          <div>
            <p className="text-sm font-medium text-[var(--accent)]">Mutuals</p>
            <h1 className="mt-1 text-2xl font-semibold tracking-normal">Explicit Mutuals feed</h1>
          </div>

          {feedItems.map((item) => (
            <article className="overflow-hidden rounded border border-[var(--line)] bg-[var(--panel)]" key={item.contentId}>
              {item.posterUrl ? (
                <img alt="" className="aspect-[16/10] w-full object-cover" src={item.posterUrl} />
              ) : null}
              <div className="grid gap-4 p-4">
                <div>
                  <p className="text-sm text-[var(--muted)]">@{item.handle}</p>
                  <h2 className="mt-1 text-lg font-semibold tracking-normal">{item.title}</h2>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <button className="rounded border border-[var(--line)] px-3 py-2 text-sm font-medium">
                    Not interested
                  </button>
                  <button className="rounded bg-[var(--accent)] px-3 py-2 text-sm font-medium text-white">
                    Yes
                  </button>
                </div>
              </div>
            </article>
          ))}
        </section>

        <aside className="grid content-start gap-3">
          <section className="rounded border border-[var(--line)] bg-[var(--panel)] p-4">
            <p className="text-sm font-medium">Mutuals safety</p>
            <div className="mt-4 grid gap-3 text-sm">
              <Fact label="Enabled" value={datingProfile.enabled ? "active" : "paused"} />
              <Fact label="Consent" value={datingProfile.consentVersion ?? "missing"} />
              <Fact label="Match cap" value={datingProfile.activeMatchLimit.toString()} />
              <Fact label="Safety" value={datingProfile.safetyState} />
            </div>
          </section>
        </aside>
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
      <div className="flex gap-1">
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

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <p className="text-xs uppercase text-[var(--muted)]">{label}</p>
      <p className="mt-1 truncate font-medium">{value}</p>
    </div>
  );
}
