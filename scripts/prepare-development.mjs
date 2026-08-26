import { createHash } from "node:crypto";
import { access, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

const markerName = ".veel-dependency-fingerprint";

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export function createWebDependencyFingerprint({ lockfile, nodeVersion, platform, architecture }) {
  return createHash("sha256")
    .update(lockfile)
    .update("\0")
    .update(nodeVersion)
    .update("\0")
    .update(platform)
    .update("\0")
    .update(architecture)
    .digest("hex");
}

export async function prepareWebDevelopmentCache({
  repoRoot,
  nodeVersion = process.version,
  platform = process.platform,
  architecture = process.arch
}) {
  const nextDirectory = join(repoRoot, "apps/web/.next");
  const markerPath = join(nextDirectory, markerName);
  const lockfile = await readFile(join(repoRoot, "pnpm-lock.yaml"), "utf8");
  const fingerprint = createWebDependencyFingerprint({ lockfile, nodeVersion, platform, architecture });

  let previousFingerprint = null;
  try {
    previousFingerprint = (await readFile(markerPath, "utf8")).trim();
  } catch {
    // A missing marker means the output may have been produced by another dependency graph.
  }

  if (previousFingerprint === fingerprint) return { invalidated: false, fingerprint };

  const invalidated = await exists(nextDirectory);
  await rm(nextDirectory, { recursive: true, force: true });
  await mkdir(nextDirectory, { recursive: true });
  await writeFile(markerPath, `${fingerprint}\n`, "utf8");

  return { invalidated, fingerprint };
}
