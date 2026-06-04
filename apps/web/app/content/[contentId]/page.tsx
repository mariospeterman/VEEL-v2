import type { components } from "@veel/contracts";
import { appShellNavItems } from "@veel/ui";

type ContentItem = components["schemas"]["ContentItem"];

const sampleContent: ContentItem = {
  id: "00000000-0000-4000-8000-000000000040",
  creator: {
    id: "00000000-0000-4000-8000-000000000010",
    handle: "maki",
    displayName: "Maki",
    avatarUrl: null,
    badges: []
  },
  mediaType: "vod",
  caption: "Studio cut with a locked full playback state.",
  posterUrl: "https://picsum.photos/seed/veel-viewer/1400/1800",
  playback: {
    state: "not_ready",
    url: null,
    provider: "none"
  },
  accessState: "locked",
  nsfwLabel: "none",
  engagement: {
    liked: false,
    saved: false,
    likeCount: 128,
    commentCount: 18,
    shareCount: 9
  }
};

export default async function ContentPage({
  params
}: {
  params: Promise<{ contentId: string }>;
}) {
  const { contentId } = await params;
  const item = {
    ...sampleContent,
    id: contentId
  };

  return (
    <main className="min-h-screen bg-[var(--background)] text-[var(--foreground)]">
      <nav className="mx-auto flex w-full max-w-7xl items-center justify-between border-b border-[var(--line)] px-5 py-4">
        <a className="text-lg font-semibold tracking-normal" href="/">
          VEEL
        </a>
        <div className="flex gap-1">
          {appShellNavItems.map((navItem) => (
            <a
              className="rounded px-3 py-2 text-sm text-[var(--muted)] transition hover:bg-[var(--panel)] hover:text-[var(--foreground)]"
              href={navItem.href}
              key={navItem.href}
            >
              {navItem.label}
            </a>
          ))}
        </div>
      </nav>

      <section className="mx-auto grid min-h-[calc(100vh-73px)] w-full max-w-7xl gap-5 px-5 py-5 lg:grid-cols-[minmax(0,1fr)_340px]">
        <MediaStage item={item} />
        <AccessPanel item={item} />
      </section>
    </main>
  );
}

function MediaStage({ item }: { item: ContentItem }) {
  return (
    <section className="relative min-h-[68vh] overflow-hidden rounded border border-[var(--line)] bg-[#0f1217]">
      {item.posterUrl ? (
        <img
          alt=""
          className="absolute inset-0 h-full w-full object-cover"
          src={item.posterUrl}
        />
      ) : null}
      <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/5 to-black/35" />
      <div className="absolute left-4 top-4 rounded bg-[var(--background)]/85 px-2 py-1 text-xs font-medium">
        {item.mediaType.toUpperCase()}
      </div>
      <div className="absolute bottom-0 left-0 right-0 p-5">
        <p className="text-sm font-medium text-[var(--accent)]">@{item.creator.handle}</p>
        <h1 className="mt-2 max-w-3xl text-2xl font-semibold tracking-normal">
          Media viewer
        </h1>
        {item.caption ? (
          <p className="mt-3 max-w-2xl text-sm leading-6 text-zinc-200">{item.caption}</p>
        ) : null}
      </div>
    </section>
  );
}

function AccessPanel({ item }: { item: ContentItem }) {
  return (
    <aside className="grid content-start gap-4">
      <section className="rounded border border-[var(--line)] bg-[var(--panel)] p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">{item.creator.displayName}</p>
            <p className="text-sm text-[var(--muted)]">@{item.creator.handle}</p>
          </div>
          <span className="rounded bg-[var(--accent-soft)] px-2 py-1 text-xs font-medium uppercase text-[var(--accent-strong)]">
            {item.accessState}
          </span>
        </div>

        <div className="mt-5 grid gap-3 border-t border-[var(--line)] pt-4">
          <div>
            <p className="text-xs font-medium uppercase text-[var(--muted)]">Playback</p>
            <p className="mt-1 text-sm">{item.playback?.state ?? "not_ready"}</p>
          </div>
          <div>
            <p className="text-xs font-medium uppercase text-[var(--muted)]">Provider</p>
            <p className="mt-1 text-sm">{item.playback?.provider ?? "none"}</p>
          </div>
        </div>
      </section>

      <section className="rounded border border-[var(--line)] bg-[var(--panel)] p-4">
        <div className="grid grid-cols-3 gap-3 text-center">
          <Metric label="Likes" value={item.engagement.likeCount} />
          <Metric label="Comments" value={item.engagement.commentCount} />
          <Metric label="Shares" value={item.engagement.shareCount} />
        </div>
      </section>
    </aside>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <p className="text-lg font-semibold">{value.toLocaleString()}</p>
      <p className="text-xs text-[var(--muted)]">{label}</p>
    </div>
  );
}
