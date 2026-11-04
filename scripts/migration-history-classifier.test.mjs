import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  classifyMigrationHistory,
  localMigrationRecord,
  splitSqlStatements
} from "./migration-history-classifier.mjs";
import { assertSafeStagingTarget, StagingSafetyError } from "./staging-config.mjs";

const first = localMigrationRecord("0001_first.sql", "create table first (id int primary key);\n");
const second = localMigrationRecord("0002_second.sql", "insert into first values (1);\n");
const third = localMigrationRecord("0003_third.sql", "alter table first add column label text;\n");
const local = [first, second, third];
const applied = (migration) => ({
  version: migration.version,
  name: migration.description,
  statements: migration.statements
});

describe("Supabase migration history classification", () => {
  it("allows a fresh database, a current database, and only a pending suffix", () => {
    expect(classifyMigrationHistory(local, [], { historyTablePresent: false })).toMatchObject({
      classification: "fresh_database",
      appliedPrefix: [],
      pendingSuffix: [first.fileName, second.fileName, third.fileName],
      safeToPush: true
    });
    expect(classifyMigrationHistory(local, local.map(applied))).toMatchObject({
      classification: "current",
      pendingSuffix: [],
      safeToPush: true
    });
    expect(classifyMigrationHistory(local, [applied(first), applied(second)])).toMatchObject({
      classification: "expected_pending_suffix",
      appliedPrefix: [first.fileName, second.fileName],
      pendingSuffix: [third.fileName],
      safeToPush: true
    });
  });

  it("rejects history holes, unknown remote versions, and changed applied SQL", () => {
    expect(classifyMigrationHistory(local, [applied(first), applied(third)])).toMatchObject({
      classification: "invalid_history",
      holes: [third.fileName],
      safeToPush: false
    });
    expect(classifyMigrationHistory(local, [
      applied(first),
      { version: "9999", name: "unknown", statements: ["select 1"] }
    ])).toMatchObject({
      classification: "invalid_history",
      unknownRemote: [{ version: "9999", name: "unknown" }],
      safeToPush: false
    });
    expect(classifyMigrationHistory(local, [{
      ...applied(first),
      statements: ["create table first (id text primary key)"]
    }])).toMatchObject({
      classification: "invalid_history",
      changedAppliedMigrations: [first.fileName],
      safeToPush: false
    });
  });

  it("fails closed when applied statement evidence is absent", () => {
    expect(classifyMigrationHistory(local, [{
      version: first.version,
      name: first.description,
      statements: null
    }])).toMatchObject({
      unverifiableAppliedMigrations: [first.fileName],
      safeToPush: false
    });
  });

  it("splits functions, strings, comments, and nested expressions without false statements", () => {
    const sql = `
      -- lead comment
      create function example() returns void language plpgsql as $$
      begin
        perform ';';
      end;
      $$;
      insert into first values ((1 + 2)); /* trailing ; comment */
    `;
    expect(splitSqlStatements(sql).map((value) => value.trim()).filter(Boolean)).toHaveLength(2);
    expect(localMigrationRecord("0004_function.sql", sql).statements).toHaveLength(2);
  });

  it("rejects a migration connection that targets a different Supabase project", () => {
    const env = {
      DEPLOY_ENV: "staging",
      NODE_ENV: "production",
      SUPABASE_PROJECT_REF: "stageproject",
      SUPABASE_PRODUCTION_PROJECT_REF: "prodproject",
      SUPABASE_URL: "https://stageproject.supabase.co",
      NEXT_PUBLIC_SUPABASE_URL: "https://stageproject.supabase.co",
      SUPABASE_MIGRATIONS_DB_URL: "postgresql://postgres.prodproject:secret@aws-0-eu.pooler.supabase.com:5432/postgres"
    };
    expect(() => assertSafeStagingTarget(env)).toThrow(StagingSafetyError);
    try {
      assertSafeStagingTarget(env);
    } catch (error) {
      expect(error.publicReasons).toContain("SUPABASE_MIGRATIONS_DB_URL=staging_project_ref");
    }
  });

  it("lets staging inherit .env.staging without requiring a separate .env file", () => {
    const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
    expect(packageJson.scripts["staging:migrations:plan"]).toContain("--env-file-if-exists=.env.staging");
    expect(packageJson.scripts["staging:migrations:apply"]).toContain("--env-file-if-exists=.env.staging");
    for (const script of ["supabase:history:check", "supabase:push:dry", "supabase:push"]) {
      expect(packageJson.scripts[script]).toContain("--env-file-if-exists=.env");
      expect(packageJson.scripts[script]).not.toContain("--env-file=.env");
    }
  });
});
