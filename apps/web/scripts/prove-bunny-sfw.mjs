#!/usr/bin/env node

import { readFile, stat } from "node:fs/promises";
import process from "node:process";
import * as tus from "tus-js-client";
import { createBunnyStreamUploadAdapter } from "../../api/src/modules/content/media-upload-adapter.ts";

const apiKey = required("BUNNY_STREAM_API_KEY");
const libraryId = required("BUNNY_STREAM_LIBRARY_ID");
const proofPath = required("BUNNY_PROOF_VIDEO_PATH");
const fileInfo = await stat(proofPath);
if (!fileInfo.isFile() || fileInfo.size === 0) throw new Error("BUNNY_PROOF_VIDEO_PATH must be a non-empty video file");
if (fileInfo.size > 250 * 1024 * 1024) throw new Error("BUNNY_PROOF_VIDEO_PATH must be 250 MiB or smaller");

const provider = createBunnyStreamUploadAdapter({
  BUNNY_STREAM_API_KEY: apiKey,
  BUNNY_STREAM_LIBRARY_ID: libraryId
});
const session = await provider.createUploadSession({
  contentId: "staging-sfw-provider-proof",
  title: `wevid-staging-sfw-proof-${new Date().toISOString()}`,
  mimeType: "video/mp4"
});
const videoId = session.providerAssetId;
const bytes = await readFile(proofPath);

await new Promise((resolve, reject) => {
  const upload = new tus.Upload(bytes, {
    endpoint: session.uploadUrl,
    headers: session.headers,
    metadata: { filename: proofPath.split("/").at(-1) ?? "proof-video" },
    uploadSize: bytes.byteLength,
    retryDelays: [0, 3000, 5000, 10000],
    removeFingerprintOnSuccess: true,
    onError: reject,
    onSuccess: resolve
  });
  upload.start();
});

const deadline = Date.now() + 15 * 60 * 1000;
let playData;
while (Date.now() < deadline) {
  playData = await provider.getPlaybackData?.({ providerAssetId: videoId });
  if (playData?.providerPlayable === true && typeof playData.playbackUrl === "string") break;
  await new Promise((resolve) => setTimeout(resolve, 10_000));
}

const playable = playData?.providerPlayable === true && typeof playData?.playbackUrl === "string";
console.log(JSON.stringify({
  proof: "bunny-sfw-create-tus-playability",
  videoId,
  bytes: bytes.byteLength,
  playable,
  playlistReturned: typeof playData?.playbackUrl === "string",
  checkedAt: new Date().toISOString(),
  cleanupRequired: true
}, null, 2));

if (!playable) process.exitCode = 1;

function required(key) {
  const value = process.env[key];
  if (!value) throw new Error(`${key} is required`);
  return value;
}
