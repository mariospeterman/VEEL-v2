export const maxRenderedFeedItems = 60;

export function retainNewestFeedItems<T extends { id: string }>(
  current: T[],
  incoming: T[],
  limit = maxRenderedFeedItems
): { evicted: T[]; items: T[] } {
  const knownIds = new Set(current.map((item) => item.id));
  const merged = [...current, ...incoming.filter((item) => !knownIds.has(item.id))];
  const overflow = Math.max(0, merged.length - Math.max(1, limit));
  return {
    evicted: merged.slice(0, overflow),
    items: merged.slice(overflow)
  };
}
