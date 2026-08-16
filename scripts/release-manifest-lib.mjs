import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

const sha256 = (value) => createHash("sha256").update(value).digest("hex");

export async function contractsDigest(root = process.cwd()) {
  return sha256(await readFile(path.join(root, "packages/contracts/openapi.yaml")));
}

export async function migrationHead(root = process.cwd()) {
  const migrationDirectory = path.join(root, "packages/database/migrations");
  const migrations = (await readdir(migrationDirectory)).filter((name) => name.endsWith(".sql")).sort();
  if (migrations.length === 0) throw new Error("No database migrations found");
  return migrations.at(-1);
}

export function assertDigest(value, label) {
  if (!/^sha256:[a-f0-9]{64}$/.test(value ?? "")) {
    throw new Error(`${label} must be an immutable sha256 digest`);
  }
}

export function manifestFingerprint(manifest) {
  return `sha256:${sha256(JSON.stringify(manifest))}`;
}
