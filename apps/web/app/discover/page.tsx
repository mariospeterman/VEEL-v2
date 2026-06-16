import { getDiscoverSearch, type ContentItem } from "@/api-client";
import { AppShell } from "../app-shell";
import { Card, EmptyState, ErrorState, Fact, PageHeader, StatusPill } from "../ui";

export default async function DiscoverPageView({
  searchParams
}: {
  searchParams?: Promise<{ q?: string }>;
}) {
  const params = await searchParams;
  const discover = await getDiscoverSearch(params?.q ?? "");
  const featured = discover.ok ? (discover.data.content[0] ?? null) : null;

  return (
    <AppShell>
      <PageHeader
        action={<StatusPill>Search overlay</StatusPill>}
        eyebrow="Bits"
        title="Discover creators and media"
      >
        Browse content, creators, live rooms, and Event Access surfaces exposed by the backend.
      </PageHeader>

      <section className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="grid content-start gap-4">
          {discover.ok ? (
            featured ? (
              <FeaturedDiscoverCard item={featured} />
            ) : (
              <EmptyState title="No discover content yet">
                Search results appear once backend-visible content is available.
              </EmptyState>
            )
          ) : (
            <ErrorState result={discover} title="Discover needs your session" context="Discover" />
          )}
        </div>

        <aside className="grid content-start gap-4">
          {discover.ok ? (
            <>
              <Card className="p-4">
                <p className="eyebrow">Hashtags</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {discover.data.hashtags.length > 0 ? (
                    discover.data.hashtags.map((hashtag) => (
                      <a className="status-pill" href={`/discover?q=${encodeURIComponent(hashtag.slug)}`} key={hashtag.slug}>
                        {hashtag.displayName}
                      </a>
                    ))
                  ) : (
                    <span className="text-sm text-(--muted)">No hashtags yet</span>
                  )}
                </div>
              </Card>

              <Card className="p-4">
                <p className="eyebrow">Creators</p>
                <div className="mt-3 grid gap-2">
                  {discover.data.creators.length > 0 ? (
                    discover.data.creators.map((creator) => (
                      <a className="rounded border border-(--line) bg-(--glass) p-3" href={`/profile/${creator.handle}`} key={creator.id}>
                        <p className="font-medium">{creator.displayName}</p>
                        <p className="mt-1 text-sm text-(--muted)">@{creator.handle}</p>
                      </a>
                    ))
                  ) : (
                    <span className="text-sm text-(--muted)">No creators yet</span>
                  )}
                </div>
              </Card>

              <Card className="p-4">
                <p className="eyebrow">Events and live</p>
                <div className="mt-3 grid gap-2">
                  {discover.data.events.map((event) => (
                    <article className="rounded border border-(--line) bg-(--glass) p-3" key={event.id}>
                      <p className="font-medium">{event.title}</p>
                      <p className="mt-1 text-sm text-(--muted)">{event.accessRule}</p>
                    </article>
                  ))}
                  {discover.data.liveRooms.map((room) => (
                    <article className="rounded border border-(--line) bg-(--glass) p-3" key={room.id}>
                      <div className="flex items-center justify-between gap-3">
                        <p className="font-medium">{room.title}</p>
                        <StatusPill tone={room.state === "live" ? "good" : "warn"}>{room.state}</StatusPill>
                      </div>
                      <p className="mt-1 text-sm text-(--muted)">{room.accessState}</p>
                    </article>
                  ))}
                  {discover.data.events.length === 0 && discover.data.liveRooms.length === 0 ? (
                    <span className="text-sm text-(--muted)">No events or live rooms yet</span>
                  ) : null}
                </div>
              </Card>
            </>
          ) : (
            <ErrorState result={discover} title="Discover sidebars unavailable" context="Discover sidebars" />
          )}
        </aside>
      </section>
    </AppShell>
  );
}

function FeaturedDiscoverCard({ item }: { item: ContentItem }) {
  return (
    <Card className="grid overflow-hidden lg:grid-cols-[minmax(0,1fr)_320px]">
      <div className="relative min-h-[460px] bg-[#090d15]">
        {item.posterUrl ? (
          <img alt="" className="h-full w-full object-cover" src={item.posterUrl} />
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-(--muted)">Media preview</div>
        )}
        <div className="absolute left-4 top-4 flex gap-2">
          <StatusPill>{item.mediaType.toUpperCase()}</StatusPill>
          <StatusPill>{item.accessState}</StatusPill>
        </div>
      </div>
      <div className="grid content-between gap-4 p-5">
        <div>
          <p className="text-sm font-medium text-(--muted)">@{item.creator.handle}</p>
          <h2 className="mt-2 text-2xl font-semibold tracking-normal">{item.creator.displayName}</h2>
          {item.caption ? <p className="mt-4 text-sm leading-7 text-(--text-soft)">{item.caption}</p> : null}
        </div>
        <div className="grid gap-3 border-t border-(--line) pt-4 text-sm">
          <Fact label="Access" value={item.accessState} />
          <Fact label="Engagement" value={`${item.engagement.likeCount.toLocaleString()} likes`} />
          <Fact label="Comments" value={item.engagement.commentCount.toLocaleString()} />
        </div>
      </div>
    </Card>
  );
}
