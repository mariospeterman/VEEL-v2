import { getMutualsMatches, type MutualsMatchPage } from "@/api-client";
import { requireAppAccess } from "@/supabase/route-guard";
import { AppShell } from "../app-shell";
import { Card, EmptyState, ErrorState, Fact, PageHeader, StatusPill } from "../ui";

export const dynamic = "force-dynamic";

export default async function MutualsPage() {
  await requireAppAccess("/mutuals");

  const matchesResult = await getMutualsMatches();

  return (
    <AppShell>
      <section className="grid gap-5">
        <PageHeader eyebrow="Mutuals" title="Mutual conversations">
          Mutuals appear only after both people explicitly choose to connect and safety checks pass.
        </PageHeader>

        {matchesResult.ok ? (
          <MutualGrid matches={matchesResult.data} />
        ) : (
          <ErrorState result={matchesResult} title="Mutuals unavailable" context="Mutuals" />
        )}
      </section>
    </AppShell>
  );
}

function MutualGrid({ matches }: { matches: MutualsMatchPage }) {
  if (matches.items.length === 0) {
    return (
      <EmptyState title="No Mutuals yet">
          A Mutual appears only after both people explicitly show interest and safety checks pass.
      </EmptyState>
    );
  }

  return (
    <div className="grid gap-3 md:grid-cols-2">
      {matches.items.map((match) => (
        <Card className="p-4" key={match.id}>
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="font-medium">Mutual match</p>
              <p className="mt-1 truncate text-sm text-(--muted)">{match.conversationId ?? match.id}</p>
            </div>
            <StatusPill>{match.state}</StatusPill>
          </div>
          <div className="mt-4 grid gap-2 text-sm sm:grid-cols-3">
            <Fact label="Source" value={match.sourceContentId ?? "profile"} />
            <Fact label="Stale" value={match.staleAt ?? "not scheduled"} />
            <Fact label="Expires" value={match.expiresAt ?? "not scheduled"} />
          </div>
        </Card>
      ))}
    </div>
  );
}
