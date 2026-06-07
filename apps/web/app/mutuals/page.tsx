import { appShellNavItems } from "@veel/ui";
import { getMutualsMatches, type MutualsMatchPage } from "@/api-client";
import { requireAppAccess } from "@/supabase/route-guard";

export const dynamic = "force-dynamic";

export default async function MutualsPage() {
  await requireAppAccess("/mutuals");

  const matchesResult = await getMutualsMatches();

  return (
    <main className="min-h-screen bg-(--background) text-(--foreground)">
      <AppNav />

      <section className="mx-auto grid w-full max-w-6xl gap-5 px-5 py-6">
        <div>
          <p className="text-sm font-medium text-(--accent)">Mutuals</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-normal">Mutuals</h1>
        </div>

        {matchesResult.ok ? (
          <MutualGrid matches={matchesResult.data} />
        ) : (
          <UnavailableState
            message={matchesResult.message}
            status={matchesResult.status}
            title="Mutuals unavailable"
          />
        )}
      </section>
    </main>
  );
}

function MutualGrid({ matches }: { matches: MutualsMatchPage }) {
  if (matches.items.length === 0) {
    return (
      <section className="rounded border border-(--line) bg-(--panel) p-5">
        <h2 className="text-base font-semibold tracking-normal">No Mutuals yet</h2>
        <p className="mt-2 text-sm leading-6 text-(--muted)">
          Active Mutuals appear only after both users explicitly show interest and backend safety checks pass.
        </p>
      </section>
    );
  }

  return (
    <div className="grid gap-3 md:grid-cols-2">
      {matches.items.map((match) => (
        <article className="rounded border border-(--line) bg-(--panel) p-4" key={match.id}>
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="font-medium">Mutual match</p>
              <p className="mt-1 truncate text-sm text-(--muted)">{match.conversationId ?? match.id}</p>
            </div>
            <span className="rounded bg-(--accent-soft) px-2 py-1 text-xs font-medium text-(--accent-strong)">
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
  );
}

function AppNav() {
  return (
    <nav className="mx-auto flex w-full max-w-6xl items-center justify-between border-b border-(--line) px-5 py-4">
      <a className="text-lg font-semibold tracking-normal" href="/">
        VEEL
      </a>
      <div className="flex gap-1">
        {appShellNavItems.map((item) => (
          <a
            className="rounded px-3 py-2 text-sm text-(--muted) transition hover:bg-(--panel) hover:text-(--foreground)"
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
      <p className="text-xs uppercase text-(--muted)">{label}</p>
      <p className="mt-1 truncate font-medium">{value}</p>
    </div>
  );
}

function UnavailableState({
  message,
  status,
  title
}: {
  message: string;
  status: number;
  title: string;
}) {
  return (
    <section className="rounded border border-(--line) bg-(--panel) p-5">
      <p className="text-sm font-medium text-(--accent)">HTTP {status}</p>
      <h2 className="mt-2 text-base font-semibold tracking-normal">{title}</h2>
      <p className="mt-2 text-sm leading-6 text-(--muted)">{message}</p>
    </section>
  );
}
