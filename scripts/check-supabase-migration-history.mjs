#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const supabaseBin = resolve("node_modules/.bin/supabase");
const migrationsDir = resolve("packages/database/migrations");
const linkedProjectRefPath = resolve("supabase/.temp/project-ref");

const resolveDatabaseUrl = () => {
  const databaseUrl =
    process.env.SUPABASE_MIGRATIONS_DB_URL ??
    process.env.SUPABASE_DIRECT_DB_URL;

  if (!databaseUrl) {
    console.error("SUPABASE_MIGRATIONS_DB_URL or SUPABASE_DIRECT_DB_URL is required. Generic application DATABASE_URL is never used for remote migration inspection.");
    process.exit(1);
  }

  let parsed;
  try {
    parsed = new URL(databaseUrl);
  } catch {
    console.error("The configured Supabase database URL is not a valid URL.");
    process.exit(1);
  }

  if (!["postgres:", "postgresql:"].includes(parsed.protocol)) {
    console.error("The configured Supabase database URL must use the postgres/postgresql protocol.");
    process.exit(1);
  }

  if (parsed.hostname.endsWith(".pooler.supabase.com") && parsed.port === "6543") {
    parsed.port = "5432";
    console.warn("Using Supabase session pooler port 5432 for migration history checks.");
    return parsed.toString();
  }

  return databaseUrl;
};

const resolveConnectionArgs = () => {
  if (process.env.SUPABASE_MIGRATIONS_DB_URL || process.env.SUPABASE_DIRECT_DB_URL) {
    return ["--db-url", resolveDatabaseUrl()];
  }

  const projectRef = process.env.SUPABASE_PROJECT_REF;
  if (!projectRef || !process.env.SUPABASE_ACCESS_TOKEN) {
    console.error("Set an explicit Supabase migration URL, or provide SUPABASE_PROJECT_REF and SUPABASE_ACCESS_TOKEN for the linked Management API path.");
    process.exit(1);
  }
  if (!existsSync(linkedProjectRefPath) || readFileSync(linkedProjectRefPath, "utf8").trim() !== projectRef) {
    console.error("The Supabase CLI project is not linked to SUPABASE_PROJECT_REF. Run pnpm supabase:link first.");
    process.exit(1);
  }

  return ["--linked"];
};

const migrations = readdirSync(migrationsDir)
  .filter((fileName) => /^\d+_.+\.sql$/.test(fileName) && !fileName.endsWith(".down.sql"))
  .sort()
  .map((fileName) => {
    readFileSync(resolve(migrationsDir, fileName), "utf8");
    return {
      fileName: fileName.replace(/\.sql$/, ""),
      version: fileName.slice(0, 4),
      description: fileName.replace(/^\d+_/, "").replace(/\.sql$/, "")
    };
  });

if (migrations.length === 0) {
  console.error("No forward migration files found.");
  process.exit(1);
}

const sqlValues = migrations
  .map((migration) => {
    const safe = (value) => value.replaceAll("'", "''");
    return `('${safe(migration.fileName)}', '${safe(migration.version)}', '${safe(migration.description)}')`;
  })
  .join(",");

const query = `
with local_migrations(file_name, version, description) as (
  values ${sqlValues}
),
remote_migrations as (
  select version, name
  from supabase_migrations.schema_migrations
),
local_status as (
  select
    local_migrations.file_name,
    local_migrations.version,
    local_migrations.description,
    version_match.version is not null as sequential_history_present,
    name_match.version as name_matched_remote_version,
    name_match.name as name_matched_remote_name
  from local_migrations
  left join remote_migrations version_match
    on version_match.version = local_migrations.version
  left join lateral (
    select version, name
    from remote_migrations
    where name = local_migrations.file_name
       or name = local_migrations.description
    order by version
    limit 1
  ) name_match on true
),
extra_remote_history as (
  select remote_migrations.version, remote_migrations.name
  from remote_migrations
  left join local_migrations
    on local_migrations.version = remote_migrations.version
  where local_migrations.version is null
)
select json_build_object(
  'local_migration_count', (select count(*) from local_status),
  'sequential_history_count', (select count(*) from local_status where sequential_history_present),
  'missing_sequential_history', coalesce(
    (select json_agg(file_name order by version) from local_status where not sequential_history_present),
    '[]'::json
  ),
  'extra_remote_history', coalesce(
    (select json_agg(json_build_object('version', version, 'name', name) order by version) from extra_remote_history),
    '[]'::json
  ),
  'name_matched_history', coalesce(
    (
      select json_agg(
        json_build_object(
          'file_name', file_name,
          'remote_version', name_matched_remote_version,
          'remote_name', name_matched_remote_name
        )
        order by version
      )
      from local_status
      where name_matched_remote_version is not null
    ),
    '[]'::json
  )
) as migration_history_status;
`;

const connectionArgs = resolveConnectionArgs();
const result = spawnSync(
  supabaseBin,
  ["db", "query", ...connectionArgs, "--output", "json", query],
  {
    encoding: "utf8",
    env: {
      ...process.env,
      PGCONNECT_TIMEOUT: process.env.PGCONNECT_TIMEOUT ?? "10"
    },
    timeout: Number(process.env.SUPABASE_CLI_TIMEOUT_MS ?? 45_000)
  }
);

if (result.error?.name === "TimeoutError" || result.signal === "SIGTERM") {
  console.error("Supabase migration history check timed out.");
  process.exit(124);
}

if (result.status !== 0) {
  console.error("Supabase migration history check failed.");
  if (result.stderr) {
    const redacted = [process.env.SUPABASE_MIGRATIONS_DB_URL, process.env.SUPABASE_DIRECT_DB_URL]
      .filter(Boolean)
      .reduce((message, value) => message.replaceAll(value, "[redacted-db-url]"), result.stderr);
    console.error(redacted);
  }
  process.exit(result.status ?? 1);
}

const jsonStart = result.stdout.indexOf("{");
if (jsonStart === -1) {
  console.error("Supabase migration history check returned unexpected output.");
  process.exit(1);
}

const payload = JSON.parse(result.stdout.slice(jsonStart));
const status = payload.rows[0].migration_history_status;

console.log(JSON.stringify(status, null, 2));

const hasMissing = status.missing_sequential_history.length > 0;
const hasExtra = status.extra_remote_history.length > 0;

if (hasMissing || hasExtra) {
  console.error(
    "Remote Supabase migration history is not normalized to the committed sequential migration versions."
  );
  process.exit(1);
}
