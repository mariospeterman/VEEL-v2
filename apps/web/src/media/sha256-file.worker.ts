import { sha256BlobIncrementally } from "./sha256-blob";

type HashRequest = { file: File };
type HashResponse =
  | { type: "progress"; bytesProcessed: number; totalBytes: number }
  | { type: "complete"; checksumSha256: string }
  | { type: "error"; message: string };

const workerScope = globalThis as unknown as {
  onmessage: ((event: MessageEvent<HashRequest>) => void) | null;
  postMessage(message: HashResponse): void;
};

workerScope.onmessage = (event) => {
  void hashFile(event.data.file);
};

async function hashFile(file: File): Promise<void> {
  try {
    let lastReportedPercent = -1;
    const checksumSha256 = await sha256BlobIncrementally(file, {
      onProgress(progress) {
        const percent = progress.totalBytes === 0
          ? 100
          : Math.floor((progress.bytesProcessed / progress.totalBytes) * 100);
        if (percent === lastReportedPercent) return;
        lastReportedPercent = percent;
        workerScope.postMessage({ type: "progress", ...progress });
      }
    });
    workerScope.postMessage({ type: "complete", checksumSha256 });
  } catch (error) {
    workerScope.postMessage({
      type: "error",
      message: error instanceof Error ? error.message : "Unable to checksum the selected file"
    });
  }
}
