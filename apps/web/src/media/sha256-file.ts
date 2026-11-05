import type { Sha256Progress } from "./sha256-blob";

type HashWorkerResponse =
  | { type: "progress"; bytesProcessed: number; totalBytes: number }
  | { type: "complete"; checksumSha256: string }
  | { type: "error"; message: string };

interface HashWorker {
  onerror: ((event: ErrorEvent) => void) | null;
  onmessage: ((event: MessageEvent<HashWorkerResponse>) => void) | null;
  postMessage(message: { file: File }): void;
  terminate(): void;
}

export interface Sha256FileOptions {
  signal?: AbortSignal;
  onProgress?: (progress: Sha256Progress) => void;
  workerFactory?: () => HashWorker;
}

export function sha256File(file: File, options: Sha256FileOptions = {}): Promise<string> {
  if (options.signal?.aborted) return Promise.reject(abortError());

  return new Promise((resolve, reject) => {
    const worker: HashWorker = options.workerFactory?.() ?? new Worker(
      new URL("./sha256-file.worker.ts", import.meta.url),
      { type: "module" }
    );
    let settled = false;

    const settle = (result: { checksum: string } | { error: Error }) => {
      if (settled) return;
      settled = true;
      options.signal?.removeEventListener("abort", onAbort);
      worker.terminate();
      if ("error" in result) reject(result.error);
      else resolve(result.checksum);
    };
    const onAbort = () => settle({ error: abortError() });

    worker.onerror = () => settle({ error: new Error("Unable to start the bounded file checksum worker") });
    worker.onmessage = (event) => {
      if (event.data.type === "progress") {
        options.onProgress?.({
          bytesProcessed: event.data.bytesProcessed,
          totalBytes: event.data.totalBytes
        });
      } else if (event.data.type === "complete") {
        settle({ checksum: event.data.checksumSha256 });
      } else {
        settle({ error: new Error(event.data.message) });
      }
    };
    options.signal?.addEventListener("abort", onAbort, { once: true });
    worker.postMessage({ file });
  });
}

function abortError(): DOMException {
  return new DOMException("File checksum cancelled", "AbortError");
}
