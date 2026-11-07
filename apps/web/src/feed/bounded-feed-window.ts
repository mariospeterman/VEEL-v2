export const maxRenderedFeedItems = 60;

export type FeedWindow = Readonly<{
  start: number;
  end: number;
}>;

export function mergeFeedItems<T extends { id: string }>(current: T[], incoming: T[]): T[] {
  const knownIds = new Set(current.map((item) => item.id));
  const merged = [...current];
  for (const item of incoming) {
    if (knownIds.has(item.id)) continue;
    knownIds.add(item.id);
    merged.push(item);
  }
  return merged;
}

export function createFeedWindow(
  itemCount: number,
  limit = maxRenderedFeedItems,
  preferredIndex = 0
): FeedWindow {
  const count = normalizeCount(itemCount);
  const size = Math.min(count, normalizeLimit(limit));
  if (size === 0) return { start: 0, end: 0 };

  const anchor = clamp(Math.trunc(preferredIndex), 0, count - 1);
  const start = clamp(anchor - Math.floor(size / 2), 0, count - size);
  return { start, end: start + size };
}

export function moveFeedWindow(
  current: FeedWindow,
  itemCount: number,
  direction: "backward" | "forward",
  limit = maxRenderedFeedItems,
  anchorIndex?: number
): FeedWindow {
  const count = normalizeCount(itemCount);
  const size = Math.min(count, normalizeLimit(limit));
  if (size === 0) return { start: 0, end: 0 };
  if (count <= size) return { start: 0, end: count };

  const normalized = normalizeWindow(current, count, size);
  const step = Math.max(1, Math.floor(size / 3));
  const requestedStart = normalized.start + (direction === "forward" ? step : -step);
  let start = clamp(requestedStart, 0, count - size);

  if (anchorIndex !== undefined && Number.isFinite(anchorIndex)) {
    const anchor = clamp(Math.trunc(anchorIndex), 0, count - 1);
    if (anchor < start) start = anchor;
    if (anchor >= start + size) start = anchor - size + 1;
    start = clamp(start, 0, count - size);
  }

  return { start, end: start + size };
}

export function advanceFeedWindowAfterAppend(
  current: FeedWindow,
  previousItemCount: number,
  nextItemCount: number,
  limit = maxRenderedFeedItems,
  anchorIndex?: number
): FeedWindow {
  const previousCount = normalizeCount(previousItemCount);
  const nextCount = normalizeCount(nextItemCount);
  if (nextCount <= previousCount) {
    return normalizeWindow(current, nextCount, Math.min(nextCount, normalizeLimit(limit)));
  }
  if (current.end < previousCount) {
    return normalizeWindow(current, nextCount, Math.min(nextCount, normalizeLimit(limit)));
  }
  return moveFeedWindow(current, nextCount, "forward", limit, anchorIndex);
}

export function calculateFeedSpacerHeight<T extends { id: string }>(
  items: T[],
  start: number,
  end: number,
  measuredHeights: ReadonlyMap<string, number>,
  estimatedHeight: number,
  gap: number
): number {
  const from = clamp(Math.trunc(start), 0, items.length);
  const to = clamp(Math.trunc(end), from, items.length);
  const count = to - from;
  if (count === 0) return 0;

  const fallback = positiveFiniteOr(estimatedHeight, 1);
  let height = Math.max(0, gap) * Math.max(0, count - 1);
  for (let index = from; index < to; index += 1) {
    const item = items[index];
    height += item ? positiveFiniteOr(measuredHeights.get(item.id), fallback) : fallback;
  }
  return height;
}

function normalizeWindow(current: FeedWindow, count: number, size: number): FeedWindow {
  if (count === 0 || size === 0) return { start: 0, end: 0 };
  const start = clamp(Math.trunc(current.start), 0, Math.max(0, count - size));
  return { start, end: Math.min(count, start + size) };
}

function normalizeCount(value: number) {
  return Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0;
}

function normalizeLimit(value: number) {
  return Number.isFinite(value) ? Math.max(1, Math.trunc(value)) : 1;
}

function positiveFiniteOr(value: number | undefined, fallback: number) {
  return value !== undefined && Number.isFinite(value) && value > 0 ? value : fallback;
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}
