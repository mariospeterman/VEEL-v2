import { afterEach, describe, expect, it, vi } from "vitest";
import { runPaymentOperationWithDeadline } from "./payment-operation-deadline";

describe("payment operation deadline", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("bounds a dependency that ignores cancellation while aborting the shared signal", async () => {
    vi.useFakeTimers();
    let operationSignal: AbortSignal | undefined;
    const operation = runPaymentOperationWithDeadline(
      (signal) => {
        operationSignal = signal;
        return new Promise<string>(() => undefined);
      },
      { totalTimeoutMs: 25 }
    );
    const rejection = expect(operation).rejects.toThrow("deadline exceeded");

    await vi.advanceTimersByTimeAsync(25);

    await rejection;
    expect(operationSignal?.aborted).toBe(true);
  });

  it("does not invoke work when the parent attempt was already cancelled", async () => {
    const controller = new AbortController();
    controller.abort(new Error("Unmounted"));
    const work = vi.fn().mockResolvedValue("unexpected");

    await expect(runPaymentOperationWithDeadline(work, {
      signal: controller.signal
    })).rejects.toThrow("Unmounted");
    expect(work).not.toHaveBeenCalled();
  });
});
