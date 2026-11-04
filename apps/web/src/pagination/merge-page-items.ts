export function appendUniquePageItems<T extends { id: string }>(current: T[], incoming: T[]): T[] {
  return mergeUniquePageItems(current, incoming);
}

export function prependUniquePageItems<T extends { id: string }>(current: T[], incoming: T[]): T[] {
  return mergeUniquePageItems(incoming, current);
}

function mergeUniquePageItems<T extends { id: string }>(first: T[], second: T[]): T[] {
  const seen = new Set<string>();
  return [...first, ...second].filter((item) => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
}
