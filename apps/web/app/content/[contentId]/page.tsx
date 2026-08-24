import { appShellNavItems } from "@veel/ui";
import { getContentItem, type ContentItem } from "@/api-client";
import { ContentRenderer } from "../content-renderer";
import { ErrorState } from "../../ui";
import { ContentUnlockPanel } from "./content-unlock-panel";
import { ContentEngagementPanel } from "./content-engagement-panel";

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
      <ContentRenderer item={item} title={`${item.creator.displayName} post`} />
      <div className="absolute left-4 top-4 rounded bg-(--background)/85 px-2 py-1 text-xs font-medium">
        {mediaTypeLabel(item.mediaType)}
      </div>
      <div className="absolute bottom-0 left-0 right-0 p-5">
        <p className="text-sm font-medium text-(--accent-text)">@{item.creator.handle}</p>
        <h1 className="mt-2 max-w-3xl text-2xl font-semibold tracking-normal">{item.creator.displayName}’s post</h1>
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
          <span className="rounded bg-(--accent-soft) px-2 py-1 text-xs font-medium text-(--accent-strong)">{accessLabel(item.accessState)}</span>
        </div>

        <p className="mt-4 border-t border-(--line) pt-4 text-sm leading-6 text-(--muted)">{accessDescription(item.accessState)}</p>
      </section>

      <ContentEngagementPanel
        accessState={item.accessState}
        contentId={item.id}
        creatorUserId={item.creator.id}
        initialEngagement={item.engagement}
      />
      <ContentUnlockPanel accessState={item.accessState} contentId={item.id} />
    </aside>
  );
}

function mediaTypeLabel(type: ContentItem["mediaType"]) {
  if (type === "vod" || type === "live_replay") return "Video";
  if (type === "carousel") return "Carousel";
  if (type === "poll") return "Poll";
  if (type === "text") return "Text";
  return "Image";
}

function accessLabel(state: ContentItem["accessState"]) {
  if (state === "free" || state === "unlocked") return "Ready to watch";
  if (state === "subscribed") return "Included with membership";
  if (state === "pass_required") return "Event Access required";
  if (state === "teaser") return "Preview available";
  return "Unlock to watch";
}

function accessDescription(state: ContentItem["accessState"]) {
  if (state === "free" || state === "unlocked" || state === "subscribed") return "You have access to this post.";
  if (state === "pass_required") return "Get the related Event Access Pass to watch the full post.";
  if (state === "teaser") return "Watch the preview, then review the unlock offer for full access.";
  return "Review the offer below to unlock the full post.";
}
