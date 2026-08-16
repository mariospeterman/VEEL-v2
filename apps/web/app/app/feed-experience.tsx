"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import type { ContentItem, FeedPage } from "@/api-client";
import {
  ApiMutationError,
  getFeedPage,
  recordFeedImpression,
  type FollowState
} from "@/api-mutations";
import { createMutationIdempotencyKey } from "@/api-mutation-transport";
import { safeMutationMessage } from "@/api-errors";
import { ProviderPlayback } from "../provider-playback";
import { FollowButton } from "../follow-button";
import { ContentEngagementPanel } from "../content/[contentId]/content-engagement-panel";

type FeedMode = "recommended" | "following";
type FeedSurface = "home" | "bits";

export function FeedExperience({
  initialPage,
  surface
}: {
  initialPage: FeedPage;
  surface: FeedSurface;
}) {
  const [page, setPage] = useState(initialPage);
  const [mode, setMode] = useState<FeedMode>(
    initialPage.mode === "following" ? "following" : "recommended"
  );
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeId, setActiveId] = useState(initialPage.items[0]?.id ?? null);
  const [followOverrides, setFollowOverrides] = useState<Record<string, FollowState>>({});
  const feedRef = useRef<HTMLDivElement>(null);
  const loadSentinelRef = useRef<HTMLDivElement>(null);
  const pendingRef = useRef(false);
  const seenRef = useRef(new Set<string>());
  const retryRef = useRef<{ mode: FeedMode; cursor?: string } | null>(null);
  const restoreKey = `wevid:${surface}:${mode}:scroll`;

  const load = useCallback(async (nextMode: FeedMode, cursor?: string) => {
    if (pendingRef.current) return false;
    pendingRef.current = true;
    setPending(true);
    setError(null);
    try {
      const next = await getFeedPage(nextMode, surface, cursor);
      setPage((current) => cursor
        ? { ...next, items: mergeItems(current.items, next.items) }
        : next);
      setActiveId((current) => {
        if (!cursor) return next.items[0]?.id ?? null;
        return current ?? next.items[0]?.id ?? null;
      });
      retryRef.current = null;
      return true;
    } catch (failure) {
      let reportedFailure = failure;
      if (cursor && failure instanceof ApiMutationError && failure.status === 409) {
        try {
          const fresh = await getFeedPage(nextMode, surface);
          setPage(fresh);
          setActiveId(fresh.items[0]?.id ?? null);
          retryRef.current = null;
          return true;
        } catch (refreshFailure) {
          reportedFailure = refreshFailure;
        }
      }
      retryRef.current = { mode: nextMode, ...(cursor ? { cursor } : {}) };
      setError(safeMutationMessage(reportedFailure, "Feed"));
      return false;
    } finally {
      pendingRef.current = false;
      setPending(false);
    }
  }, [surface]);

  useEffect(() => {
    const scrollContainer = surface === "bits"
      ? feedRef.current
      : feedRef.current?.closest<HTMLElement>(".page-frame") ?? null;
    const frame = requestAnimationFrame(() => {
      const saved = Number(sessionStorage.getItem(restoreKey));
      if (Number.isFinite(saved) && saved > 0) {
        if (scrollContainer) scrollContainer.scrollTo({ top: saved });
        else window.scrollTo({ top: saved });
      }
    });
    let scheduled = false;
    let saveFrame: number | null = null;
    const save = () => {
      if (scheduled) return;
      scheduled = true;
      saveFrame = requestAnimationFrame(() => {
        sessionStorage.setItem(restoreKey, String(scrollContainer?.scrollTop ?? window.scrollY));
        scheduled = false;
        saveFrame = null;
      });
    };
    const target = scrollContainer ?? window;
    target.addEventListener("scroll", save, { passive: true });
    feedRef.current?.setAttribute("data-scroll-persistence", "ready");
    return () => {
      cancelAnimationFrame(frame);
      if (saveFrame !== null) cancelAnimationFrame(saveFrame);
      target.removeEventListener("scroll", save);
      feedRef.current?.removeAttribute("data-scroll-persistence");
    };
  }, [restoreKey, surface]);

  useEffect(() => {
    const root = feedRef.current;
    if (!root) return;
    const observer = new IntersectionObserver((entries) => {
      const active = entries
        .filter((entry) => entry.isIntersecting)
        .sort((left, right) => right.intersectionRatio - left.intersectionRatio)[0];
      const contentId = active?.target.getAttribute("data-content-id");
      if (!contentId) return;
      setActiveId(contentId);
      if (!seenRef.current.has(contentId)) {
        seenRef.current.add(contentId);
        void recordFeedImpression({ contentId }, createMutationIdempotencyKey()).catch(() => {
          seenRef.current.delete(contentId);
        });
      }
    }, { threshold: [0.55, 0.8] });
    root.querySelectorAll<HTMLElement>("[data-content-id]").forEach((item) => observer.observe(item));
    return () => observer.disconnect();
  }, [page.items]);

  useEffect(() => {
    const sentinel = loadSentinelRef.current;
    if (!sentinel || !page.nextCursor) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) void load(mode, page.nextCursor ?? undefined);
    }, {
      root: surface === "bits" ? feedRef.current : null,
      rootMargin: "500px"
    });
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [load, mode, page.nextCursor, surface]);

  useEffect(() => {
    if (surface !== "bits") return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || isInteractiveTarget(event.target)) return;
      if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
      const index = page.items.findIndex((item) => item.id === activeId);
      const nextIndex = event.key === "ArrowDown" ? index + 1 : index - 1;
      const next = page.items[nextIndex];
      if (!next) return;
      event.preventDefault();
      const nextElement = document.querySelector<HTMLElement>(`[data-content-id="${next.id}"]`);
      nextElement?.scrollIntoView({ behavior: prefersReducedMotion() ? "auto" : "smooth", block: "start" });
      nextElement?.focus({ preventScroll: true });
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [activeId, page.items, surface]);

  const nextPoster = useMemo(() => {
    const index = page.items.findIndex((item) => item.id === activeId);
    return page.items[index + 1]?.posterUrl ?? null;
  }, [activeId, page.items]);

  async function selectMode(nextMode: FeedMode) {
    if (nextMode === mode) return;
    if (await load(nextMode)) setMode(nextMode);
  }

  async function retryLoad() {
    const retry = retryRef.current ?? { mode, cursor: page.nextCursor ?? undefined };
    if (await load(retry.mode, retry.cursor)) {
      retryRef.current = null;
      if (!retry.cursor) setMode(retry.mode);
    }
  }

  function updateCreatorFollow(next: FollowState) {
    setFollowOverrides((current) => ({ ...current, [next.userId]: next }));
  }

  function moveModeFocus(event: ReactKeyboardEvent<HTMLButtonElement>, option: FeedMode) {
    const options: FeedMode[] = ["recommended", "following"];
    const direction = event.key === "ArrowRight" || event.key === "ArrowDown"
      ? 1
      : event.key === "ArrowLeft" || event.key === "ArrowUp"
        ? -1
        : 0;
    if (!direction && event.key !== "Home" && event.key !== "End") return;
    event.preventDefault();
    const currentIndex = options.indexOf(option);
    const nextIndex = event.key === "Home"
      ? 0
      : event.key === "End"
        ? options.length - 1
        : (currentIndex + direction + options.length) % options.length;
    const nextMode = options[nextIndex];
    if (!nextMode) return;
    const nextButton = event.currentTarget.parentElement
      ?.querySelector<HTMLButtonElement>(`#feed-mode-${nextMode}`);
    nextButton?.focus();
    void selectMode(nextMode).finally(() => {
      window.requestAnimationFrame(() => nextButton?.focus());
    });
  }

  return (
    <section aria-label={`${surface === "bits" ? "Bits" : "Home"} feed`}>
      <div className="feed-mode-tabs" role="tablist" aria-label="Feed mode">
        {(["recommended", "following"] as const).map((option) => (
          <button
            aria-controls="feed-items"
            aria-disabled={pending}
            aria-selected={mode === option}
            className={mode === option ? "feed-mode-tab is-active" : "feed-mode-tab"}
            id={`feed-mode-${option}`}
            key={option}
            onClick={() => void selectMode(option)}
            onKeyDown={(event) => moveModeFocus(event, option)}
            role="tab"
            tabIndex={mode === option ? 0 : -1}
            type="button"
          >
            {option === "recommended" ? "For you" : "Following"}
          </button>
        ))}
      </div>

      <div
        aria-labelledby={`feed-mode-${mode}`}
        className={surface === "bits" ? "bits-feed" : "home-feed"}
        id="feed-items"
        ref={feedRef}
        role="tabpanel"
      >
        {page.items.map((item) => (
          <FeedCard
            active={activeId === item.id}
            {...(followOverrides[item.creator.id]
              ? { followState: followOverrides[item.creator.id] }
              : {})}
            item={item}
            key={item.id}
            onFollowChange={updateCreatorFollow}
            surface={surface}
          />
        ))}
        {page.items.length === 0 && !pending ? (
          <div className="feed-empty" role="status">
            <h2>{mode === "following" ? "Follow creators to build this feed" : "No released media yet"}</h2>
            <p>New eligible posts will appear here automatically.</p>
          </div>
        ) : null}
        {pending ? <FeedSkeleton surface={surface} /> : null}
        <div aria-hidden="true" className="feed-sentinel" ref={loadSentinelRef} />
      </div>

      {nextPoster ? <img alt="" aria-hidden="true" className="feed-preload" src={nextPoster} /> : null}
      {error ? (
        <div className="feed-retry" role="alert">
          <p>{error}</p>
          <button className="secondary-button" onClick={() => void retryLoad()} type="button">
            Retry
          </button>
        </div>
      ) : null}
      {!page.nextCursor && page.items.length > 0 ? <p className="feed-exhausted">You’re all caught up.</p> : null}
    </section>
  );
}

