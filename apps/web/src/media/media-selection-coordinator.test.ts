import { describe, expect, it, vi } from "vitest";
import {
  createMediaSelectionCoordinator,
  type PreparedMediaSelection
} from "./media-selection-coordinator";

describe("media selection coordinator", () => {
  it("commits concurrently prepared batches in picker order", async () => {
    let current: string[] = [];
    const first = deferred<PreparedMediaSelection<string>>();
    const second = deferred<PreparedMediaSelection<string>>();
    const coordinator = createMediaSelectionCoordinator<string, string>({
      prepare: (name) => name === "first" ? first.promise : second.promise,
      readCurrent: () => current,
      replace: (items) => { current = items; },
      validate: () => null,
      onError: vi.fn()
    });

    const firstCommit = coordinator.enqueue("first");
    const secondCommit = coordinator.enqueue("second");
    second.resolve(prepared("second"));
    await Promise.resolve();
    expect(current).toEqual([]);

    first.resolve(prepared("first"));
    await Promise.all([firstCommit, secondCommit]);

    expect(current).toEqual(["first", "second"]);
  });

  it("merges against current state so a removal during metadata work stays removed", async () => {
    let current = ["existing"];
    const pending = deferred<PreparedMediaSelection<string>>();
    const coordinator = createMediaSelectionCoordinator<void, string>({
      prepare: () => pending.promise,
      readCurrent: () => current,
      replace: (items) => { current = items; },
      validate: () => null,
      onError: vi.fn()
    });

    const commit = coordinator.enqueue();
    current = [];
    pending.resolve(prepared("new"));
    await commit;

    expect(current).toEqual(["new"]);
  });

  it("keeps separate re-selections and validates the atomic final count", async () => {
    let current: string[] = [];
    const errors: unknown[] = [];
    const coordinator = createMediaSelectionCoordinator<string, string>({
      prepare: async (name) => prepared(name),
      readCurrent: () => current,
      replace: (items) => { current = items; },
      validate: (items) => items.length > 2 ? "too many" : null,
      onError: (error) => errors.push(error)
    });

    await Promise.all([
      coordinator.enqueue("same-file"),
      coordinator.enqueue("same-file"),
      coordinator.enqueue("third")
    ]);

    expect(current).toEqual(["same-file", "same-file"]);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({ message: "too many" });
  });

  it("aborts in-flight metadata and disposes results completed after unmount", async () => {
    let current: string[] = [];
    let signal: AbortSignal | undefined;
    const pending = deferred<PreparedMediaSelection<string>>();
    const dispose = vi.fn();
    const onError = vi.fn();
    const coordinator = createMediaSelectionCoordinator<void, string>({
      prepare: (_input, nextSignal) => {
        signal = nextSignal;
        return pending.promise;
      },
      readCurrent: () => current,
      replace: (items) => { current = items; },
      validate: () => null,
      onError
    });

    const commit = coordinator.enqueue();
    await Promise.resolve();
    coordinator.abort();
    pending.resolve({ items: ["late"], dispose });
    await commit;

    expect(signal?.aborted).toBe(true);
    expect(dispose).toHaveBeenCalledOnce();
    expect(current).toEqual([]);
    expect(onError).not.toHaveBeenCalled();
  });
});

function prepared<T>(item: T): PreparedMediaSelection<T> {
  return { items: [item], dispose: vi.fn() };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}
