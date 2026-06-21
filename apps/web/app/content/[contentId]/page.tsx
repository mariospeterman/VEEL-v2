import { appShellNavItems } from "@veel/ui";
import { getContentItem, type ContentItem } from "@/api-client";
import { ProviderPlayback } from "../../provider-playback";
import { ErrorState } from "../../ui";
import { ContentUnlockPanel } from "./content-unlock-panel";

export default async function ContentPage({
  params
}: {
  params: Promise<{ contentId: string }>;
}) {
  const { contentId } = await params;
  const itemResult = await getContentItem(contentId);

  return (
    <main className="media-shell">
      <nav className="media-nav">
        <a className="text-lg font-semibold tracking-normal" href="/app/home">
          WeVid
        </a>
        <div className="flex gap-1">
          {appShellNavItems.map((navItem) => (
            <a
              className="rounded px-3 py-2 text-sm text-(--muted) transition hover:bg-(--panel) hover:text-(--foreground)"
              href={navItem.href}
              key={navItem.href}
            >
              {navItem.label}
            </a>
          ))}
        </div>
      </nav>

      <section className="media-layout">
        {itemResult.ok ? (
          <>
            <MediaStage item={itemResult.data} />
            <AccessPanel item={itemResult.data} />
          </>
        ) : (
          <section className="lg:col-span-2">
            <ErrorState
              context="Content"
              result={itemResult}
              title={itemResult.status === 404 ? "Content not found" : "Content unavailable"}
            />
          </section>
        )}
      </section>
    </main>
  );
}

function MediaStage({ item }: { item: ContentItem }) {
  return (
    <section className="media-pane relative overflow-hidden rounded border border-(--line) bg-[#0f1217]">
      <ProviderPlayback playback={item.playback} posterUrl={item.posterUrl} title="WeVid content playback" />
      <div className="absolute left-4 top-4 rounded bg-(--background)/85 px-2 py-1 text-xs font-medium">
        {item.mediaType.toUpperCase()}
      </div>
      <div className="absolute bottom-0 left-0 right-0 p-5">
        <p className="text-sm font-medium text-(--accent)">@{item.creator.handle}</p>
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
    <aside className="side-pane grid content-start gap-4">
      <section className="rounded border border-(--line) bg-(--panel) p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">{item.creator.displayName}</p>
            <p className="text-sm text-(--muted)">@{item.creator.handle}</p>
          </div>
          <span className="rounded bg-(--accent-soft) px-2 py-1 text-xs font-medium uppercase text-(--accent-strong)">
            {item.accessState}
          </span>
        </div>

        <div className="mt-5 grid gap-3 border-t border-(--line) pt-4">
          <div>
            <p className="text-xs font-medium uppercase text-(--muted)">Playback</p>
            <p className="mt-1 text-sm">{item.playback?.state ?? "not_ready"}</p>
          </div>
          <div>
            <p className="text-xs font-medium uppercase text-(--muted)">Provider</p>
            <p className="mt-1 text-sm">{item.playback?.provider ?? "none"}</p>
          </div>
        </div>
      </section>

      <section className="rounded border border-(--line) bg-(--panel) p-4">
        <div className="grid grid-cols-3 gap-3 text-center">
          <Metric label="Likes" value={item.engagement.likeCount} />
          <Metric label="Comments" value={item.engagement.commentCount} />
          <Metric label="Shares" value={item.engagement.shareCount} />
        </div>
      </section>

      <EngagementActions item={item} />
      <ContentUnlockPanel accessState={item.accessState} contentId={item.id} />
    </aside>
  );
}

function EngagementActions({ item }: { item: ContentItem }) {
  return (
    <section className="rounded border border-(--line) bg-(--panel) p-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-semibold">Engagement</p>
        <span className="rounded bg-(--accent-soft) px-2 py-1 text-xs font-medium text-(--accent-strong)">
          server-owned
        </span>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2">
        <button
          className="rounded border border-(--line) px-3 py-2 text-sm font-medium transition hover:bg-(--background)"
          type="button"
        >
          {item.engagement.liked ? "Liked" : "Like"}
        </button>
        <button
          className="rounded border border-(--line) px-3 py-2 text-sm font-medium transition hover:bg-(--background)"
          type="button"
        >
          {item.engagement.saved ? "Saved" : "Save"}
        </button>
        <button
          className="rounded border border-(--line) px-3 py-2 text-sm font-medium transition hover:bg-(--background)"
          type="button"
        >
          Share
        </button>
        <button
          className="rounded border border-(--line) px-3 py-2 text-sm font-medium transition hover:bg-(--background)"
          type="button"
        >
          Comment
        </button>
      </div>

      <div className="mt-3 grid gap-2">
        <button
          className="rounded border border-[#fca5a5] px-3 py-2 text-sm font-medium text-[#b91c1c] transition hover:bg-[#fef2f2]"
          type="button"
        >
          Report content
        </button>
        <div className="grid grid-cols-2 gap-2">
          <button
            className="rounded border border-(--line) px-3 py-2 text-sm font-medium transition hover:bg-(--background)"
            type="button"
          >
            Hide creator
          </button>
          <button
            className="rounded border border-(--line) px-3 py-2 text-sm font-medium transition hover:bg-(--background)"
            type="button"
          >
            Block creator
          </button>
        </div>
      </div>
    </section>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <p className="text-lg font-semibold">{value.toLocaleString()}</p>
      <p className="text-xs text-(--muted)">{label}</p>
    </div>
  );
}
