import {
  createFeedWindow,
  maxRenderedFeedItems,
  mergeFeedItems,
  type FeedWindow
} from "./bounded-feed-window";

export type AuthorizedFeedPage<TItem extends { id: string }> = {
  items: TItem[];
  nextCursor?: string | null;
};

export type FeedViewPositionSnapshot = {
  activeId: string | null;
  itemIds: string[];
  measuredHeights: [string, number][];
  renderWindow: FeedWindow;
  scrollTop: number;
};

export type AuthorizedFeedViewRestore<TPage> = {
  activeId: string | null;
  measuredHeights: [string, number][];
  page: TPage;
  renderWindow: FeedWindow;
  scrollTop: number | null;
};

const maxRestorePageRequests = 4;

/**
 * Rebuilds a cached position only from newly authorized feed pages. Cached
 * content resources and cursors are never trusted or displayed.
 */
export async function restoreAuthorizedFeedView<
  TItem extends { id: string },
  TPage extends AuthorizedFeedPage<TItem>
>(
  initialPage: TPage,
  snapshot: FeedViewPositionSnapshot,
  readNextPage: (cursor: string) => Promise<TPage>,
  requestLimit = maxRestorePageRequests
): Promise<AuthorizedFeedViewRestore<TPage>> {
  let page = initialPage;
  const cachedActiveIndex = snapshot.activeId
    ? snapshot.itemIds.indexOf(snapshot.activeId)
    : -1;
  const requestedItemCount = Math.max(
    1,
    snapshot.renderWindow.end,
    cachedActiveIndex >= 0 ? cachedActiveIndex + 1 : 0
  );
  const boundedRequestLimit = Number.isFinite(requestLimit)
    ? Math.max(0, Math.trunc(requestLimit))
    : maxRestorePageRequests;

  for (let requestCount = 0; requestCount < boundedRequestLimit; requestCount += 1) {
    const activeAlreadyAuthorized = Boolean(
      snapshot.activeId && page.items.some((item) => item.id === snapshot.activeId)
    );
    if (activeAlreadyAuthorized || page.items.length >= requestedItemCount || !page.nextCursor) break;

    const previousItemCount = page.items.length;
    const next = await readNextPage(page.nextCursor);
    const mergedItems = mergeFeedItems(page.items, next.items);
    page = { ...next, items: mergedItems };
    if (mergedItems.length === previousItemCount) break;
  }

  const authorizedIds = new Set(page.items.map((item) => item.id));
  const exactActiveIndex = snapshot.activeId
    ? page.items.findIndex((item) => item.id === snapshot.activeId)
    : -1;
  const fallbackIndex = page.items.length === 0
    ? -1
    : Math.min(
      Math.max(cachedActiveIndex, snapshot.renderWindow.start, 0),
      page.items.length - 1
    );
  const activeIndex = exactActiveIndex >= 0 ? exactActiveIndex : fallbackIndex;
  const activeId = activeIndex >= 0 ? page.items[activeIndex]?.id ?? null : null;

  return {
    activeId,
    measuredHeights: snapshot.measuredHeights.filter(([id]) => authorizedIds.has(id)),
    page,
    renderWindow: createFeedWindow(page.items.length, maxRenderedFeedItems, Math.max(0, activeIndex)),
    scrollTop: exactActiveIndex >= 0 ? snapshot.scrollTop : null
  };
}
