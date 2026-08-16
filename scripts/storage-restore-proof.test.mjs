import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { compareStorageTrees } from "./storage-restore-proof-lib.mjs";

const roots = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("Supabase Storage restore proof", () => {
  it("proves exact object path, size, and content parity without exposing names", async () => {
    const [source, restored] = await trees();
    await object(source, "private/user-id/video.bin", "original bytes");
    await object(restored, "private/user-id/video.bin", "original bytes");

    const proof = await compareStorageTrees(source, restored);
    expect(proof.status).toBe("PASS");
    expect(proof.source).toEqual(proof.restored);
    expect(JSON.stringify(proof)).not.toContain("user-id");
  });

  it("fails closed on missing, changed, or unexpected restored objects", async () => {
    const [source, restored] = await trees();
    await object(source, "bucket/one.bin", "one");
    await object(source, "bucket/two.bin", "two");
    await object(restored, "bucket/one.bin", "two");
    await object(restored, "bucket/extra.bin", "extra");

    const proof = await compareStorageTrees(source, restored);
    expect(proof.status).toBe("FAIL");
    expect(proof.mismatchCounts).toEqual({
      content_mismatch: 1,
      missing_object: 1,
      unexpected_object: 1
    });
  });

  it("rejects empty source inventories", async () => {
    const [source, restored] = await trees();
    await expect(compareStorageTrees(source, restored)).rejects.toThrow("at least one source object");
  });
});

async function trees() {
  const root = await mkdtemp(join(tmpdir(), "wevid-storage-proof-"));
  roots.push(root);
  const source = join(root, "source");
  const restored = join(root, "restored");
  await Promise.all([mkdir(source), mkdir(restored)]);
  return [source, restored];
}

async function object(root, path, contents) {
  const full = join(root, path);
  await mkdir(join(full, ".."), { recursive: true });
  await writeFile(full, contents);
}
