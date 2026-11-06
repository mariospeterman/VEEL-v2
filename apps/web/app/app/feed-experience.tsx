"use client";

import Link from "next/link";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import type { ContentItem, FeedPage, FeedPreferences } from "@/api-client";
import {
  ApiMutationError,
  getCurrentSession,
  getFeedPage,
  recordFeedImpression,
  updateFeedPreferences,
  type FollowState
} from "@/api-mutations";
import { createMutationIdempotencyKey } from "@/api-mutation-transport";
import { safeMutationMessage } from "@/api-errors";
import {
  advanceFeedWindowAfterAppend,
  calculateFeedSpacerHeight,
  createFeedWindow,
  maxRenderedFeedItems,
  mergeFeedItems,
  moveFeedWindow,
  type FeedWindow
} from "@/feed/bounded-feed-window";
import {
  restoreAuthorizedFeedView,
  type FeedViewPositionSnapshot
} from "@/feed/authorized-feed-view-restore";
import { ContentRenderer } from "../content/content-renderer";
import { FollowButton } from "../follow-button";
import { ContentEngagementPanel } from "../content/[contentId]/content-engagement-panel";
import { ContentPreferenceControl } from "./settings/content-preference-control";

type FeedMode = "latest" | "following";
type FeedSurface = "home" | "bits";

type FeedViewSnapshot = FeedViewPositionSnapshot & {
  estimatedHeight: number;
  gap: number;
  savedAt: number;
};

const feedViewCache = new Map<string, FeedViewSnapshot>();
const feedViewCacheTtlMs = 30 * 60 * 1000;
const maxFeedViewCacheEntries = 4;

