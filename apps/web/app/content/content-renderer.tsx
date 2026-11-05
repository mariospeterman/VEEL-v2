"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import type {
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent
} from "react";
import type { ContentItem } from "@/api-client";
import { ApiMutationError, getContentForMutation } from "@/api-mutations";
import {
  coalesceContentAccessRefresh,
  contentAccessSourceKey,
  createContentAccessRetryScheduler,
  isAuthoritativeContentAccessDenial
} from "@/media/content-access-refresh";
import { ProviderPlayback } from "../provider-playback";

type ContentRendererProps = {
  active?: boolean;
  item: ContentItem;
  title: string;
};

export function ContentRenderer({ active = true, item: initialItem, title }: ContentRendererProps) {
  const { item, refreshAccess, unavailable } = useRenewableContentItem(initialItem);
  if (unavailable) {
    return <ContentState title="Media unavailable" detail="Your access changed or this media is no longer available." />;
  }
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
      ? <AuthorizedImage active={active} asset={image} onAccessRefresh={refreshAccess} />
      : <ContentState title="Image unavailable" detail="This image is still being prepared or is no longer available." />;
  }

  if (item.mediaType === "carousel") {
    return <CarouselRenderer active={active} item={item} onAccessRefresh={refreshAccess} title={title} />;
  }

  if (!active) {
    return item.posterUrl
      ? <img alt="" className="h-full w-full object-contain" loading="lazy" src={item.posterUrl} />
      : <ContentState title="Media paused" detail="Open this post to load its media." />;
  }

  return (
    <ProviderPlayback
      onLeaseStarted={() => refreshAccess("playback_lease")}
      playback={item.playback}
      posterUrl={item.posterUrl}
      resourceKey={`content:${item.id}`}
      title={title}
    />
  );
}

