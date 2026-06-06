import { appShellNavItems } from "@veel/ui";
import {
  getDiscoverSearch,
  type ApiResult,
  type ContentItem,
  type DiscoverPage
} from "@/api-client";

export default async function DiscoverPageView({
  searchParams
}: {
  searchParams?: Promise<{ q?: string }>;
}) {
  const params = await searchParams;
  const discover = await getDiscoverSearch(params?.q ?? "");
  const featured = discover.ok ? (discover.data.content[0] ?? null) : null;

  return (
    <main className="min-h-screen bg-[var(--background)] text-[var(--foreground)]">
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

      <section className="mx-auto grid h-[calc(100vh-65px)] w-full max-w-6xl gap-5 overflow-hidden px-5 py-5 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="grid min-h-0 gap-4">
          <div className="flex items-end justify-between gap-4">
            <div>
              <p className="text-sm font-medium text-[var(--accent)]">Discover</p>
              <h1 className="mt-1 text-2xl font-semibold tracking-normal">Search and explore</h1>
            </div>
            <div className="hidden rounded border border-[var(--line)] bg-[var(--panel)] px-3 py-2 text-sm text-[var(--muted)] sm:block">
              /v1/discover/search
            </div>
          </div>

          {discover.ok ? (
            featured ? (
              <FeaturedDiscoverCard item={featured} />
            ) : (
              <EmptyState label="No discover content is available" />
            )
          ) : (
            <UnavailableState result={discover} title="Discover unavailable" />
          )}
        </div>

        <aside className="grid min-h-0 content-start gap-4 overflow-hidden">
          {discover.ok ? (
            <>
              <section className="grid gap-2">
                <h2 className="text-sm font-semibold tracking-normal text-[var(--muted)]">Hashtags</h2>
                <div className="flex flex-wrap gap-2">
                  {discover.data.hashtags.length > 0 ? (
                    discover.data.hashtags.map((hashtag) => (
                      <a
                        className="rounded border border-[var(--line)] bg-[var(--panel)] px-3 py-2 text-sm"
                        href={`/discover?q=${encodeURIComponent(hashtag.slug)}`}
                        key={hashtag.slug}
                      >
                        {hashtag.displayName}
                      </a>
                    ))
                  ) : (
                    <EmptyState label="No hashtags yet" />
                  )}
                </div>
              </section>

              <section className="grid gap-2">
                <h2 className="text-sm font-semibold tracking-normal text-[var(--muted)]">Creators</h2>
                {discover.data.creators.length > 0 ? (
                  discover.data.creators.map((creator) => (
                    <article className="rounded border border-[var(--line)] bg-[var(--panel)] p-4" key={creator.id}>
                      <p className="font-medium">{creator.displayName}</p>
                      <p className="text-sm text-[var(--muted)]">@{creator.handle}</p>
                    </article>
                  ))
                ) : (
                  <EmptyState label="No creators yet" />
                )}
              </section>

              <section className="grid gap-2">
                <h2 className="text-sm font-semibold tracking-normal text-[var(--muted)]">Events and live</h2>
                {discover.data.events.map((event) => (
                  <article className="rounded border border-[var(--line)] bg-[var(--panel)] p-4" key={event.id}>
                    <p className="font-medium">{event.title}</p>
                    <p className="mt-1 text-sm text-[var(--muted)]">{event.accessRule}</p>
                  </article>
                ))}
                {discover.data.liveRooms.map((room) => (
                  <article className="rounded border border-[var(--line)] bg-[var(--panel)] p-4" key={room.id}>
                    <div className="flex items-center justify-between gap-3">
                      <p className="font-medium">{room.title}</p>
                      <span className="rounded bg-[#fee2e2] px-2 py-1 text-xs font-semibold text-[#991b1b]">
                        {room.state}
                      </span>
                    </div>
                    <p className="mt-1 text-sm text-[var(--muted)]">{room.accessState}</p>
                  </article>
                ))}
                {discover.data.events.length === 0 && discover.data.liveRooms.length === 0 ? (
                  <EmptyState label="No events or live rooms yet" />
                ) : null}
              </section>
            </>
          ) : (
            <UnavailableState result={discover} title="Discover sidebars unavailable" />
          )}
        </aside>
      </section>
    </main>
  );
}

function FeaturedDiscoverCard({ item }: { item: ContentItem }) {
  return (
    <article className="grid min-h-0 overflow-hidden rounded border border-[var(--line)] bg-[var(--panel)] lg:grid-cols-[minmax(0,1fr)_300px]">
      <div className="relative min-h-[420px] bg-[#111827]">
        {item.posterUrl ? <img alt="" className="h-full w-full object-cover" src={item.posterUrl} /> : null}
        <span className="absolute left-3 top-3 rounded bg-[var(--background)]/85 px-2 py-1 text-xs font-medium">
          {item.mediaType.toUpperCase()}
        </span>
      </div>
      <div className="grid content-between gap-4 p-4">
        <div>
          <p className="text-sm font-medium text-[var(--muted)]">@{item.creator.handle}</p>
          <h2 className="mt-2 text-xl font-semibold tracking-normal">{item.creator.displayName}</h2>
          {item.caption ? <p className="mt-4 text-sm leading-6">{item.caption}</p> : null}
        </div>
        <div className="grid gap-2 border-t border-[var(--line)] pt-4 text-sm text-[var(--muted)]">
          <div className="flex justify-between gap-3">
            <span>Access</span>
            <span>{item.accessState}</span>
          </div>
          <div className="flex justify-between gap-3">
            <span>Engagement</span>
            <span>{item.engagement.likeCount.toLocaleString()} likes</span>
          </div>
        </div>
      </div>
    </article>
  );
}

function EmptyState({ label }: { label: string }) {
  return (
    <div className="rounded border border-[var(--line)] bg-[var(--panel)] p-4 text-sm text-[var(--muted)]">
      {label}
    </div>
  );
}

function UnavailableState({
  result,
  title
}: {
  result: ApiResult<DiscoverPage>;
  title: string;
}) {
  if (result.ok) {
    return null;
  }

  return (
    <div className="rounded border border-[var(--line)] bg-[var(--panel)] p-4">
      <p className="text-sm font-medium text-[var(--accent)]">HTTP {result.status}</p>
      <h2 className="mt-2 text-base font-semibold tracking-normal">{title}</h2>
      <p className="mt-2 text-sm leading-6 text-[var(--muted)]">{result.message}</p>
    </div>
  );
}
