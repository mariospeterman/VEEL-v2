import type { components } from "@veel/contracts";
import { appShellNavItems } from "@veel/ui";

type DiscoverPage = components["schemas"]["DiscoverPage"];

const discoverProjection: DiscoverPage = {
  content: [
    {
      id: "00000000-0000-4000-8000-000000000040",
      creator: {
        id: "00000000-0000-4000-8000-000000000010",
        handle: "maki",
        displayName: "Maki",
        avatarUrl: null,
        badges: []
      },
      mediaType: "image",
      caption: "Studio lighting test #studio",
      posterUrl: "https://picsum.photos/seed/veel-discover/960/1280",
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
    }
  ],
  creators: [
    {
      id: "00000000-0000-4000-8000-000000000010",
      handle: "maki",
      displayName: "Maki",
      avatarUrl: null,
      badges: []
    }
  ],
  hashtags: [
    { slug: "studio", displayName: "#studio", state: "active" },
    { slug: "live", displayName: "#live", state: "active" },
    { slug: "events", displayName: "#events", state: "restricted" }
  ],
  events: [
    {
      id: "00000000-0000-4000-8000-0000000000e1",
      title: "Studio meetup",
      description: null,
      startsAt: "2026-07-01T20:00:00.000Z",
      endsAt: null,
      accessRule: "public_sale",
      location: { type: "physical", label: "Belgrade studio" },
      state: "published",
      ticketTypes: [
        {
          id: "00000000-0000-4000-8000-0000000000e2",
          label: "General admission",
          priceMinor: 10000000,
          currency: "SOL",
          capacity: 25,
          remaining: 25,
          state: "active",
          saleStartsAt: null,
          saleEndsAt: null,
          perUserLimit: 1
        }
      ]
    }
  ],
  liveRooms: [
    {
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa10",
      title: "Friday live studio",
      creator: {
        id: "00000000-0000-4000-8000-000000000010",
        handle: "maki",
        displayName: "Maki",
        avatarUrl: null,
        badges: []
      },
      state: "live",
      accessState: "pass_required",
      playback: { state: "blocked", url: null, provider: "livepeer" },
      teaserSecondsRemaining: 45,
      passOptions: [{ durationMinutes: 30, amountMinor: 50000000, currency: "SOL" }],
      chat: { enabled: true, accessState: "pass_required" },
      replayContentId: null
    }
  ],
  nextCursor: null
};

export default function DiscoverPageView() {
  const featured = discoverProjection.content[0];

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

          {featured ? <FeaturedDiscoverCard item={featured} /> : null}
        </div>

        <aside className="grid min-h-0 content-start gap-4 overflow-hidden">
          <section className="grid gap-2">
            <h2 className="text-sm font-semibold tracking-normal text-[var(--muted)]">Hashtags</h2>
            <div className="flex flex-wrap gap-2">
              {discoverProjection.hashtags.map((hashtag) => (
                <a
                  className="rounded border border-[var(--line)] bg-[var(--panel)] px-3 py-2 text-sm"
                  href={`/discover?tag=${hashtag.slug}`}
                  key={hashtag.slug}
                >
                  {hashtag.displayName}
                </a>
              ))}
            </div>
          </section>

          <section className="grid gap-2">
            <h2 className="text-sm font-semibold tracking-normal text-[var(--muted)]">Creators</h2>
            {discoverProjection.creators.map((creator) => (
              <article className="rounded border border-[var(--line)] bg-[var(--panel)] p-4" key={creator.id}>
                <p className="font-medium">{creator.displayName}</p>
                <p className="text-sm text-[var(--muted)]">@{creator.handle}</p>
              </article>
            ))}
          </section>

          <section className="grid gap-2">
            <h2 className="text-sm font-semibold tracking-normal text-[var(--muted)]">Events and live</h2>
            <article className="rounded border border-[var(--line)] bg-[var(--panel)] p-4">
              <p className="font-medium">{discoverProjection.events[0]?.title}</p>
              <p className="mt-1 text-sm text-[var(--muted)]">{discoverProjection.events[0]?.accessRule}</p>
            </article>
            <article className="rounded border border-[var(--line)] bg-[var(--panel)] p-4">
              <div className="flex items-center justify-between gap-3">
                <p className="font-medium">{discoverProjection.liveRooms[0]?.title}</p>
                <span className="rounded bg-[#fee2e2] px-2 py-1 text-xs font-semibold text-[#991b1b]">
                  {discoverProjection.liveRooms[0]?.state}
                </span>
              </div>
              <p className="mt-1 text-sm text-[var(--muted)]">{discoverProjection.liveRooms[0]?.accessState}</p>
            </article>
          </section>
        </aside>
      </section>
    </main>
  );
}

function FeaturedDiscoverCard({ item }: { item: NonNullable<DiscoverPage["content"][number]> }) {
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
