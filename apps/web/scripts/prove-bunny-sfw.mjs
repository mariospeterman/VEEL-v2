#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import process from "node:process";
import * as tus from "tus-js-client";

const apiKey = required("BUNNY_STREAM_API_KEY");
const libraryId = required("BUNNY_STREAM_LIBRARY_ID");
const proofPath = required("BUNNY_PROOF_VIDEO_PATH");
const fileInfo = await stat(proofPath);
if (!fileInfo.isFile() || fileInfo.size === 0) throw new Error("BUNNY_PROOF_VIDEO_PATH must be a non-empty video file");
if (fileInfo.size > 250 * 1024 * 1024) throw new Error("BUNNY_PROOF_VIDEO_PATH must be 250 MiB or smaller");

const created = await providerJson(`https://video.bunnycdn.com/library/${libraryId}/videos`, {
  method: "POST",
  headers: { Accept: "application/json", "Content-Type": "application/json", AccessKey: apiKey },
  body: JSON.stringify({ title: `wevid-staging-sfw-proof-${new Date().toISOString()}` })
});
const videoId = typeof created.guid === "string" ? created.guid : null;
if (!videoId) throw new Error("Bunny did not return a video id");

const expiration = Math.floor(Date.now() / 1000) + 60 * 60;
const signatureInput = `${libraryId}${apiKey}${expiration}${videoId}`;
// Bunny's protocol mandates this ephemeral TUS authorization digest; it is not a stored password hash.
// codeql[js/insufficient-password-hash]
const signature = createHash("sha256").update(signatureInput).digest("hex");
const bytes = await readFile(proofPath);

await new Promise((resolve, reject) => {
  const upload = new tus.Upload(bytes, {
    endpoint: "https://video.bunnycdn.com/tusupload",
    headers: {
      AuthorizationSignature: signature,
      AuthorizationExpire: String(expiration),
      LibraryId: libraryId,
      VideoId: videoId
    },
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
  playData = await providerJson(`https://video.bunnycdn.com/library/${libraryId}/videos/${videoId}/play`, {
    headers: { Accept: "application/json", AccessKey: apiKey }
  });
  if (playData.isPlayable === true && typeof playData.videoPlaylistUrl === "string") break;
  await new Promise((resolve) => setTimeout(resolve, 10_000));
}

const playable = playData?.isPlayable === true && typeof playData?.videoPlaylistUrl === "string";
console.log(JSON.stringify({
  proof: "bunny-sfw-create-tus-playability",
  videoId,
  bytes: bytes.byteLength,
  playable,
  playlistReturned: typeof playData?.videoPlaylistUrl === "string",
  checkedAt: new Date().toISOString(),
  cleanupRequired: true
}, null, 2));

if (!playable) process.exitCode = 1;

async function providerJson(url, init) {
  const response = await fetch(url, init);
  if (!response.ok) throw new Error(`Bunny proof request failed with HTTP ${response.status}`);
  return response.json();
}

function required(key) {
  const value = process.env[key];
  if (!value) throw new Error(`${key} is required`);
  return value;
}
