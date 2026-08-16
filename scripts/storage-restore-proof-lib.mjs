import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, readdir, realpath } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";

export async function compareStorageTrees(sourceInput, restoredInput) {
  const sourceRoot = await validatedRoot(sourceInput, "source");
  const restoredRoot = await validatedRoot(restoredInput, "restored");
  if (sourceRoot === restoredRoot) throw new Error("Storage proof requires two distinct directory trees");

  const [source, restored] = await Promise.all([
    inventory(sourceRoot),
    inventory(restoredRoot)
  ]);
  if (source.length === 0) throw new Error("Storage proof requires at least one source object");

  const mismatches = [];
  const sourceByPath = new Map(source.map((entry) => [entry.path, entry]));
  const restoredByPath = new Map(restored.map((entry) => [entry.path, entry]));

  for (const [path, expected] of sourceByPath) {
    const actual = restoredByPath.get(path);
    if (!actual) mismatches.push("missing_object");
    else if (actual.bytes !== expected.bytes) mismatches.push("size_mismatch");
    else if (actual.sha256 !== expected.sha256) mismatches.push("content_mismatch");
  }
  for (const path of restoredByPath.keys()) {
    if (!sourceByPath.has(path)) mismatches.push("unexpected_object");
  }

  return {
    status: mismatches.length === 0 ? "PASS" : "FAIL",
    source: summarize(source),
    restored: summarize(restored),
    mismatchCounts: Object.fromEntries(
      [...new Set(mismatches)].sort().map((type) => [type, mismatches.filter((item) => item === type).length])
    )
  };
}

async function inventory(root) {
  const entries = [];
  await walk(root, root, entries);
  return entries.sort((a, b) => a.path.localeCompare(b.path));
}

async function walk(root, directory, entries) {
  for (const item of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, item.name);
    const info = await lstat(path);
    if (info.isSymbolicLink()) throw new Error("Storage proof directories must not contain symbolic links");
    if (info.isDirectory()) {
      await walk(root, path, entries);
      continue;
    }
    if (!info.isFile()) throw new Error("Storage proof directories may contain regular files only");
    entries.push({
      path: relative(root, path).split(sep).join("/"),
      bytes: info.size,
      sha256: await fileDigest(path)
    });
  }
}

function summarize(entries) {
  return {
    objectCount: entries.length,
    bytes: entries.reduce((total, entry) => total + entry.bytes, 0),
    inventorySha256: createHash("sha256").update(JSON.stringify(entries)).digest("hex")
  };
}

function fileDigest(path) {
  return new Promise((resolveDigest, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(path);
    stream.on("error", reject);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolveDigest(hash.digest("hex")));
  });
}

async function validatedRoot(input, label) {
  if (!input) throw new Error(`Storage ${label} directory is required`);
  const resolved = await realpath(input);
  const info = await lstat(resolved);
  if (!info.isDirectory()) throw new Error(`Storage ${label} path must be a directory`);
  return resolved;
}
