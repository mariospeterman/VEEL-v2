#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { assertDigest, contractsDigest, manifestFingerprint, migrationHead } from "./release-manifest-lib.mjs";

const sourceSha = process.env.RELEASE_SOURCE_SHA;
if (!/^[a-f0-9]{40}$/.test(sourceSha ?? "")) {
  throw new Error("RELEASE_SOURCE_SHA must be a full 40-character Git SHA");
}

const images = {
  api: { repository: process.env.RELEASE_API_IMAGE, digest: process.env.RELEASE_API_DIGEST },
  web: { repository: process.env.RELEASE_WEB_IMAGE, digest: process.env.RELEASE_WEB_DIGEST },
  worker: { repository: process.env.RELEASE_WORKER_IMAGE, digest: process.env.RELEASE_WORKER_DIGEST }
};

for (const [service, image] of Object.entries(images)) {
  if (!image.repository?.trim()) throw new Error(`RELEASE_${service.toUpperCase()}_IMAGE is required`);
  assertDigest(image.digest, `${service} image digest`);
}

const manifest = {
  schemaVersion: 1,
  sourceSha,
  contractsSha256: await contractsDigest(),
  migrationHead: await migrationHead(),
  images
};

const document = { ...manifest, manifestDigest: manifestFingerprint(manifest) };
const output = path.resolve(process.env.RELEASE_MANIFEST_PATH ?? "release/release-manifest.json");
await mkdir(path.dirname(output), { recursive: true });
await writeFile(output, `${JSON.stringify(document, null, 2)}\n`, { mode: 0o644 });
console.log(`Wrote immutable release manifest ${document.manifestDigest} to ${output}`);
