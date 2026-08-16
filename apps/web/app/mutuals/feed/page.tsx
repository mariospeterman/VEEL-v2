import { appShellNavItems } from "@veel/ui";
import { getMutualsFeed, type MutualsFeedPage } from "@/api-client";
import { ErrorState } from "../../ui";
import { requireAppAccess } from "@/supabase/route-guard";

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

function MutualsFeed({ feed }: { feed: MutualsFeedPage }) {
  if (feed.items.length === 0) {
    return (
      <section className="rounded border border-(--line) bg-(--panel) p-5">
        <h2 className="text-base font-semibold tracking-normal">No Mutuals media yet</h2>
        <p className="mt-2 text-sm leading-6 text-(--muted)">
          Eligible media appears here only when both safety and Mutuals visibility rules pass.
        </p>
      </section>
    );
  }

  return (
    <>
      {feed.items.map((item) => (
        <article className="overflow-hidden rounded border border-(--line) bg-(--panel)" key={item.contentId}>
          {item.posterUrl ? (
            <img alt="" className="aspect-[16/10] w-full object-cover" src={item.posterUrl} />
          ) : null}
          <div className="grid gap-4 p-4">
            <div>
              <p className="text-sm text-(--muted)">@{item.handle}</p>
              <h2 className="mt-1 text-lg font-semibold tracking-normal">{item.title}</h2>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <button className="rounded border border-(--line) px-3 py-2 text-sm font-medium" type="button">
                Not interested
              </button>
              <button className="rounded bg-(--accent) px-3 py-2 text-sm font-medium text-white" type="button">
                Interested
              </button>
            </div>
          </div>
        </article>
      ))}
    </>
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
