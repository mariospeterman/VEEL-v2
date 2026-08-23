"use client";

import { useId, useMemo, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import type { ContentItem } from "@/api-client";
import { ApiMutationError, voteOnContentPoll } from "@/api-mutations";
import { createMutationIdempotencyKey } from "@/api-mutation-transport";
import { ProviderPlayback } from "../provider-playback";

type ContentRendererProps = {
  active?: boolean;
  item: ContentItem;
  title: string;
};

export function ContentRenderer({ active = true, item, title }: ContentRendererProps) {
  if (isRedacted(item)) return <ContentState title="Locked media" detail="Open the post to view the available access options." />;

  if (item.mediaType === "text") {
    return item.bodyText
      ? <p className="max-h-full overflow-auto whitespace-pre-wrap break-words p-6 text-left text-lg leading-8 sm:p-8">{item.bodyText}</p>
      : <ContentState title="Post unavailable" detail="This text post is not available right now." />;
  }

  if (item.mediaType === "poll") {
    return item.poll
      ? <PollRenderer contentId={item.id} initialPoll={item.poll} />
      : <ContentState title="Poll unavailable" detail="This poll is not available right now." />;
  }

  if (item.mediaType === "image") {
    const image = orderedAssets(item).find((asset) => asset.kind === "image");
    return image?.posterUrl
      ? <img alt={image.altText ?? ""} className="h-full w-full object-contain" loading={active ? "eager" : "lazy"} src={image.posterUrl} />
      : <ContentState title="Image unavailable" detail="This image is still being prepared or is no longer available." />;
  }

  if (item.mediaType === "carousel") {
    return <CarouselRenderer active={active} item={item} title={title} />;
  }

  if (!active && item.posterUrl) {
    return <img alt="" className="h-full w-full object-contain" loading="lazy" src={item.posterUrl} />;
  }

  return <ProviderPlayback playback={item.playback} posterUrl={item.posterUrl} title={title} />;
}

function CarouselRenderer({ active, item, title }: ContentRendererProps & { active: boolean }) {
  const assets = useMemo(() => orderedAssets(item), [item]);
  const [index, setIndex] = useState(0);
  const statusId = useId();
  const asset = assets[index];

  if (!asset) return <ContentState title="Post unavailable" detail="This carousel is not available right now." />;

  function move(direction: -1 | 1) {
    setIndex((current) => (current + direction + assets.length) % assets.length);
  }

  function onKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    move(event.key === "ArrowLeft" ? -1 : 1);
  }

  return (
    <div
      aria-describedby={statusId}
      aria-label="Media carousel"
      className="relative h-full min-h-64 w-full outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white"
      onKeyDown={onKeyDown}
      role="group"
      tabIndex={0}
    >
      <CarouselAsset active={active} asset={asset} item={item} title={`${title}, item ${index + 1}`} />
      {assets.length > 1 ? (
        <>
          <button aria-label="Previous media" className="absolute left-3 top-1/2 min-h-11 min-w-11 -translate-y-1/2 rounded-full bg-black/70 px-3 text-white" onClick={() => move(-1)} type="button">←</button>
          <button aria-label="Next media" className="absolute right-3 top-1/2 min-h-11 min-w-11 -translate-y-1/2 rounded-full bg-black/70 px-3 text-white" onClick={() => move(1)} type="button">→</button>
        </>
      ) : null}
      <p className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full bg-black/70 px-3 py-1 text-xs font-semibold text-white" id={statusId} aria-live="polite">
        {index + 1} of {assets.length}
      </p>
    </div>
  );
}

