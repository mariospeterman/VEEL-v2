import { EventEmitter } from "node:events";
import Fastify, { type FastifyInstance } from "fastify";
import { describe, expect, it, vi } from "vitest";
import { createApiShutdownController } from "../src/api-shutdown.js";

describe("API graceful shutdown", () => {
  it("begins close, drains an in-flight request, and runs close hooks once", async () => {
    const app = Fastify({ logger: false });
    const signals = new EventEmitter();
    const entered = deferred<void>();
    const release = deferred<void>();
    const forceExit = vi.fn();
    const setExitCode = vi.fn();
    let closeHookCount = 0;

    app.get("/bounded", async () => {
      entered.resolve(undefined);
      await release.promise;
      return { ok: true };
    });
    app.addHook("onClose", async () => {
      closeHookCount += 1;
    });
    await app.ready();
    const close = vi.spyOn(app, "close");

    const controller = createApiShutdownController(app, {
      signalTarget: signals,
      timeoutMs: 1_000,
      forceExit,
      setExitCode
    });
    controller.installSignalHandlers();
    const responsePromise = app.inject({ method: "GET", url: "/bounded" });

    await entered.promise;
    signals.emit("SIGTERM");
    signals.emit("SIGINT");
    const shutdownPromise = controller.shutdown("SIGTERM");
    await vi.waitFor(() => expect(close).toHaveBeenCalledTimes(1));

    release.resolve(undefined);
    const response = await responsePromise;
    await shutdownPromise;

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true });
    expect(closeHookCount).toBe(1);
    expect(forceExit).not.toHaveBeenCalled();
    expect(setExitCode).not.toHaveBeenCalled();
  });

  it("bounds a stuck close and still invokes close only once across signals", async () => {
    const signals = new EventEmitter();
    const close = vi.fn(() => new Promise<void>(() => undefined));
    const forceExit = vi.fn();
    const setExitCode = vi.fn();
    const app = {
      close,
      log: {
        info: vi.fn(),
        error: vi.fn()
      }
    } as unknown as FastifyInstance;
    const controller = createApiShutdownController(app, {
      signalTarget: signals,
      timeoutMs: 10,
      forceExit,
      setExitCode
    });
    controller.installSignalHandlers();

    signals.emit("SIGTERM");
    signals.emit("SIGINT");
    await controller.shutdown("SIGTERM");

    expect(close).toHaveBeenCalledTimes(1);
    expect(setExitCode).toHaveBeenCalledWith(1);
    expect(forceExit).toHaveBeenCalledWith(1);
  });

  it("records a failed close and exits non-zero", async () => {
    const forceExit = vi.fn();
    const setExitCode = vi.fn();
    const app = {
      close: vi.fn().mockRejectedValue(new Error("close failed")),
      log: {
        info: vi.fn(),
        error: vi.fn()
      }
    } as unknown as FastifyInstance;
    const controller = createApiShutdownController(app, {
      timeoutMs: 1_000,
      forceExit,
      setExitCode
    });

    await controller.shutdown("SIGTERM");

    expect(setExitCode).toHaveBeenCalledWith(1);
    expect(forceExit).toHaveBeenCalledWith(1);
    expect(app.log.error).toHaveBeenCalledOnce();
  });
});

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolver) => {
    resolve = resolver;
  });
  return { promise, resolve };
}