function FeedCard({
  active,
  followState,
  item,
  onFollowChange,
  surface
}: {
  active: boolean;
  followState?: FollowState;
  item: ContentItem;
  onFollowChange: (state: FollowState) => void;
  surface: FeedSurface;
}) {
  return (
    <article
      aria-label={`Post by ${item.creator.displayName}`}
      className={surface === "bits" ? "bits-card" : "home-feed-card"}
      data-content-id={item.id}
      tabIndex={surface === "bits" ? (active ? 0 : -1) : undefined}
    >
      <header className="feed-card-header">
        <a className="feed-creator" href={`/profile/${item.creator.handle}`}>
          <span className="feed-avatar" aria-hidden="true">
            {item.creator.avatarUrl ? <img alt="" src={item.creator.avatarUrl} /> : item.creator.displayName.slice(0, 1)}
          </span>
          <span><strong>{item.creator.displayName}</strong><small>@{item.creator.handle}</small></span>
        </a>
        <FollowButton
          initialState={followState ?? {
            userId: item.creator.id,
            following: item.viewerFollowingCreator ?? false,
            followerCount: 0,
            followingCount: 0
          }}
          onChange={onFollowChange}
          userId={item.creator.id}
        />
      </header>

      <div className="feed-media">
        {active ? (
          <ProviderPlayback
            playback={item.playback}
            posterUrl={item.posterUrl}
            title={`${item.creator.displayName} media`}
          />
        ) : item.posterUrl ? (
          <img alt="" className="feed-poster" loading="lazy" src={item.posterUrl} />
        ) : (
          <div className="feed-media-placeholder">Media loads when this post becomes active.</div>
        )}
        <span className="feed-access-pill">{item.accessState}</span>
      </div>

      <div className="feed-card-copy">
        {item.caption ? <p>{item.caption}</p> : null}
        <a className="feed-open-link" href={`/content/${item.id}`}>
          {item.accessState === "locked" ? "View unlock offer" : "Open post"}
        </a>
      </div>

      <div className={surface === "bits" ? "bits-actions" : "feed-actions"}>
        <ContentEngagementPanel
          contentId={item.id}
          creatorUserId={item.creator.id}
          initialEngagement={item.engagement}
        />
      </div>
    </article>
  );
}

function FeedSkeleton({ surface }: { surface: FeedSurface }) {
  return <div aria-label="Loading more posts" className={surface === "bits" ? "bits-card feed-skeleton" : "home-feed-card feed-skeleton"} role="status" />;
}

function mergeItems(current: ContentItem[], incoming: ContentItem[]) {
  const ids = new Set(current.map((item) => item.id));
  return [...current, ...incoming.filter((item) => !ids.has(item.id))];
}

function prefersReducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function isInteractiveTarget(target: EventTarget | null) {
  return target instanceof HTMLElement && Boolean(target.closest(
    "a, button, input, textarea, select, [contenteditable='true'], [role='tab']"
  ));
}
