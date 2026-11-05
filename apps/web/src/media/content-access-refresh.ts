const inFlightRefreshes = new Map<string, Promise<unknown>>();

export const CONTENT_ACCESS_RETRY_DELAYS_MS = [5_000, 15_000, 30_000] as const;

type TimerHandle = ReturnType<typeof setTimeout>;

export function createContentAccessRetryScheduler(input: {
  setTimer?: (callback: () => void, delayMs: number) => TimerHandle;
  clearTimer?: (timer: TimerHandle) => void;
} = {}) {
  const setTimer = input.setTimer ?? ((callback, delayMs) => setTimeout(callback, delayMs));
  const clearTimer = input.clearTimer ?? ((timer) => clearTimeout(timer));
  let attempts = 0;
  let timer: TimerHandle | null = null;
  let disposed = false;

  return {
    schedule(retry: () => void): boolean {
      if (disposed || timer !== null || attempts >= CONTENT_ACCESS_RETRY_DELAYS_MS.length) {
        return false;
      }
      const delayMs = CONTENT_ACCESS_RETRY_DELAYS_MS[attempts]!;
      attempts += 1;
      timer = setTimer(() => {
        timer = null;
        if (!disposed) retry();
      }, delayMs);
      return true;
    },
    reset() {
      if (timer !== null) clearTimer(timer);
      timer = null;
      attempts = 0;
    },
    dispose() {
      if (timer !== null) clearTimer(timer);
      timer = null;
      disposed = true;
    }
  };
}

export function isAuthoritativeContentAccessDenial(status: number | undefined): boolean {
  return status === 401 || status === 403 || status === 404 || status === 410;
}

interface ContentAccessKeyInput {
  id: string;
  compositionRevision?: number | null;
  posterUrl?: string | null;
  playback?: {
    state?: string;
    url?: string | null;
    expiresAt?: string | null;
    blockReason?: string | null;
    usage?: {
      targetType?: string;
      targetId?: string;
      leaseExpiresAt?: string | null;
    } | null;
  } | null;
  mediaAssets?: Array<{
    id?: string;
    posterUrl?: string | null;
    imageDelivery?: {
      url: string;
      expiresAt: string;
      variants: Array<{ url: string }>;
    } | null;
    playback?: {
      state?: string;
      url?: string | null;
      expiresAt?: string | null;
      blockReason?: string | null;
      usage?: {
        targetType?: string;
        targetId?: string;
        leaseExpiresAt?: string | null;
      } | null;
    } | null;
  }> | null;
}

/**
 * Distinguish viewer-scoped resources even when the canonical content revision
 * is unchanged (for example after logout/account switch or access revocation).
 * The key remains component-local and is never persisted or logged.
 */
export function contentAccessSourceKey(item: ContentAccessKeyInput): string {
  return JSON.stringify([
    item.id,
    item.compositionRevision ?? null,
    item.posterUrl ?? null,
    item.playback?.state ?? null,
    item.playback?.url ?? null,
    item.playback?.expiresAt ?? null,
    item.playback?.blockReason ?? null,
    item.playback?.usage?.targetType ?? null,
    item.playback?.usage?.targetId ?? null,
    item.playback?.usage?.leaseExpiresAt ?? null,
    ...(item.mediaAssets ?? []).map((asset) => [
      asset.id ?? null,
      asset.posterUrl ?? null,
      asset.imageDelivery?.url ?? null,
      asset.imageDelivery?.expiresAt ?? null,
      ...(asset.imageDelivery?.variants.map((variant) => variant.url) ?? []),
      asset.playback?.state ?? null,
      asset.playback?.url ?? null,
      asset.playback?.expiresAt ?? null,
      asset.playback?.blockReason ?? null,
      asset.playback?.usage?.targetType ?? null,
      asset.playback?.usage?.targetId ?? null,
      asset.playback?.usage?.leaseExpiresAt ?? null
    ])
  ]);
}

/**
 * Coalesce renewal requests for the same canonical content item without caching
 * the returned viewer-scoped resource. Signed URLs remain only in component
 * memory and are discarded with the caller's state.
 */
export function coalesceContentAccessRefresh<T>(
  accessKey: string,
  load: () => Promise<T>
): Promise<T> {
  const existing = inFlightRefreshes.get(accessKey) as Promise<T> | undefined;
  if (existing) return existing;

  const request = Promise.resolve().then(load);
  inFlightRefreshes.set(accessKey, request);
  const clear = () => {
    if (inFlightRefreshes.get(accessKey) === request) {
      inFlightRefreshes.delete(accessKey);
    }
  };
  void request.then(clear, clear);
  return request;
}
