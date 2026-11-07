import { describe, expect, it, vi } from "vitest";
import {
  paymentSigningAttemptIdentity,
  runFencedPaymentSigningApproval,
  runWithExclusivePaymentSigningOwnership
} from "./payment-signing-attempt";

describe("fenced payment signing approval", () => {
  it("fails closed before wallet approval when cross-tab ownership is unavailable", async () => {
    const approve = vi.fn().mockResolvedValue("signed");

    await expect(runWithExclusivePaymentSigningOwnership(
      "scope-1",
      approve,
      null
    )).rejects.toThrow("ownership is unavailable");
    expect(approve).not.toHaveBeenCalled();
  });

  it("serializes two tabs before either can invoke wallet approval", async () => {
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    let queue = Promise.resolve<unknown>(undefined);
    const request = vi.fn(<T>(
      _name: string,
      _options: LockOptions,
      callback: (lock: Lock) => Promise<T>
    ): Promise<T> => {
      const result = queue.then(() => callback({ mode: "exclusive", name: "payment" } as Lock));
      queue = result.catch(() => undefined);
      return result;
    });
    const lockManager = { request } as unknown as LockManager;
    const events: string[] = [];

    const first = runWithExclusivePaymentSigningOwnership("scope-1", async () => {
      events.push("first-started");
      await firstGate;
      events.push("first-finished");
      return "first";
    }, lockManager);
    const second = runWithExclusivePaymentSigningOwnership("scope-1", async () => {
      events.push("second-started");
      return "second";
    }, lockManager);

    await vi.waitFor(() => expect(events).toEqual(["first-started"]));
    releaseFirst();

    await expect(Promise.all([first, second])).resolves.toEqual(["first", "second"]);
    expect(events).toEqual(["first-started", "first-finished", "second-started"]);
  });

  it("allows two tabs to recheck durable state so only one asks for wallet approval", async () => {
    let queue = Promise.resolve<unknown>(undefined);
    const request = vi.fn(<T>(
      _name: string,
      _options: LockOptions,
      callback: (lock: Lock) => Promise<T>
    ): Promise<T> => {
      const result = queue.then(() => callback({ mode: "exclusive", name: "payment" } as Lock));
      queue = result.catch(() => undefined);
      return result;
    });
    const lockManager = { request } as unknown as LockManager;
    let retainedSignature: string | null = null;
    const approve = vi.fn(async () => {
      retainedSignature = "signature-1";
    });
    const attempt = () => runWithExclusivePaymentSigningOwnership(
      "scope-1",
      async () => {
        if (retainedSignature) return;
        await approve();
      },
      lockManager
    );

    await Promise.all([attempt(), attempt()]);

    expect(retainedSignature).toBe("signature-1");
    expect(approve).toHaveBeenCalledOnce();
  });

  it("changes identity for wallet, request, and signing-capability changes", () => {
    const capability = vi.fn();
    const base = {
      checkoutUrl: "https://wallet.example/checkout-1",
      expiresAt: "2027-01-01T00:00:00.000Z",
      intentId: "intent-1",
      qrDataUrl: "data:image/svg+xml;base64,PHN2Zy8+",
      recoveryScope: "content:1",
      retryVersion: 0,
      signingCapability: capability,
      transactionRequestUrl: "https://wallet.example/request-1",
      walletAdapterName: "Test Wallet",
      walletAddress: "wallet-1"
    };
    const identity = paymentSigningAttemptIdentity(base);

    expect(paymentSigningAttemptIdentity(base)).toBe(identity);
    expect(paymentSigningAttemptIdentity({ ...base, walletAddress: "wallet-2" })).not.toBe(identity);
    expect(paymentSigningAttemptIdentity({
      ...base,
      checkoutUrl: "https://wallet.example/checkout-2"
    })).not.toBe(identity);
    expect(paymentSigningAttemptIdentity({
      ...base,
      signingCapability: vi.fn()
    })).not.toBe(identity);
  });

  it("stops stale preparation before invoking wallet approval", async () => {
    let finishPreparation!: (value: string) => void;
    let current = true;
    const approve = vi.fn().mockResolvedValue("signed");
    const preparation = new Promise<string>((resolve) => {
      finishPreparation = resolve;
    });
    const attempt = runFencedPaymentSigningApproval({
      approve,
      isCurrent: () => current,
      onRetained: vi.fn(),
      prepare: () => preparation,
      retain: vi.fn(),
      signal: new AbortController().signal
    });

    current = false;
    finishPreparation("unsigned");

    await expect(attempt).resolves.toBe("stale_before_approval");
    expect(approve).not.toHaveBeenCalled();
  });

  it("retains exact approved bytes but fences a callback that became stale during approval", async () => {
    let finishApproval!: (value: Uint8Array) => void;
    const current = true;
    const controller = new AbortController();
    const approvedBytes = Uint8Array.from([1, 2, 3, 4]);
    const approval = new Promise<Uint8Array>((resolve) => {
      finishApproval = resolve;
    });
    const retain = vi.fn((value: Uint8Array) => value);
    const onRetained = vi.fn();
    const attempt = runFencedPaymentSigningApproval({
      approve: () => approval,
      isCurrent: () => current,
      onRetained,
      prepare: async () => "unsigned",
      retain,
      signal: controller.signal
    });
    await vi.waitFor(() => expect(finishApproval).toBeTypeOf("function"));

    controller.abort();
    finishApproval(approvedBytes);

    await expect(attempt).resolves.toBe("retained_stale");
    expect(retain).toHaveBeenCalledWith(approvedBytes);
    expect(retain.mock.calls[0]?.[0]).toBe(approvedBytes);
    expect(onRetained).not.toHaveBeenCalled();
  });
});