function CarouselAsset({ active, asset, item, title }: {
  active: boolean;
  asset: NonNullable<ContentItem["mediaAssets"]>[number];
  item: ContentItem;
  title: string;
}) {
  if (asset.kind === "image" && asset.posterUrl) {
    return <img alt={asset.altText ?? ""} className="h-full w-full object-contain" loading={active ? "eager" : "lazy"} src={asset.posterUrl} />;
  }

  if (asset.kind === "video" && active) {
    const playback = asset.playback
      ?? (item.mediaAssets?.filter((entry) => entry.kind === "video").length === 1
        ? item.playback
        : undefined);
    return <ProviderPlayback playback={playback} posterUrl={asset.posterUrl ?? item.posterUrl} title={title} />;
  }

  if (asset.posterUrl) {
    return (
      <div className="relative h-full w-full">
        <img alt={asset.altText ?? ""} className="h-full w-full object-contain" loading="lazy" src={asset.posterUrl} />
        {asset.kind === "video" ? <span className="absolute left-3 top-3 rounded bg-black/70 px-2 py-1 text-xs font-semibold text-white">Video</span> : null}
      </div>
    );
  }

  return <ContentState title="Media unavailable" detail="This item is still being prepared or is no longer available." />;
}

function PollRenderer({ contentId, initialPoll }: {
  contentId: string;
  initialPoll: NonNullable<ContentItem["poll"]>;
}) {
  const [poll, setPoll] = useState(initialPoll);
  const [pendingOptionId, setPendingOptionId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const closed = poll.state !== "open" || (poll.closesAt ? Date.parse(poll.closesAt) <= Date.now() : false);

  async function vote(optionId: string) {
    if (pendingOptionId || closed || poll.viewerOptionId === optionId) return;
    setPendingOptionId(optionId);
    setError(null);
    try {
      const confirmed = await voteOnContentPoll(
        contentId,
        { optionId },
        createMutationIdempotencyKey()
      );
      setPoll(confirmed);
    } catch (caught) {
      setError(caught instanceof ApiMutationError ? caught.message : "Your vote could not be saved.");
    } finally {
      setPendingOptionId(null);
    }
  }

  return (
    <section className="grid max-h-full gap-4 overflow-auto p-5 text-left sm:p-7" aria-labelledby={`poll-${contentId}`}>
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-(--muted)">Poll</p>
        <h2 className="mt-2 text-xl font-semibold" id={`poll-${contentId}`}>{poll.question}</h2>
      </div>
      <div className="grid gap-2">
        {poll.options.map((option) => {
          const selected = poll.viewerOptionId === option.id;
          const share = poll.totalVoteCount > 0 ? Math.round((option.voteCount / poll.totalVoteCount) * 100) : 0;
          return (
            <button
              aria-pressed={selected}
              className={`relative min-h-12 overflow-hidden rounded border px-4 py-3 text-left disabled:cursor-not-allowed ${selected ? "border-(--accent)" : "border-(--line)"}`}
              disabled={Boolean(pendingOptionId) || closed}
              key={option.id}
              onClick={() => void vote(option.id)}
              type="button"
            >
              <span aria-hidden="true" className="absolute inset-y-0 left-0 bg-(--accent-soft)" style={{ width: `${share}%` }} />
              <span className="relative flex items-center justify-between gap-3"><span>{option.text}</span><span className="text-xs font-semibold">{share}%</span></span>
            </button>
          );
        })}
      </div>
      <p className="text-xs text-(--muted)" aria-live="polite">{closed ? "Voting closed" : `${poll.totalVoteCount} ${poll.totalVoteCount === 1 ? "vote" : "votes"}`}</p>
      {error ? <p className="text-sm font-medium text-red-400" role="alert">{error}</p> : null}
    </section>
  );
}

function ContentState({ detail, title }: { detail: string; title: string }) {
  return <div className="grid h-full min-h-64 place-items-center p-6 text-center"><div><p className="font-semibold">{title}</p><p className="mt-2 text-sm text-(--muted)">{detail}</p></div></div>;
}

function orderedAssets(item: ContentItem) {
  return [...(item.mediaAssets ?? [])].sort((left, right) => left.position - right.position);
}

function isRedacted(item: ContentItem) {
  return (item.accessState === "locked" || item.accessState === "pass_required")
    && !item.bodyText
    && !item.poll
    && (item.mediaAssets?.length ?? 0) === 0
    && item.playback?.state !== "teaser";
}
