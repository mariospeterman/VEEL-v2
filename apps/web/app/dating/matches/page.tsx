import type { components } from "@veel/contracts";
import { appShellNavItems } from "@veel/ui";

type DatingMatch = components["schemas"]["DatingMatch"];

const matches: DatingMatch[] = [
  {
    id: "00000000-0000-4000-8000-0000000000d2",
    userAId: "00000000-0000-4000-8000-000000000001",
    userBId: "00000000-0000-4000-8000-000000000011",
    sourceContentId: "00000000-0000-4000-8000-000000000040",
    conversationId: "00000000-0000-4000-8000-0000000000d3",
    state: "active",
    staleAt: "2026-06-11T22:31:00.000Z",
    expiresAt: "2026-07-04T22:31:00.000Z",
    createdAt: "2026-06-04T22:31:00.000Z"
  }
];

export default function DatingMatchesPage() {
  return (
    <main className="min-h-screen bg-[var(--background)] text-[var(--foreground)]">
      <AppNav />

      <section className="mx-auto grid w-full max-w-6xl gap-5 px-5 py-6">
        <div>
          <p className="text-sm font-medium text-[var(--accent)]">Dating Mode</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-normal">Matches</h1>
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          {matches.map((match) => (
            <article className="rounded border border-[var(--line)] bg-[var(--panel)] p-4" key={match.id}>
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <p className="font-medium">Mutual match</p>
                  <p className="mt-1 truncate text-sm text-[var(--muted)]">{match.conversationId}</p>
                </div>
                <span className="rounded bg-[var(--accent-soft)] px-2 py-1 text-xs font-medium text-[var(--accent-strong)]">
                  {match.state}
                </span>
              </div>
              <div className="mt-4 grid gap-2 text-sm sm:grid-cols-3">
                <Fact label="Source" value={match.sourceContentId ?? "profile"} />
                <Fact label="Stale" value={match.staleAt ?? "not scheduled"} />
                <Fact label="Expires" value={match.expiresAt ?? "not scheduled"} />
              </div>
            </article>
          ))}
        </div>
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
