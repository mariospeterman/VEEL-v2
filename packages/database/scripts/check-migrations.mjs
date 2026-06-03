import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const migrationsDir = join(packageRoot, "migrations");
const requiredFoundationTables = [
  "users",
  "profiles",
  "staff_memberships",
  "staff_permissions",
  "provider_events",
  "provider_webhook_receipts",
  "idempotency_keys",
  "audit_events"
];

if (!existsSync(migrationsDir)) {
  console.error(`Missing migrations directory: ${migrationsDir}`);
  process.exit(1);
}

const files = readdirSync(migrationsDir).filter((file) => file.endsWith(".sql")).sort();
const upFiles = files.filter((file) => !file.endsWith(".down.sql"));
const downFiles = new Set(files.filter((file) => file.endsWith(".down.sql")));

if (upFiles.length === 0) {
  console.error("No database migrations found.");
  process.exit(1);
}

for (const upFile of upFiles) {
  const downFile = upFile.replace(/\.sql$/, ".down.sql");
  if (!downFiles.has(downFile)) {
    console.error(`Missing rollback migration for ${upFile}: expected ${downFile}`);
    process.exit(1);
  }
}

const foundationPath = join(migrationsDir, "0001_foundation.sql");
const foundationDownPath = join(migrationsDir, "0001_foundation.down.sql");
const foundationSql = readFileSync(foundationPath, "utf8");
const foundationDownSql = readFileSync(foundationDownPath, "utf8");

for (const table of requiredFoundationTables) {
  if (!foundationSql.includes(`create table ${table} (`)) {
    console.error(`Foundation migration missing table: ${table}`);
    process.exit(1);
  }
  if (!foundationDownSql.includes(`drop table if exists ${table};`)) {
    console.error(`Foundation rollback missing table drop: ${table}`);
    process.exit(1);
  }
}

const forbiddenPatterns = [
  /\braw_payload\b/i,
  /\bservice_role\b/i,
  /\bsecret\b/i,
  /\bprivate_key\b/i
];

for (const file of files) {
  const sql = readFileSync(join(migrationsDir, file), "utf8");
  for (const pattern of forbiddenPatterns) {
    if (pattern.test(sql)) {
      console.error(`Forbidden migration pattern ${pattern} found in ${basename(file)}`);
      process.exit(1);
    }
  }
}

if (!/create unique index|unique \(/i.test(foundationSql)) {
  console.error("Foundation migration must include uniqueness constraints.");
  process.exit(1);
}

if (!/create index audit_events_/i.test(foundationSql)) {
  console.error("Foundation migration must index audit event lookups.");
  process.exit(1);
}

console.log("Database migration checks passed.");
