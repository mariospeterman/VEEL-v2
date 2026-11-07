export type SubscriptionSearchParams = Record<string, string | string[] | undefined>;

const cursorKeys = ["platformCursor", "creatorCursor", "historyCursor"] as const;
export type SubscriptionCursorKey = (typeof cursorKeys)[number];

export function subscriptionCursor(
  searchParams: SubscriptionSearchParams,
  key: SubscriptionCursorKey
): string | undefined {
  const value = searchParams[key];
  const scalar = Array.isArray(value) ? value[0] : value;
  return scalar && scalar.length <= 4_096 ? scalar : undefined;
}

export function subscriptionPageHref(input: {
  searchParams: SubscriptionSearchParams;
  cursorKey: SubscriptionCursorKey;
  cursor: string;
}): string {
  const params = new URLSearchParams();
  for (const key of cursorKeys) {
    if (key === input.cursorKey) continue;
    const value = subscriptionCursor(input.searchParams, key);
    if (value) params.set(key, value);
  }
  params.set(input.cursorKey, input.cursor);
  return `/app/subscriptions?${params.toString()}`;
}
