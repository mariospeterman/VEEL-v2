#!/usr/bin/env node
import { readFileSync } from "node:fs";
import postgres from "postgres";
import { bridgeTargets } from "./legacy-migration-bridge.mjs";

const bridgeSqlUrl = new URL(
  "../packages/database/pre-upgrade/legacy-check-constraint-bridge.sql",
  import.meta.url
);
const applyRequested = process.argv.includes("--apply");
const databaseUrl =
  process.env.SUPABASE_MIGRATIONS_DB_URL ?? process.env.SUPABASE_DIRECT_DB_URL;

if (!databaseUrl) {
  fail(
    "SUPABASE_MIGRATIONS_DB_URL or SUPABASE_DIRECT_DB_URL is required; application DATABASE_URL is never used."
  );
}
assertPostgresUrl(databaseUrl);

if (
  applyRequested &&
  process.env.WEVID_LEGACY_MIGRATION_BRIDGE_APPROVAL !== "DB06_REVIEWED"
) {
  fail(
    "Set WEVID_LEGACY_MIGRATION_BRIDGE_APPROVAL=DB06_REVIEWED only after reviewing the target and backup/restore plan."
  );
}

const sql = postgres(databaseUrl, {
  max: 1,
  idle_timeout: 5,
  connect_timeout: Number(process.env.PGCONNECT_TIMEOUT ?? 10),
  prepare: false
});

try {
  const before = await inspectBridgeTargets(sql);
  const plannedTargets = bridgeTargets(before);

  if (applyRequested && plannedTargets.length > 0) {
    const bridgeSql = readFileSync(bridgeSqlUrl, "utf8");
    await sql.begin(async (transaction) => {
      await transaction.unsafe(bridgeSql);
    });
  }

  const after = applyRequested ? await inspectBridgeTargets(sql) : before;
  const remainingTargets = bridgeTargets(after);
  const result = {
    mode: applyRequested ? "apply" : "inspect",
    plannedTargets,
    remainingTargets,
    bridgeRequired: remainingTargets.length > 0,
    nextAction: applyRequested
      ? remainingTargets.length === 0
        ? "run_the_immutable_pending_migrations_and_populated_upgrade_tests"
        : "stop_and_review_unexpected_constraint_state"
      : plannedTargets.length === 0
        ? "no_legacy_constraint_bridge_required"
        : "review_backup_restore_plan_then_rerun_with_--apply_and_explicit_approval"
  };
  console.log(JSON.stringify(result, null, 2));
  if (applyRequested && remainingTargets.length > 0) process.exitCode = 1;
} finally {
  await sql.end({ timeout: 5 });
}

async function inspectBridgeTargets(sqlClient) {
  return sqlClient`
    select
      rel.relname as table_name,
      con.conname as constraint_name,
      pg_get_constraintdef(con.oid) as definition
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    join pg_namespace nsp on nsp.oid = rel.relnamespace
    where nsp.nspname = 'public'
      and con.contype = 'c'
      and (
        (rel.relname = 'reports' and pg_get_constraintdef(con.oid) like '%state%')
        or (
          rel.relname in ('ticket_purchase_requests', 'event_access_purchase_requests')
          and pg_get_constraintdef(con.oid) like '%state%'
        )
        or (
          rel.relname = 'viewer_feed_preferences'
          and pg_get_constraintdef(con.oid) like '%nsfw_preference%'
        )
      )
    order by rel.relname, con.conname
  `;
}

function assertPostgresUrl(value) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    fail("The configured migration database URL is invalid.");
  }
  if (!parsed || !["postgres:", "postgresql:"].includes(parsed.protocol)) {
    fail("The configured migration database URL must use postgres/postgresql.");
  }
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
