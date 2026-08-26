import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createWebDependencyFingerprint, prepareWebDevelopmentCache } from "./prepare-development.mjs";

const temporaryDirectories = [];

async function createRepo(lockfile = "lockfileVersion: '9.0'\n") {
  const repoRoot = await mkdtemp(join(tmpdir(), "veel-dev-cache-"));
  temporaryDirectories.push(repoRoot);
  await mkdir(join(repoRoot, "apps/web/.next"), { recursive: true });
  await writeFile(join(repoRoot, "pnpm-lock.yaml"), lockfile, "utf8");
  return repoRoot;
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("web development dependency cache", () => {
  it("keeps compatible Next.js output across normal restarts", async () => {
    const repoRoot = await createRepo();
    const runtime = { repoRoot, nodeVersion: "v22.16.0", platform: "darwin", architecture: "arm64" };

    await prepareWebDevelopmentCache(runtime);
    await writeFile(join(repoRoot, "apps/web/.next/current-chunk.js"), "compatible", "utf8");

    await expect(prepareWebDevelopmentCache(runtime)).resolves.toMatchObject({ invalidated: false });
    await expect(readFile(join(repoRoot, "apps/web/.next/current-chunk.js"), "utf8")).resolves.toBe("compatible");
  });

  it("removes stale Next.js chunks when the lockfile changes", async () => {
    const repoRoot = await createRepo();
    const runtime = { repoRoot, nodeVersion: "v22.16.0", platform: "darwin", architecture: "arm64" };

    await prepareWebDevelopmentCache(runtime);
    await writeFile(join(repoRoot, "apps/web/.next/stale-chunk.js"), "next-16.3.0", "utf8");
    await writeFile(join(repoRoot, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\nnext: 16.3.2\n", "utf8");

    await expect(prepareWebDevelopmentCache(runtime)).resolves.toMatchObject({ invalidated: true });
    await expect(readFile(join(repoRoot, "apps/web/.next/stale-chunk.js"), "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("includes the Node runtime and host architecture in the fingerprint", () => {
    const base = { lockfile: "same", nodeVersion: "v22.16.0", platform: "darwin", architecture: "arm64" };

    expect(createWebDependencyFingerprint(base)).not.toBe(
      createWebDependencyFingerprint({ ...base, nodeVersion: "v22.17.0" })
    );
    expect(createWebDependencyFingerprint(base)).not.toBe(
      createWebDependencyFingerprint({ ...base, architecture: "x64" })
    );
  });
});
