#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import path from "node:path";
import { assertDigest, contractsDigest, manifestFingerprint, migrationHead } from "./release-manifest-lib.mjs";

const input = path.resolve(process.env.RELEASE_MANIFEST_PATH ?? process.argv[2] ?? "release/release-manifest.json");
const document = JSON.parse(await readFile(input, "utf8"));
const { manifestDigest, ...manifest } = document;

if (manifest.schemaVersion !== 1 || !/^[a-f0-9]{40}$/.test(manifest.sourceSha ?? "")) {
  throw new Error("Release manifest has an unsupported schema or invalid source SHA");
}
for (const [service, image] of Object.entries(manifest.images ?? {})) {
  if (!image.repository) throw new Error(`${service} image repository is missing`);
  assertDigest(image.digest, `${service} image digest`);
}
if (Object.keys(manifest.images ?? {}).sort().join(",") !== "api,web,worker") {
  throw new Error("Release manifest must pin exactly api, web, and worker images");
}
if (manifestDigest !== manifestFingerprint(manifest)) throw new Error("Release manifest fingerprint does not match");
if (process.env.RELEASE_VERIFY_SOURCE === "true") {
  if (manifest.contractsSha256 !== await contractsDigest()) throw new Error("Contract digest differs from this checkout");
  if (manifest.migrationHead !== await migrationHead()) throw new Error("Migration head differs from this checkout");
}
if (process.env.RELEASE_EXPECTED_SHA && manifest.sourceSha !== process.env.RELEASE_EXPECTED_SHA) {
  throw new Error("Release manifest source SHA does not match RELEASE_EXPECTED_SHA");
}
console.log(`Verified release manifest ${manifestDigest} from ${input}`);
