import { appShellNavItems } from "@veel/ui";
import {
  getDiscoverSearch,
  getHomeFeed,
  type ApiResult,
  type ContentItem,
  type DiscoverPage,
  type FeedPage,
  type LiveRoom
} from "@/api-client";

export default async function HomePage() {
  const [feed, discover] = await Promise.all([
    getHomeFeed("recommended"),
    getDiscoverSearch("")
  ]);
  const featuredItem = feed.ok ? (feed.data.items[0] ?? null) : null;
  const featuredLiveRoom = discover.ok ? (discover.data.liveRooms[0] ?? null) : null;

  return (
    <main className="min-h-screen bg-(--background) text-(--foreground)">
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

      <section className="mx-auto grid w-full max-w-6xl gap-6 px-5 py-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="grid gap-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-(--accent)">Home</p>
              <h1 className="mt-1 text-2xl font-semibold tracking-normal">Recommended</h1>
            </div>
            <div className="rounded border border-(--line) bg-(--panel) px-3 py-2 text-sm text-(--muted)">
              SFW
            </div>
          </div>

          {feed.ok ? (
            featuredItem ? (
              <MediaCard item={featuredItem} />
            ) : (
              <EmptyState label="No recommended media is available" />
            )
          ) : (
            <UnavailableState result={feed} title="Home feed unavailable" />
          )}
        </div>

        <aside className="grid content-start gap-3">
          <div className="border-b border-(--line) pb-3">
            <p className="text-sm font-medium text-(--muted)">Live rail</p>
          </div>
          {discover.ok ? (
            featuredLiveRoom ? (
              <LiveRoomRailCard room={featuredLiveRoom} />
            ) : (
              <EmptyState label="No live rooms are available" />
            )
          ) : (
            <UnavailableState result={discover} title="Live rail unavailable" />
          )}
        </aside>
      </section>
    </main>
  );
}

function LiveRoomRailCard({ room }: { room: LiveRoom }) {
  const lowestPass = room.passOptions[0];

  return (
    <article className="rounded border border-(--line) bg-(--panel) p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">{room.title}</p>
          <p className="text-sm text-(--muted)">@{room.creator.handle}</p>
        </div>
        <span className="rounded bg-[#fee2e2] px-2 py-1 text-xs font-semibold text-[#991b1b]">
          {room.state}
        </span>
      </div>

      <div className="mt-4 aspect-video rounded border border-(--line) bg-[#101827] p-3 text-sm text-white">
        <div className="flex h-full flex-col justify-between">
          <span className="w-fit rounded bg-white/10 px-2 py-1 text-xs">Livepeer</span>
          <div>
            <p className="font-medium">{room.playback?.state ?? "not_ready"}</p>
            <p className="mt-1 text-xs text-white/70">
              {room.teaserSecondsRemaining ?? 0}s teaser before pass gate
            </p>
          </div>
        </div>
      </div>

      <div className="mt-4 grid gap-2 text-sm">
        <div className="flex justify-between gap-3">
          <span className="text-(--muted)">Pass</span>
          <span>{lowestPass ? `${lowestPass.amountMinor.toLocaleString()} ${lowestPass.currency}` : "closed"}</span>
        </div>
        <div className="flex justify-between gap-3">
          <span className="text-(--muted)">Chat</span>
          <span>{room.chat.accessState}</span>
        </div>
      </div>
    </article>
  );
}

function MediaCard({ item }: { item: ContentItem }) {
  return (
    <article className="overflow-hidden rounded border border-(--line) bg-(--panel)">
      <div className="relative aspect-[16/10] bg-[#111827]">
        {item.posterUrl ? (
          <img
            alt=""
            className="h-full w-full object-cover"
            src={item.posterUrl}
          />
        ) : null}
        <div className="absolute left-3 top-3 rounded bg-(--background)/85 px-2 py-1 text-xs font-medium text-(--foreground)">
          {item.mediaType.toUpperCase()}
        </div>
      </div>

      <div className="grid gap-4 p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">{item.creator.displayName}</p>
            <p className="text-sm text-(--muted)">@{item.creator.handle}</p>
          </div>
          <span className="rounded bg-(--accent-soft) px-2 py-1 text-xs font-medium text-(--accent-strong)">
            {item.accessState}
          </span>
        </div>

        {item.caption ? <p className="text-sm leading-6 text-(--foreground)">{item.caption}</p> : null}

        <div className="flex items-center gap-4 border-t border-(--line) pt-3 text-sm text-(--muted)">
          <span>{item.engagement.likeCount.toLocaleString()} likes</span>
          <span>{item.engagement.commentCount.toLocaleString()} comments</span>
        </div>
      </div>
    </article>
  );
}

function EmptyState({ label }: { label: string }) {
  return (
    <div className="rounded border border-(--line) bg-(--panel) p-4 text-sm text-(--muted)">
      {label}
    </div>
  );
}

function UnavailableState({
  result,
  title
}: {
  result: ApiResult<DiscoverPage> | ApiResult<FeedPage>;
  title: string;
}) {
  if (result.ok) {
    return null;
  }

  return (
    <div className="rounded border border-(--line) bg-(--panel) p-4">
      <p className="text-sm font-medium text-(--accent)">HTTP {result.status}</p>
      <h2 className="mt-2 text-base font-semibold tracking-normal">{title}</h2>
      <p className="mt-2 text-sm leading-6 text-(--muted)">{result.message}</p>
    </div>
  );
}
