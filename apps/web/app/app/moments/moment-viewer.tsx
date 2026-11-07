"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FeedPage } from "@/api-client";
import { createMutationIdempotencyKey } from "@/api-mutation-transport";
import { ApiMutationError, getFeedPage, recordFeedImpression } from "@/api-mutations";
import { loadReachableMomentContinuation } from "@/feed/reachable-moment-page";
import { shouldIgnoreGlobalShortcut } from "@/navigation/global-shortcut-policy";
import { ContentRenderer } from "../../content/content-renderer";
import { ContentEngagementPanel } from "../../content/[contentId]/content-engagement-panel";

export function MomentViewer({
  initialPage,
  startId
}: {
  initialPage: FeedPage;
  startId: string | null;
}) {
  const initialIndex = Math.max(0, initialPage.items.findIndex((item) => item.id === startId));
  const [page, setPage] = useState(initialPage);
  const [index, setIndex] = useState(initialIndex);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const continuationPending = useRef(false);
  const initialContinuationStarted = useRef(false);
  const seen = useRef(new Set<string>());
  const item = page.items[index] ?? null;

  const progress = useMemo(() => page.items.map((_, itemIndex) => itemIndex <= index), [index, page.items]);

  useEffect(() => {
    if (!item || seen.current.has(item.id)) return;
    seen.current.add(item.id);
    void recordFeedImpression({ contentId: item.id }, createMutationIdempotencyKey()).catch(() => undefined);
  }, [item]);

  const continueMoments = useCallback(async (moveToFirstNewItem: boolean) => {
    if (!page.nextCursor || continuationPending.current) return;
    continuationPending.current = true;
    setPending(true);
    setError(null);
    const previousItemCount = page.items.length;
    try {
      const next = await loadReachableMomentContinuation(
        page,
        (cursor) => getFeedPage(
          page.mode === "following" ? "following" : "latest",
          "moments",
          cursor
        )
      );
      setPage(next);
      if (moveToFirstNewItem && next.items.length > previousItemCount) {
        setIndex(previousItemCount);
      }
    } catch (caught) {
      setError(caught instanceof ApiMutationError ? caught.message : "More moments could not be loaded.");
    } finally {
      continuationPending.current = false;
      setPending(false);
    }
  }, [page]);

  const move = useCallback(async (direction: -1 | 1) => {
    const target = index + direction;
    if (target >= 0 && target < page.items.length) {
      setIndex(target);
      return;
    }
    if (direction < 0) return;
    await continueMoments(true);
  }, [continueMoments, index, page.items.length]);

  useEffect(() => {
    if (
      initialContinuationStarted.current ||
      page.items.length > 0 ||
      !page.nextCursor
    ) return;
    initialContinuationStarted.current = true;
    void continueMoments(false);
  }, [continueMoments, page.items.length, page.nextCursor]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (
        (event.key !== "ArrowLeft" && event.key !== "ArrowRight") ||
        shouldIgnoreGlobalShortcut(event)
      ) return;
      event.preventDefault();
      void move(event.key === "ArrowLeft" ? -1 : 1);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [move]);

  if (!item) {
    return (
      <section className="moment-empty">
        <h1>{pending ? "Finding active moments" : "No active moments"}</h1>
        <p>{pending
          ? "Checking the next available moments for your account."
          : "Moments disappear 24 hours after they are published."}</p>
        {page.nextCursor ? (
          <button
            className="secondary-button"
            disabled={pending}
            onClick={() => void continueMoments(false)}
            type="button"
          >
            {pending ? "Checking…" : "Load more moments"}
          </button>
        ) : null}
        <a className="primary-button" href="/app/create?distribution=moment">Create a moment</a>
        {error ? <p className="moment-error" role="alert">{error}</p> : null}
      </section>
    );
  }

  return (
    <section aria-label="Moment viewer" className="moment-viewer">
      <div
        aria-label={`Moment ${index + 1} of ${page.items.length}`}
        aria-valuemax={page.items.length}
        aria-valuemin={1}
        aria-valuenow={index + 1}
        className="moment-progress"
        role="progressbar"
      >
        {progress.map((complete, progressIndex) => <span className={complete ? "is-complete" : ""} key={progressIndex} />)}
      </div>
      <header className="moment-viewer-header">
        <a className="feed-creator" href={`/profile/${item.creator.handle}`}>
          <span className="feed-avatar" aria-hidden="true">{item.creator.avatarUrl ? <img alt="" src={item.creator.avatarUrl} /> : item.creator.displayName.slice(0, 1)}</span>
          <span><strong>{item.creator.displayName}</strong><small>@{item.creator.handle}</small></span>
        </a>
        <a aria-label="Close moments" className="moment-close" href="/app/home">×</a>
      </header>
      <div className="moment-media">
        <ContentRenderer item={item} key={item.id} title={`${item.creator.displayName} moment`} />
      </div>
      <button aria-label="Previous moment" className="moment-nav moment-nav-previous" disabled={index === 0} onClick={() => void move(-1)} type="button">‹</button>
      <button aria-label="Next moment" className="moment-nav moment-nav-next" disabled={index === page.items.length - 1 && !page.nextCursor} onClick={() => void move(1)} type="button">›</button>
      <footer className="moment-footer">
        {item.caption ? <p>{item.caption}</p> : <span />}
        <ContentEngagementPanel accessState={item.accessState} contentId={item.id} creatorUserId={item.creator.id} initialEngagement={item.engagement} key={item.id} />
        <a className="text-sm font-semibold" href={`/app/messages?share=${encodeURIComponent(item.id)}`}>Reply in messages</a>
      </footer>
      {error ? <p className="moment-error" role="alert">{error}</p> : null}
    </section>
  );
}