function CarouselRenderer({ active, item, onAccessRefresh, title }: ContentRendererProps & {
  active: boolean;
  onAccessRefresh: AccessRefresh;
}) {
  const assets = useMemo(() => orderedAssets(item), [item]);
  const [index, setIndex] = useState(0);
  const statusId = useId();
  const pointerStartX = useRef<number | null>(null);
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

  function onPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    pointerStartX.current = event.clientX;
  }

  function onPointerUp(event: ReactPointerEvent<HTMLDivElement>) {
    const startX = pointerStartX.current;
    pointerStartX.current = null;
    if (startX === null) return;
    const distance = event.clientX - startX;
    if (Math.abs(distance) < 48) return;
    move(distance > 0 ? -1 : 1);
  }

  return (
    <div
      aria-describedby={statusId}
      aria-label="Media carousel"
      className="relative h-full min-h-64 w-full touch-pan-y outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white"
      onKeyDown={onKeyDown}
      onPointerCancel={() => { pointerStartX.current = null; }}
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
      role="group"
      tabIndex={0}
    >
      <CarouselAsset active={active} asset={asset} item={item} onAccessRefresh={onAccessRefresh} title={`${title}, item ${index + 1}`} />
      <AdjacentImagePreload assets={assets} index={index} />
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

function AdjacentImagePreload({ assets, index }: {
  assets: NonNullable<ContentItem["mediaAssets"]>;
  index: number;
}) {
  if (assets.length < 2) return null;
  const adjacentIndexes = new Set([
    (index - 1 + assets.length) % assets.length,
    (index + 1) % assets.length
  ]);
  return (
    <div aria-hidden="true" className="pointer-events-none absolute size-0 overflow-hidden">
      {[...adjacentIndexes].map((adjacentIndex) => {
        const adjacent = assets[adjacentIndex];
        return adjacent?.kind === "image" && adjacent.posterUrl
          ? <img alt="" key={adjacent.id} loading="lazy" src={adjacent.posterUrl} />
          : null;
      })}
    </div>
  );
}

function CarouselAsset({ active, asset, item, onAccessRefresh, title }: {
  active: boolean;
  asset: NonNullable<ContentItem["mediaAssets"]>[number];
  item: ContentItem;
  onAccessRefresh: AccessRefresh;
  title: string;
}) {
  if (asset.kind === "image" && asset.posterUrl) {
    return <AuthorizedImage active={active} asset={asset} onAccessRefresh={onAccessRefresh} />;
  }

  if (asset.kind === "video" && active) {
    const playback = asset.playback
      ?? (item.mediaAssets?.filter((entry) => entry.kind === "video").length === 1
        ? item.playback
        : undefined);
    return (
      <ProviderPlayback
        onLeaseStarted={() => onAccessRefresh("playback_lease")}
        playback={playback}
        posterUrl={asset.posterUrl ?? item.posterUrl}
        resourceKey={`asset:${asset.id}`}
        title={title}
      />
    );
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

type AccessRefreshOutcome = "refreshed" | "retrying" | "unavailable";
type AccessRefresh = (
  cause: "expiry" | "image_error" | "playback_lease"
) => Promise<AccessRefreshOutcome>;

function AuthorizedImage({ active, asset, onAccessRefresh }: {
  active: boolean;
  asset: NonNullable<ContentItem["mediaAssets"]>[number];
  onAccessRefresh: AccessRefresh;
}) {
  const delivery = asset.imageDelivery;
  const sourceUrl = delivery?.url ?? asset.posterUrl ?? undefined;
  const failedUrl = useRef<string | null>(null);

  useEffect(() => {
    if (!active || !delivery?.expiresAt) return;
    const delay = Math.max(0, Date.parse(delivery.expiresAt) - Date.now() - 10_000);
    const timeout = window.setTimeout(() => { void onAccessRefresh("expiry"); }, delay);
    return () => window.clearTimeout(timeout);
  }, [active, delivery?.expiresAt, onAccessRefresh]);

  return (
    <img
      alt={asset.altText ?? ""}
      className="h-full w-full object-contain"
      loading={active ? "eager" : "lazy"}
      onError={() => {
        if (!sourceUrl || failedUrl.current === sourceUrl) return;
        failedUrl.current = sourceUrl;
        void onAccessRefresh("image_error");
      }}
      src={sourceUrl}
      srcSet={delivery?.variants
        .map((variant) => `${variant.url} ${variant.widthPixels}w`)
        .join(", ")}
    />
  );
}

function useRenewableContentItem(initialItem: ContentItem): {
  item: ContentItem;
  refreshAccess: AccessRefresh;
  unavailable: boolean;
} {
  const sourceKey = contentAccessSourceKey(initialItem);
  const [refreshed, setRefreshed] = useState<{ sourceKey: string; item: ContentItem } | null>(null);
  const [unavailableFor, setUnavailableFor] = useState<string | null>(null);
  const lastAttempt = useRef<{
    sourceKey: string;
    cause: "expiry" | "image_error" | "playback_lease";
    at: number;
  } | null>(null);
  const latestAccessKey = useRef(sourceKey);
  const refreshAccessRef = useRef<AccessRefresh>(async () => "retrying");
  const retryScheduler = useRef<ReturnType<typeof createContentAccessRetryScheduler> | null>(null);
  if (!retryScheduler.current) retryScheduler.current = createContentAccessRetryScheduler();

  useEffect(() => {
    latestAccessKey.current = sourceKey;
    retryScheduler.current?.reset();
    return () => retryScheduler.current?.reset();
  }, [sourceKey]);

  const refreshAccess = useCallback<AccessRefresh>(async (cause) => {
    const now = Date.now();
    const prior = lastAttempt.current;
    if (prior?.sourceKey === sourceKey && prior.cause === cause && now - prior.at < 1_000) {
      return "retrying";
    }
    lastAttempt.current = { sourceKey, cause, at: now };

    try {
      const requestKey = latestAccessKey.current;
      const next = await coalesceContentAccessRefresh(
        requestKey,
        () => getContentForMutation(initialItem.id)
      );
      if (next.id !== initialItem.id) {
        retryScheduler.current?.reset();
        setUnavailableFor(sourceKey);
        return "unavailable";
      }
      const nextAccessKey = contentAccessSourceKey(next);
      if (nextAccessKey === requestKey) {
        retryScheduler.current?.schedule(() => {
          void refreshAccessRef.current(cause);
        });
        return "retrying";
      }
      latestAccessKey.current = nextAccessKey;
      retryScheduler.current?.reset();
      setRefreshed({ sourceKey, item: next });
      setUnavailableFor((current) => current === sourceKey ? null : current);
      return "refreshed";
    } catch (error) {
      const status = error instanceof ApiMutationError ? error.status : undefined;
      if (isAuthoritativeContentAccessDenial(status)) {
        retryScheduler.current?.reset();
        setUnavailableFor(sourceKey);
        return "unavailable";
      }
      retryScheduler.current?.schedule(() => {
        void refreshAccessRef.current(cause);
      });
      return "retrying";
    }
  }, [initialItem.id, sourceKey]);
  refreshAccessRef.current = refreshAccess;

  return {
    item: refreshed?.sourceKey === sourceKey ? refreshed.item : initialItem,
    refreshAccess,
    unavailable: unavailableFor === sourceKey
  };
}

function PollRenderer({ contentId, initialPoll }: {
  contentId: string;
  initialPoll: NonNullable<ContentItem["poll"]>;
}) {
  const poll = initialPoll;

  return (
    <section className="grid max-h-full gap-4 overflow-auto p-5 text-left sm:p-7" aria-labelledby={`poll-${contentId}`}>
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-(--muted)">Archived poll</p>
        <h2 className="mt-2 text-xl font-semibold" id={`poll-${contentId}`}>{poll.question}</h2>
      </div>
      <div className="grid gap-2">
        {poll.options.map((option) => {
          const selected = poll.viewerOptionId === option.id;
          const share = poll.totalVoteCount > 0 ? Math.round((option.voteCount / poll.totalVoteCount) * 100) : 0;
          return (
            <div
              aria-current={selected ? "true" : undefined}
              className={`relative min-h-12 overflow-hidden rounded border px-4 py-3 text-left ${selected ? "border-(--accent)" : "border-(--line)"}`}
              key={option.id}
            >
              <span aria-hidden="true" className="absolute inset-y-0 left-0 bg-(--accent-soft)" style={{ width: `${share}%` }} />
              <span className="relative flex items-center justify-between gap-3"><span>{option.text}</span><span className="text-xs font-semibold">{share}%</span></span>
            </div>
          );
        })}
      </div>
      <p className="text-xs text-(--muted)">
        {poll.totalVoteCount} {poll.totalVoteCount === 1 ? "retained vote" : "retained votes"}. Voting is no longer available.
      </p>
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
