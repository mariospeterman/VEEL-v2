type ResumableVideoIdentity = {
  checksumSha256: string;
  contentId: string;
  fileName: string;
  fileSizeBytes: number;
  mimeType: string;
};

export async function createResumableVideoUploadKey(input: ResumableVideoIdentity): Promise<string> {
  const descriptor = JSON.stringify({
    checksumSha256: input.checksumSha256,
    contentId: input.contentId,
    fileName: input.fileName,
    fileSizeBytes: input.fileSizeBytes,
    mimeType: input.mimeType
  });
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(descriptor));
  const hash = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `wevid-media-upload-v1-${hash}`;
}
