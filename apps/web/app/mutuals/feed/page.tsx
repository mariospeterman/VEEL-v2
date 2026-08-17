import { appShellNavItems } from "@veel/ui";
import { getMutualsFeed } from "@/api-client";
import { ErrorState } from "../../ui";
import { requireAppAccess } from "@/supabase/route-guard";
import { MutualsFeed } from "./mutuals-feed";

export const dynamic = "force-dynamic";

export default async function MutualsFeedPageRoute() {
  await requireAppAccess("/mutuals/feed");

  const feedResult = await getMutualsFeed();

  return (
    <main className="min-h-screen bg-(--background) text-(--foreground)">
      <AppNav />

      <section className="mx-auto grid w-full max-w-6xl gap-5 px-5 py-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <section className="grid content-start gap-5">
          <div>
            <p className="text-sm font-medium text-(--accent-text)">Mutuals</p>
            <h1 className="mt-1 text-2xl font-semibold tracking-normal">Explicit Mutuals feed</h1>
          </div>

          {feedResult.ok ? (
            <MutualsFeed feed={feedResult.data} />
          ) : (
            <ErrorState
              context="Mutuals feed"
              result={feedResult}
              title={feedResult.status === 403 ? "Mutuals not active" : "Mutuals feed unavailable"}
            />
          )}
        </section>

        <aside className="grid content-start gap-3">
          <section className="rounded border border-(--line) bg-(--panel) p-4">
            <p className="text-sm font-medium">Mutuals safety</p>
            <div className="mt-4 grid gap-3 text-sm">
              <Fact label="Access" value="profile and age verified" />
              <Fact label="Consent" value="explicit opt-in required" />
              <Fact label="Interest" value="backend recorded" />
              <Fact label="Priority" value="not for sale" />
            </div>
          </section>
        </aside>
      </section>
    </main>
  );
}

function AppNav() {
  return (
    <nav className="mx-auto flex w-full max-w-6xl items-center justify-between border-b border-(--line) px-5 py-4">
      <a className="text-lg font-semibold tracking-normal" href="/">
        WeVid
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
