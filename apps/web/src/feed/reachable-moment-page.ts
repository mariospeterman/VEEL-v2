import { mergeFeedItems } from "./bounded-feed-window";

export type MomentCursorPage<TItem extends { id: string }> = {
  items: TItem[];
  nextCursor?: string | null;
};

export const maxMomentContinuationRequests = 4;

/**
 * Candidate pages can become empty after server-side eligibility checks. Follow advancing cursors
 * until at least one newly authorized moment is reachable, while bounding each automatic/manual
 * continuation attempt and retaining the final cursor for an explicit follow-up attempt.
 */
export async function loadReachableMomentContinuation<
  TItem extends { id: string },
  TPage extends MomentCursorPage<TItem>
>(
  initialPage: TPage,
  readNextPage: (cursor: string) => Promise<TPage>,
  requestLimit = maxMomentContinuationRequests
): Promise<TPage> {
  const initialItemCount = initialPage.items.length;
  const boundedRequestLimit = Number.isFinite(requestLimit)
    ? Math.max(0, Math.trunc(requestLimit))
    : maxMomentContinuationRequests;
  const visitedCursors = new Set<string>();
  let page = initialPage;

  for (let requestCount = 0; requestCount < boundedRequestLimit; requestCount += 1) {
    const cursor = page.nextCursor;
    if (!cursor) break;
    if (visitedCursors.has(cursor)) {
      page = { ...page, nextCursor: null };
      break;
    }
    visitedCursors.add(cursor);

    const next = await readNextPage(cursor);
    const mergedItems = mergeFeedItems(page.items, next.items);
    const nextCursor = next.nextCursor && !visitedCursors.has(next.nextCursor)
      ? next.nextCursor
      : null;
    page = { ...next, items: mergedItems, nextCursor };

    if (mergedItems.length > initialItemCount) break;
  }

  return page;
}