export function FeedExperience({
  initialContentPreference,
  initialPage,
  surface
}: {
  initialContentPreference: FeedPreferences["nsfwPreference"];
  initialPage: FeedPage;
  surface: FeedSurface;
}) {
  const [page, setPage] = useState(initialPage);
  const [mode, setMode] = useState<FeedMode>(
    initialPage.mode === "following" ? "following" : "latest"
  );
  const [pending, setPending] = useState(false);
  const [modeSaving, setModeSaving] = useState(false);
  const [preferenceRefreshVersion, setPreferenceRefreshVersion] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [activeId, setActiveId] = useState(initialPage.items[0]?.id ?? null);
  const [followOverrides, setFollowOverrides] = useState<Record<string, FollowState>>({});
  const [renderWindow, setRenderWindow] = useState<FeedWindow>(() =>
    createFeedWindow(initialPage.items.length)
  );
  const [measurementVersion, setMeasurementVersion] = useState(0);
  const feedRef = useRef<HTMLDivElement>(null);
  const backwardSentinelRef = useRef<HTMLDivElement>(null);
  const forwardSentinelRef = useRef<HTMLDivElement>(null);
  const pendingRef = useRef(false);
  const seenRef = useRef(new Set<string>());
  const retryRef = useRef<{ mode: FeedMode; cursor?: string } | null>(null);
  const processedPreferenceRefreshRef = useRef(0);
  const pageRef = useRef(initialPage);
  const renderWindowRef = useRef(renderWindow);
  const measuredHeightsRef = useRef(new Map<string, number>());
  const estimatedHeightRef = useRef(surface === "bits" ? 640 : 540);
  const gapRef = useRef(surface === "bits" ? 16 : 18);
  const pendingScrollAnchorRef = useRef<{ contentId: string; top: number } | null>(null);
  const pendingRouteRestoreRef = useRef<number | null>(null);
  const lastScrollTopRef = useRef(0);
  const cacheScopeRef = useRef<string | null>(null);
  const navigationVersionRef = useRef(0);
  const modeRef = useRef(mode);
  const activeIdRef = useRef(activeId);
  pageRef.current = page;
  renderWindowRef.current = renderWindow;
  modeRef.current = mode;
  activeIdRef.current = activeId;
  const restoreKey = `wevid:${surface}:${mode}:scroll`;

  const renderedItems = useMemo(
    () => page.items.slice(renderWindow.start, renderWindow.end),
    [page.items, renderWindow.end, renderWindow.start]
  );
  const topSpacerHeight = useMemo(() => calculateFeedSpacerHeight(
    page.items,
    0,
    renderWindow.start,
    measuredHeightsRef.current,
    estimatedHeightRef.current,
    gapRef.current
  ), [measurementVersion, page.items, renderWindow.start]);
  const bottomSpacerHeight = useMemo(() => calculateFeedSpacerHeight(
    page.items,
    renderWindow.end,
    page.items.length,
    measuredHeightsRef.current,
    estimatedHeightRef.current,
    gapRef.current
  ), [measurementVersion, page.items, renderWindow.end]);

  const applyRenderWindow = useCallback((nextWindow: FeedWindow, preserveAnchor = true) => {
    const current = renderWindowRef.current;
    if (current.start === nextWindow.start && current.end === nextWindow.end) return false;
    if (preserveAnchor) pendingScrollAnchorRef.current = captureFeedScrollAnchor(feedRef.current, surface);
    renderWindowRef.current = nextWindow;
    setRenderWindow(nextWindow);
    return true;
  }, [surface]);

  const persistFeedViewSnapshot = useCallback(() => {
    const cacheScope = cacheScopeRef.current;
    if (!cacheScope) return;
    const scrollContainer = resolveFeedScrollContainer(feedRef.current, surface);
    const scrollTop = scrollContainer
      ? scrollContainer.scrollTop
      : feedRef.current
        ? window.scrollY
        : lastScrollTopRef.current;
    lastScrollTopRef.current = scrollTop;
    writeFeedViewSnapshot(feedViewCacheKey(cacheScope, surface, modeRef.current), {
      activeId: activeIdRef.current,
      estimatedHeight: estimatedHeightRef.current,
      gap: gapRef.current,
      itemIds: pageRef.current.items.map((item) => item.id),
      measuredHeights: [...measuredHeightsRef.current],
      renderWindow: renderWindowRef.current,
      savedAt: Date.now(),
      scrollTop
    });
  }, [surface]);

  const load = useCallback(async (nextMode: FeedMode, cursor?: string) => {
    if (pendingRef.current) return false;
    navigationVersionRef.current += 1;
    pendingRef.current = true;
    setPending(true);
    setError(null);
    try {
      const next = await getFeedPage(nextMode, surface, cursor);
      let resolved = next;
      if (cursor) {
        const previousItems = pageRef.current.items;
        const mergedItems = mergeFeedItems(previousItems, next.items);
        resolved = { ...next, items: mergedItems };
        const anchor = captureFeedScrollAnchor(feedRef.current, surface);
        const anchorIndex = anchor
          ? mergedItems.findIndex((item) => item.id === anchor.contentId)
          : undefined;
        applyRenderWindow(advanceFeedWindowAfterAppend(
          renderWindowRef.current,
          previousItems.length,
          mergedItems.length,
          maxRenderedFeedItems,
          anchorIndex !== undefined && anchorIndex >= 0 ? anchorIndex : undefined
        ));
      } else {
        pendingScrollAnchorRef.current = null;
        measuredHeightsRef.current.clear();
        estimatedHeightRef.current = surface === "bits" ? 640 : 540;
        gapRef.current = surface === "bits" ? 16 : 18;
        setMeasurementVersion((current) => current + 1);
        applyRenderWindow(createFeedWindow(next.items.length), false);
      }
      pageRef.current = resolved;
      setPage(resolved);
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
          pageRef.current = fresh;
          setPage(fresh);
          pendingScrollAnchorRef.current = null;
          measuredHeightsRef.current.clear();
          setMeasurementVersion((current) => current + 1);
          applyRenderWindow(createFeedWindow(fresh.items.length), false);
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
  }, [applyRenderWindow, surface]);

  useEffect(() => {
    if (
      pending ||
      pendingRef.current ||
      preferenceRefreshVersion === processedPreferenceRefreshRef.current
    ) {
      return;
    }
    processedPreferenceRefreshRef.current = preferenceRefreshVersion;
    void load(mode);
  }, [load, mode, pending, preferenceRefreshVersion]);

  useEffect(() => {
    let cancelled = false;
    const initialNavigationVersion = navigationVersionRef.current;
    void getCurrentSession().then(async (session) => {
      if (cancelled || !session.authenticated || !session.user) return;
      cacheScopeRef.current = session.clientSessionScope;
      if (navigationVersionRef.current !== initialNavigationVersion) return;
      const snapshot = readFeedViewSnapshot(feedViewCacheKey(
        session.clientSessionScope,
        surface,
        modeRef.current
      ));
      if (!snapshot) return;
      const restored = await restoreAuthorizedFeedView(
        pageRef.current,
        snapshot,
        (cursor) => getFeedPage(modeRef.current, surface, cursor)
      );
      if (cancelled || navigationVersionRef.current !== initialNavigationVersion) return;

      measuredHeightsRef.current = new Map(restored.measuredHeights);
      estimatedHeightRef.current = snapshot.estimatedHeight;
      gapRef.current = snapshot.gap;
      pageRef.current = restored.page;
      renderWindowRef.current = restored.renderWindow;
      pendingRouteRestoreRef.current = restored.scrollTop;
      if (restored.scrollTop !== null) lastScrollTopRef.current = restored.scrollTop;
      setPage(restored.page);
      setRenderWindow(restored.renderWindow);
      setActiveId(restored.activeId);
      setMeasurementVersion((current) => current + 1);
    }).catch(() => {
      // The server-rendered first page remains usable when the cache scope cannot be resolved.
    });

    return () => {
      cancelled = true;
      persistFeedViewSnapshot();
    };
  }, [persistFeedViewSnapshot, surface]);

  useEffect(() => {
    const scrollContainer = resolveFeedScrollContainer(feedRef.current, surface);
    const frame = requestAnimationFrame(() => {
      const saved = Number(sessionStorage.getItem(restoreKey));
      if (Number.isFinite(saved) && saved > 0) {
        lastScrollTopRef.current = saved;
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
        const scrollTop = scrollContainer?.scrollTop ?? window.scrollY;
        lastScrollTopRef.current = scrollTop;
        sessionStorage.setItem(restoreKey, String(scrollTop));
        scheduled = false;
        saveFrame = null;
      });
    };
    const target = scrollContainer ?? window;
    target.addEventListener("scroll", save, { passive: true });
    feedRef.current?.setAttribute("data-scroll-persistence", "ready");
    return () => {
      const scrollTop = scrollContainer?.scrollTop ?? lastScrollTopRef.current;
      lastScrollTopRef.current = scrollTop;
      sessionStorage.setItem(restoreKey, String(scrollTop));
      cancelAnimationFrame(frame);
      if (saveFrame !== null) cancelAnimationFrame(saveFrame);
      target.removeEventListener("scroll", save);
      feedRef.current?.removeAttribute("data-scroll-persistence");
    };
  }, [restoreKey, surface]);

  useLayoutEffect(() => {
    const anchor = pendingScrollAnchorRef.current;
    if (!anchor) return;
    pendingScrollAnchorRef.current = null;
    const element = findFeedItemElement(feedRef.current, anchor.contentId);
    if (!element) return;
    const delta = element.getBoundingClientRect().top - anchor.top;
    if (Math.abs(delta) < 0.5) return;
    const scrollContainer = resolveFeedScrollContainer(feedRef.current, surface);
    if (scrollContainer) scrollContainer.scrollTop += delta;
    else window.scrollBy({ top: delta });
  }, [measurementVersion, renderWindow, surface]);

  useLayoutEffect(() => {
    const scrollTop = pendingRouteRestoreRef.current;
    if (scrollTop === null) return;
    pendingRouteRestoreRef.current = null;
    const frame = requestAnimationFrame(() => {
      const scrollContainer = resolveFeedScrollContainer(feedRef.current, surface);
      lastScrollTopRef.current = scrollTop;
      if (scrollContainer) scrollContainer.scrollTo({ top: scrollTop });
      else window.scrollTo({ top: scrollTop });
    });
    return () => cancelAnimationFrame(frame);
  }, [page.items, renderWindow, surface]);

  useLayoutEffect(() => {
    const root = feedRef.current;
    if (!root) return;
    const elements = [...root.querySelectorAll<HTMLElement>("[data-content-id]")];
    const updateMeasurements = (targets: HTMLElement[]) => {
      let changed = false;
      for (const element of targets) {
        const contentId = element.dataset.contentId;
        const height = element.getBoundingClientRect().height;
        if (!contentId || !Number.isFinite(height) || height <= 0) continue;
        const previous = measuredHeightsRef.current.get(contentId);
        if (previous !== undefined && Math.abs(previous - height) < 0.5) continue;
        measuredHeightsRef.current.set(contentId, height);
        changed = true;
      }

      const nextGap = Number.parseFloat(window.getComputedStyle(root).rowGap) || 0;
      if (Math.abs(gapRef.current - nextGap) >= 0.5) {
        gapRef.current = nextGap;
        changed = true;
      }
      if (measuredHeightsRef.current.size > 0) {
        const total = [...measuredHeightsRef.current.values()].reduce((sum, height) => sum + height, 0);
        const nextEstimate = total / measuredHeightsRef.current.size;
        if (Math.abs(estimatedHeightRef.current - nextEstimate) >= 0.5) {
          estimatedHeightRef.current = nextEstimate;
          changed = true;
        }
      }
      if (changed) {
        if (renderWindowRef.current.start > 0) {
          pendingScrollAnchorRef.current ??= captureFeedScrollAnchor(root, surface);
        }
        setMeasurementVersion((current) => current + 1);
      }
    };

    updateMeasurements(elements);
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver((entries) => {
      updateMeasurements(entries.map((entry) => entry.target as HTMLElement));
    });
    elements.forEach((element) => observer.observe(element));
    return () => observer.disconnect();
  }, [renderedItems, surface]);

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
  }, [renderWindow, renderedItems]);

  useEffect(() => {
    const backwardSentinel = backwardSentinelRef.current;
    const forwardSentinel = forwardSentinelRef.current;
    if (!backwardSentinel && !forwardSentinel) return;
    const observer = new IntersectionObserver((entries) => {
      const backwardVisible = entries.some((entry) =>
        entry.isIntersecting && entry.target === backwardSentinel
      );
      if (backwardVisible) {
        const anchor = captureFeedScrollAnchor(feedRef.current, surface);
        const anchorIndex = anchor
          ? pageRef.current.items.findIndex((item) => item.id === anchor.contentId)
          : undefined;
        applyRenderWindow(moveFeedWindow(
          renderWindowRef.current,
          pageRef.current.items.length,
          "backward",
          maxRenderedFeedItems,
          anchorIndex !== undefined && anchorIndex >= 0 ? anchorIndex : undefined
        ));
        return;
      }

      const forwardVisible = entries.some((entry) =>
        entry.isIntersecting && entry.target === forwardSentinel
      );
      if (!forwardVisible) return;
      if (renderWindowRef.current.end < pageRef.current.items.length) {
        const anchor = captureFeedScrollAnchor(feedRef.current, surface);
        const anchorIndex = anchor
          ? pageRef.current.items.findIndex((item) => item.id === anchor.contentId)
          : undefined;
        applyRenderWindow(moveFeedWindow(
          renderWindowRef.current,
          pageRef.current.items.length,
          "forward",
          maxRenderedFeedItems,
          anchorIndex !== undefined && anchorIndex >= 0 ? anchorIndex : undefined
        ));
        return;
      }
      if (pageRef.current.nextCursor) {
        void load(mode, pageRef.current.nextCursor);
      }
    }, {
      root: resolveFeedScrollContainer(feedRef.current, surface),
      rootMargin: "500px 0px"
    });
    if (backwardSentinel) observer.observe(backwardSentinel);
    if (forwardSentinel) observer.observe(forwardSentinel);
    return () => observer.disconnect();
  }, [applyRenderWindow, load, mode, page.items.length, page.nextCursor, renderWindow, surface]);

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
      const focusNext = () => {
        const nextElement = findFeedItemElement(feedRef.current, next.id);
        nextElement?.scrollIntoView({
          behavior: prefersReducedMotion() ? "auto" : "smooth",
          block: "start"
        });
        nextElement?.focus({ preventScroll: true });
      };
      if (nextIndex < renderWindowRef.current.start || nextIndex >= renderWindowRef.current.end) {
        const direction = nextIndex < renderWindowRef.current.start ? "backward" : "forward";
        applyRenderWindow(moveFeedWindow(
          renderWindowRef.current,
          page.items.length,
          direction,
          maxRenderedFeedItems,
          nextIndex
        ));
        requestAnimationFrame(() => requestAnimationFrame(focusNext));
      } else {
        focusNext();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [activeId, applyRenderWindow, page.items, surface]);

  const nextPoster = useMemo(() => {
    const index = page.items.findIndex((item) => item.id === activeId);
    return page.items[index + 1]?.posterUrl ?? null;
  }, [activeId, page.items]);

  async function selectMode(nextMode: FeedMode) {
    if (nextMode === mode || modeSaving) return;
    persistFeedViewSnapshot();
    if (!(await load(nextMode))) return;
    modeRef.current = nextMode;
    setMode(nextMode);
    setModeSaving(true);
    try {
      await updateFeedPreferences(
        { defaultMode: nextMode },
        createMutationIdempotencyKey()
      );
    } catch (failure) {
      setError(safeMutationMessage(failure, "Default feed"));
    } finally {
      setModeSaving(false);
    }
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
    const options: FeedMode[] = ["latest", "following"];
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
      window.requestAnimationFrame(() => document.getElementById(`feed-mode-${nextMode}`)?.focus());
    });
  }

  return (
    <section aria-label={`${surface === "bits" ? "Bits" : "Home"} feed`}>
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="feed-mode-tabs" role="tablist" aria-label="Feed mode">
          {(["latest", "following"] as const).map((option) => (
            <button
              aria-controls="feed-items"
              aria-disabled={pending || modeSaving}
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
              {option === "latest" ? "Latest" : "Following"}
            </button>
          ))}
        </div>
        <details className="relative">
          <summary className="min-h-11 cursor-pointer list-none rounded-full border border-(--line) px-4 py-2.5 text-sm font-semibold">
            Content
          </summary>
          <div className="absolute right-0 z-20 mt-2 w-[min(22rem,calc(100vw-2rem))] rounded-2xl border border-(--line) bg-(--surface) p-3 shadow-xl">
            <p className="mb-2 text-sm font-semibold">Show me</p>
            <ContentPreferenceControl
              compact
              initialPreference={initialContentPreference}
              onChanged={() => setPreferenceRefreshVersion((current) => current + 1)}
            />
          </div>
        </details>
      </div>

      <div
        aria-busy={pending}
        aria-labelledby={`feed-mode-${mode}`}
        className={surface === "bits" ? "bits-feed" : "home-feed"}
        id="feed-items"
        ref={feedRef}
        role="tabpanel"
      >
        {renderWindow.start > 0 ? (
          <div
            aria-hidden="true"
            data-feed-window-boundary="backward"
            ref={backwardSentinelRef}
            style={{ height: topSpacerHeight }}
          />
        ) : null}
        {renderedItems.map((item, offset) => (
          <FeedCard
            active={activeId === item.id}
            {...(followOverrides[item.creator.id]
              ? { followState: followOverrides[item.creator.id] }
              : {})}
            item={item}
            key={item.id}
            onFollowChange={updateCreatorFollow}
            position={renderWindow.start + offset + 1}
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
        {renderWindow.end < page.items.length || page.nextCursor ? (
          <div
            aria-hidden="true"
            className="feed-sentinel"
            data-feed-window-boundary="forward"
            ref={forwardSentinelRef}
            style={{ height: bottomSpacerHeight || 1 }}
          />
        ) : null}
      </div>

      {page.items.length > maxRenderedFeedItems ? (
        <p className="sr-only">
          Showing loaded posts {renderWindow.start + 1} through {renderWindow.end}. Earlier and later posts load as you scroll.
        </p>
      ) : null}

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
  position,
  surface
}: {
  active: boolean;
  followState?: FollowState;
  item: ContentItem;
  onFollowChange: (state: FollowState) => void;
  position: number;
  surface: FeedSurface;
}) {
  return (
    <article
      aria-label={`Post by ${item.creator.displayName}`}
      className={surface === "bits" ? "bits-card" : "home-feed-card"}
      data-content-id={item.id}
      data-feed-position={position}
      tabIndex={surface === "bits" ? (active ? 0 : -1) : undefined}
    >
      <header className="feed-card-header">
        <Link className="feed-creator" href={`/profile/${item.creator.handle}`} prefetch={false}>
          <span className="feed-avatar" aria-hidden="true">
            {item.creator.avatarUrl ? <img alt="" src={item.creator.avatarUrl} /> : item.creator.displayName.slice(0, 1)}
          </span>
          <span><strong>{item.creator.displayName}</strong><small>@{item.creator.handle}</small></span>
        </Link>
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
        <ContentRenderer active={active} item={item} title={`${item.creator.displayName} post`} />
        <span className="feed-access-pill">{accessLabel(item.accessState)}</span>
      </div>

      <div className="feed-card-copy">
        {item.caption ? <p>{item.caption}</p> : null}
        <Link className="feed-open-link" href={`/content/${item.id}`} prefetch={false}>
          {item.accessState === "locked" ? "View unlock offer" : "Open post"}
        </Link>
      </div>

      <div className={surface === "bits" ? "bits-actions" : "feed-actions"}>
        <ContentEngagementPanel
          accessState={item.accessState}
          contentId={item.id}
          creatorUserId={item.creator.id}
          initialEngagement={item.engagement}
        />
      </div>
    </article>
  );
}

function accessLabel(state: ContentItem["accessState"]) {
  if (state === "free" || state === "unlocked") return "Ready to watch";
  if (state === "subscribed") return "Included with membership";
  if (state === "pass_required") return "Event Access required";
  if (state === "teaser") return "Preview";
  return "Unlock to watch";
}

function FeedSkeleton({ surface }: { surface: FeedSurface }) {
  return <div aria-label="Loading more posts" className={surface === "bits" ? "bits-card feed-skeleton" : "home-feed-card feed-skeleton"} role="status" />;
}

function prefersReducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function isInteractiveTarget(target: EventTarget | null) {
  return target instanceof HTMLElement && Boolean(target.closest(
    "a, button, input, textarea, select, [contenteditable='true'], [role='tab']"
  ));
}

function resolveFeedScrollContainer(root: HTMLElement | null, surface: FeedSurface) {
  if (!root) return null;
  if (surface === "bits") {
    const overflowY = window.getComputedStyle(root).overflowY;
    if (overflowY === "auto" || overflowY === "scroll") return root;
  }
  return root.closest<HTMLElement>(".page-frame");
}

function captureFeedScrollAnchor(root: HTMLElement | null, surface: FeedSurface) {
  if (!root) return null;
  const scrollContainer = resolveFeedScrollContainer(root, surface);
  const viewport = scrollContainer?.getBoundingClientRect() ?? {
    top: 0,
    bottom: window.innerHeight
  };
  const elements = [...root.querySelectorAll<HTMLElement>("[data-content-id]")];
  const focusedCard = document.activeElement instanceof HTMLElement
    ? document.activeElement.closest<HTMLElement>("[data-content-id]")
    : null;
  const focusedRect = focusedCard?.getBoundingClientRect();
  const anchor = focusedCard && root.contains(focusedCard) && focusedRect
    && focusedRect.bottom > viewport.top && focusedRect.top < viewport.bottom
    ? focusedCard
    : elements
      .filter((element) => {
        const rect = element.getBoundingClientRect();
        return rect.bottom > viewport.top && rect.top < viewport.bottom;
      })
      .sort((left, right) => {
        const leftTop = left.getBoundingClientRect().top;
        const rightTop = right.getBoundingClientRect().top;
        return Math.abs(leftTop - viewport.top) - Math.abs(rightTop - viewport.top);
      })[0];
  const contentId = anchor?.dataset.contentId;
  return contentId ? { contentId, top: anchor.getBoundingClientRect().top } : null;
}

function findFeedItemElement(root: HTMLElement | null, contentId: string) {
  if (!root) return null;
  return [...root.querySelectorAll<HTMLElement>("[data-content-id]")]
    .find((element) => element.dataset.contentId === contentId) ?? null;
}

function feedViewCacheKey(scope: string, surface: FeedSurface, mode: FeedMode) {
  return `${scope}:${surface}:${mode}`;
}

function readFeedViewSnapshot(key: string) {
  const snapshot = feedViewCache.get(key);
  if (!snapshot) return null;
  if (Date.now() - snapshot.savedAt > feedViewCacheTtlMs) {
    feedViewCache.delete(key);
    return null;
  }
  return snapshot;
}

function writeFeedViewSnapshot(key: string, snapshot: FeedViewSnapshot) {
  for (const [cachedKey, cached] of feedViewCache) {
    if (Date.now() - cached.savedAt > feedViewCacheTtlMs) feedViewCache.delete(cachedKey);
  }
  feedViewCache.delete(key);
  feedViewCache.set(key, snapshot);
  while (feedViewCache.size > maxFeedViewCacheEntries) {
    const oldestKey = feedViewCache.keys().next().value;
    if (typeof oldestKey !== "string") break;
    feedViewCache.delete(oldestKey);
  }
}
