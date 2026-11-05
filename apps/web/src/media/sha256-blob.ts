import { sha256 } from "@noble/hashes/sha2";

export const sha256ChunkSizeBytes = 4 * 1024 * 1024;

export interface Sha256Progress {
  bytesProcessed: number;
  totalBytes: number;
}

export async function sha256BlobIncrementally(
  blob: Blob,
  options: {
    chunkSizeBytes?: number;
    onProgress?: (progress: Sha256Progress) => void;
  } = {}
): Promise<string> {
  const chunkSizeBytes = options.chunkSizeBytes ?? sha256ChunkSizeBytes;
  if (!Number.isSafeInteger(chunkSizeBytes) || chunkSizeBytes < 1) {
    throw new TypeError("SHA-256 chunk size must be a positive safe integer");
  }

  const hasher = sha256.create();
  try {
    for (let offset = 0; offset < blob.size; offset += chunkSizeBytes) {
      const end = Math.min(blob.size, offset + chunkSizeBytes);
      const chunk = await blob.slice(offset, end).arrayBuffer();
      hasher.update(new Uint8Array(chunk));
      options.onProgress?.({ bytesProcessed: end, totalBytes: blob.size });
    }
    return toHex(hasher.digest());
  } finally {
    hasher.destroy();
  }
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}
