import { describe, expect, it, vi } from "vitest";
import { sha256BlobIncrementally } from "./sha256-blob";
import { sha256File } from "./sha256-file";

describe("bounded SHA-256 file hashing", () => {
  it("matches standard SHA-256 vectors without reading the entire blob", async () => {
    const blob = new TrackingBlob([new TextEncoder().encode("abc")]);
    const progress: number[] = [];

    await expect(sha256BlobIncrementally(blob, {
      chunkSizeBytes: 2,
      onProgress: ({ bytesProcessed }) => progress.push(bytesProcessed)
    })).resolves.toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");

    expect(blob.wholeBlobRead).toBe(false);
    expect(blob.largestSliceBytes).toBeLessThanOrEqual(2);
    expect(progress).toEqual([2, 3]);
  });

  it("hashes an empty blob", async () => {
    await expect(sha256BlobIncrementally(new Blob([]))).resolves.toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
    );
  });

  it("rejects invalid chunk sizes", async () => {
    await expect(sha256BlobIncrementally(new Blob(["x"]), { chunkSizeBytes: 0 })).rejects.toThrow(
      "positive safe integer"
    );
  });

  it("terminates the worker when hashing is cancelled", async () => {
    const worker = new FakeWorker();
    const controller = new AbortController();
    const promise = sha256File(new File(["video"], "video.mp4"), {
      signal: controller.signal,
      workerFactory: () => worker
    });

    controller.abort();

    await expect(promise).rejects.toMatchObject({ name: "AbortError" });
    expect(worker.postMessage).toHaveBeenCalledOnce();
    expect(worker.terminate).toHaveBeenCalledOnce();
  });
});

class TrackingBlob extends Blob {
  largestSliceBytes = 0;
  wholeBlobRead = false;

  override async arrayBuffer(): Promise<ArrayBuffer> {
    this.wholeBlobRead = true;
    throw new Error("The whole blob must not be buffered");
  }

  override slice(start?: number, end?: number, contentType?: string): Blob {
    const normalizedStart = start ?? 0;
    const normalizedEnd = end ?? this.size;
    this.largestSliceBytes = Math.max(this.largestSliceBytes, normalizedEnd - normalizedStart);
    return super.slice(start, end, contentType);
  }
}

class FakeWorker {
  onerror: ((event: ErrorEvent) => void) | null = null;
  onmessage: ((event: MessageEvent<unknown>) => void) | null = null;
  postMessage = vi.fn();
  terminate = vi.fn();
}
