import type { components } from "@veel/contracts";
import { appShellNavItems } from "@veel/ui";

type ContentItem = components["schemas"]["ContentItem"];
type LiveRoom = components["schemas"]["LiveRoom"];

const featuredItem: ContentItem = {
  id: "00000000-0000-4000-8000-000000000040",
  creator: {
    id: "00000000-0000-4000-8000-000000000010",
    handle: "maki",
    displayName: "Maki",
    avatarUrl: null,
    badges: []
  },
  mediaType: "image",
  caption: "Late-night set build, softbox tests, and the first Veel v2 media surface.",
  posterUrl: "https://picsum.photos/seed/veel-home/1200/750",
  playback: {
    state: "not_ready",
    url: null,
    provider: "none"
  },
  accessState: "free",
  nsfwLabel: "none",
  engagement: {
    liked: false,
    saved: false,
    likeCount: 128,
    commentCount: 18,
    shareCount: 9
  }
};

const featuredLiveRoom: LiveRoom = {
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa10",
  title: "Friday live studio",
  creator: featuredItem.creator,
  state: "live",
  accessState: "pass_required",
  playback: {
    state: "blocked",
    url: null,
    provider: "livepeer"
  },
  teaserSecondsRemaining: 45,
  passOptions: [
    { durationMinutes: 30, amountMinor: 50000000, currency: "SOL" },
    { durationMinutes: 60, amountMinor: 50000000, currency: "SOL" },
    { durationMinutes: 180, amountMinor: 50000000, currency: "SOL" }
  ],
  chat: {
    enabled: true,
    accessState: "pass_required"
  },
  replayContentId: null
};

export default function HomePage() {
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

      <section className="mx-auto grid w-full max-w-6xl gap-6 px-5 py-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="grid gap-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-[var(--accent)]">Home</p>
              <h1 className="mt-1 text-2xl font-semibold tracking-normal">Recommended</h1>
            </div>
            <div className="rounded border border-[var(--line)] bg-[var(--panel)] px-3 py-2 text-sm text-[var(--muted)]">
              SFW
            </div>
          </div>

          <MediaCard item={featuredItem} />
        </div>

        <aside className="grid content-start gap-3">
          <div className="border-b border-[var(--line)] pb-3">
            <p className="text-sm font-medium text-[var(--muted)]">Live rail</p>
          </div>
          <LiveRoomRailCard room={featuredLiveRoom} />
        </aside>
      </section>
    </main>
  );
}

function LiveRoomRailCard({ room }: { room: LiveRoom }) {
  const lowestPass = room.passOptions[0];

  return (
    <article className="rounded border border-[var(--line)] bg-[var(--panel)] p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">{room.title}</p>
          <p className="text-sm text-[var(--muted)]">@{room.creator.handle}</p>
        </div>
        <span className="rounded bg-[#fee2e2] px-2 py-1 text-xs font-semibold text-[#991b1b]">
          {room.state}
        </span>
      </div>

      <div className="mt-4 aspect-video rounded border border-[var(--line)] bg-[#101827] p-3 text-sm text-white">
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
          <span className="text-[var(--muted)]">Pass</span>
          <span>{lowestPass ? `${lowestPass.amountMinor.toLocaleString()} ${lowestPass.currency}` : "closed"}</span>
        </div>
        <div className="flex justify-between gap-3">
          <span className="text-[var(--muted)]">Chat</span>
          <span>{room.chat.accessState}</span>
        </div>
      </div>
    </article>
  );
}

function MediaCard({ item }: { item: ContentItem }) {
  return (
    <article className="overflow-hidden rounded border border-[var(--line)] bg-[var(--panel)]">
      <div className="relative aspect-[16/10] bg-[#111827]">
        {item.posterUrl ? (
          <img
            alt=""
            className="h-full w-full object-cover"
            src={item.posterUrl}
          />
        ) : null}
        <div className="absolute left-3 top-3 rounded bg-[var(--background)]/85 px-2 py-1 text-xs font-medium text-[var(--foreground)]">
          {item.mediaType.toUpperCase()}
        </div>
      </div>

      <div className="grid gap-4 p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">{item.creator.displayName}</p>
            <p className="text-sm text-[var(--muted)]">@{item.creator.handle}</p>
          </div>
          <span className="rounded bg-[var(--accent-soft)] px-2 py-1 text-xs font-medium text-[var(--accent-strong)]">
            {item.accessState}
          </span>
        </div>

        {item.caption ? <p className="text-sm leading-6 text-[var(--foreground)]">{item.caption}</p> : null}

        <div className="flex items-center gap-4 border-t border-[var(--line)] pt-3 text-sm text-[var(--muted)]">
          <span>{item.engagement.likeCount.toLocaleString()} likes</span>
          <span>{item.engagement.commentCount.toLocaleString()} comments</span>
        </div>
      </div>
    </article>
  );
}
