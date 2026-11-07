import type { FastifyInstance } from "fastify";

type ShutdownSignal = "SIGINT" | "SIGTERM";

interface SignalTarget {
  on(signal: ShutdownSignal, listener: () => void): unknown;
  off(signal: ShutdownSignal, listener: () => void): unknown;
}

interface ApiShutdownOptions {
  timeoutMs?: number;
  signalTarget?: SignalTarget;
  setExitCode?: (code: number) => void;
  forceExit?: (code: number) => void;
}

export interface ApiShutdownController {
  shutdown(signal: ShutdownSignal): Promise<void>;
  installSignalHandlers(): () => void;
}

const defaultShutdownTimeoutMs = 10_000;

export function createApiShutdownController(
  app: FastifyInstance,
  options: ApiShutdownOptions = {}
): ApiShutdownController {
  const timeoutMs = options.timeoutMs ?? defaultShutdownTimeoutMs;
  const signalTarget = options.signalTarget ?? process;
  const setExitCode = options.setExitCode ?? ((code: number) => {
    process.exitCode = code;
  });
  const forceExit = options.forceExit ?? ((code: number) => {
    process.exit(code);
  });
  let shutdownPromise: Promise<void> | null = null;
  let removeSignalHandlers: (() => void) | null = null;

  const shutdown = (signal: ShutdownSignal): Promise<void> => {
    if (shutdownPromise) return shutdownPromise;

    app.log.info({ signal, timeoutMs }, "API graceful shutdown started");
    shutdownPromise = new Promise<void>((resolve) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        setExitCode(1);
        app.log.error({ signal, timeoutMs }, "API graceful shutdown timed out");
        forceExit(1);
        resolve();
      }, timeoutMs);
      timer.unref();

      void Promise.resolve()
        .then(() => app.close())
        .then(() => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          removeSignalHandlers?.();
          app.log.info({ signal }, "API graceful shutdown completed");
          resolve();
        })
        .catch((error: unknown) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          removeSignalHandlers?.();
          setExitCode(1);
          app.log.error({ signal, error }, "API graceful shutdown failed");
          forceExit(1);
          resolve();
        });
    });

    return shutdownPromise;
  };

  const installSignalHandlers = (): (() => void) => {
    if (removeSignalHandlers) return removeSignalHandlers;

    const onSigterm = () => void shutdown("SIGTERM");
    const onSigint = () => void shutdown("SIGINT");
    let installed = true;

    signalTarget.on("SIGTERM", onSigterm);
    signalTarget.on("SIGINT", onSigint);
    removeSignalHandlers = () => {
      if (!installed) return;
      installed = false;
      signalTarget.off("SIGTERM", onSigterm);
      signalTarget.off("SIGINT", onSigint);
    };

    return removeSignalHandlers;
  };

  return { shutdown, installSignalHandlers };
}
