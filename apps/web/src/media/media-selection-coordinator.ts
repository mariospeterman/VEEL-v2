export type PreparedMediaSelection<TItem> = {
  items: TItem[];
  dispose: () => void;
};

type MediaSelectionCoordinatorOptions<TInput, TItem> = {
  prepare: (input: TInput, signal: AbortSignal) => Promise<PreparedMediaSelection<TItem>>;
  readCurrent: () => readonly TItem[];
  replace: (items: TItem[]) => void;
  validate: (items: readonly TItem[]) => string | null;
  onCommitted?: () => void;
  onPendingChange?: (pendingCount: number) => void;
  onError: (error: unknown) => void;
};

export type MediaSelectionCoordinator<TInput> = {
  enqueue: (input: TInput) => Promise<void>;
  settle: () => Promise<void>;
  abort: () => void;
};

type PreparationOutcome<TItem> =
  | { ok: true; prepared: PreparedMediaSelection<TItem> }
  | { ok: false; error: unknown };

/**
 * Starts metadata work immediately, but commits picker batches in selection
 * order against the latest state. This prevents a slow earlier video from
 * overwriting a later selection or reintroducing an item removed meanwhile.
 */
export function createMediaSelectionCoordinator<TInput, TItem>(
  options: MediaSelectionCoordinatorOptions<TInput, TItem>
): MediaSelectionCoordinator<TInput> {
  const controllers = new Set<AbortController>();
  let commitTail = Promise.resolve();
  let pendingCount = 0;
  let stopped = false;

  const changePendingCount = (delta: number) => {
    pendingCount = Math.max(0, pendingCount + delta);
    options.onPendingChange?.(pendingCount);
  };

  const enqueue = (input: TInput) => {
    if (stopped) return Promise.resolve();

    changePendingCount(1);
    const controller = new AbortController();
    controllers.add(controller);
    const outcome: Promise<PreparationOutcome<TItem>> = Promise.resolve()
      .then(() => options.prepare(input, controller.signal))
      .then(
        (prepared): PreparationOutcome<TItem> => {
          if (stopped || controller.signal.aborted) {
            prepared.dispose();
            return { ok: false, error: abortError() };
          }
          return { ok: true, prepared };
        },
        (error: unknown): PreparationOutcome<TItem> => ({ ok: false, error })
      )
      .finally(() => controllers.delete(controller));

    const commit = commitTail.then(async () => {
      const result = await outcome;
      if (!result.ok) {
        if (!stopped && !isAbortError(result.error)) options.onError(result.error);
        return;
      }
      if (stopped || controller.signal.aborted) {
        result.prepared.dispose();
        return;
      }

      const next = [...options.readCurrent(), ...result.prepared.items];
      const validationError = options.validate(next);
      if (validationError) {
        result.prepared.dispose();
        options.onError(new MediaSelectionValidationError(validationError));
        return;
      }

      options.replace(next);
      options.onCommitted?.();
    }).finally(() => changePendingCount(-1));

    commitTail = commit.catch(() => undefined);
    return commit;
  };

  return {
    enqueue,
    settle() {
      return commitTail;
    },
    abort() {
      stopped = true;
      for (const controller of controllers) controller.abort();
      controllers.clear();
    }
  };
}

export class MediaSelectionValidationError extends Error {}

function abortError() {
  return new DOMException("Media selection was cancelled", "AbortError");
}

function isAbortError(error: unknown) {
  return error instanceof DOMException && error.name === "AbortError";
}
