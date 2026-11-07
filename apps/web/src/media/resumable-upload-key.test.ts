import { describe, expect, it } from "vitest";
import { createResumableVideoUploadKey } from "./resumable-upload-key";

const upload = {
  checksumSha256: "a".repeat(64),
  contentId: "0f7216f4-91d2-4f9b-a610-2e25aacc8e10",
  fileName: "video.mp4",
  fileSizeBytes: 1024,
  mimeType: "video/mp4"
};

describe("resumable upload identity", () => {
  it("is stable for the same backend-owned upload operation", async () => {
    await expect(createResumableVideoUploadKey(upload)).resolves.toBe(
      await createResumableVideoUploadKey({ ...upload })
    );
  });

  it("does not reuse an operation after file identity changes", async () => {
    await expect(createResumableVideoUploadKey(upload)).resolves.not.toBe(
      await createResumableVideoUploadKey({ ...upload, fileName: "different.mp4" })
    );
  });
});
