import { createHash } from "node:crypto";

export function localMigrationRecord(fileName, sql) {
  const version = fileName.slice(0, 4);
  const description = fileName.replace(/^\d+_/, "").replace(/\.sql$/, "");
  const statements = normalizeStatements(splitSqlStatements(sql));
  return {
    fileName: fileName.replace(/\.sql$/, ""),
    version,
    description,
    statements,
    statementsDigest: digestStatements(statements)
  };
}

export function classifyMigrationHistory(localMigrations, remoteMigrations, { historyTablePresent = true } = {}) {
  const remoteByVersion = new Map();
  const duplicateRemoteVersions = [];
  for (const remote of remoteMigrations) {
    if (remoteByVersion.has(remote.version)) duplicateRemoteVersions.push(remote.version);
    else remoteByVersion.set(remote.version, remote);
  }

  const localVersions = new Set(localMigrations.map((migration) => migration.version));
  const unknownRemote = remoteMigrations
    .filter((migration) => !localVersions.has(migration.version))
    .map((migration) => ({ version: migration.version, name: migration.name ?? null }));
  const firstPendingIndex = localMigrations.findIndex((migration) => !remoteByVersion.has(migration.version));
  const prefixLength = firstPendingIndex === -1 ? localMigrations.length : firstPendingIndex;
  const appliedPrefix = localMigrations.slice(0, prefixLength);
  const pendingSuffix = localMigrations.slice(prefixLength);
  const holes = pendingSuffix
    .filter((migration) => remoteByVersion.has(migration.version))
    .map((migration) => migration.fileName);
  const nameMismatches = [];
  const changedAppliedMigrations = [];
  const unverifiableAppliedMigrations = [];

  for (const local of appliedPrefix) {
    const remote = remoteByVersion.get(local.version);
    if (!remote) continue;
    if (remote.name !== local.description && remote.name !== local.fileName) {
      nameMismatches.push({
        version: local.version,
        localName: local.description,
        remoteName: remote.name ?? null
      });
    }
    if (!Array.isArray(remote.statements)) {
      unverifiableAppliedMigrations.push(local.fileName);
      continue;
    }
    const remoteDigest = digestStatements(normalizeStatements(remote.statements));
    if (remoteDigest !== local.statementsDigest) {
      changedAppliedMigrations.push(local.fileName);
    }
  }

  const safeToPush = duplicateRemoteVersions.length === 0 && unknownRemote.length === 0 &&
    holes.length === 0 && nameMismatches.length === 0 && changedAppliedMigrations.length === 0 &&
    unverifiableAppliedMigrations.length === 0;
  return {
    classification: !historyTablePresent
      ? "fresh_database"
      : safeToPush
        ? pendingSuffix.length > 0 ? "expected_pending_suffix" : "current"
        : "invalid_history",
    historyTablePresent,
    localMigrationCount: localMigrations.length,
    remoteMigrationCount: remoteMigrations.length,
    appliedPrefix: appliedPrefix.map((migration) => migration.fileName),
    pendingSuffix: pendingSuffix.map((migration) => migration.fileName),
    holes,
    unknownRemote,
    duplicateRemoteVersions: [...new Set(duplicateRemoteVersions)].sort(),
    nameMismatches,
    changedAppliedMigrations,
    unverifiableAppliedMigrations,
    safeToPush
  };
}

export function splitSqlStatements(sql) {
  const statements = [];
  let start = 0;
  let mode = "normal";
  let dollarTag = "";
  let blockDepth = 0;
  let parenDepth = 0;

  for (let index = 0; index < sql.length; index += 1) {
    const char = sql[index];
    const next = sql[index + 1];
    if (mode === "line_comment") {
      if (char === "\n") mode = "normal";
      continue;
    }
    if (mode === "block_comment") {
      if (char === "/" && next === "*") { blockDepth += 1; index += 1; continue; }
      if (char === "*" && next === "/") {
        blockDepth -= 1;
        index += 1;
        if (blockDepth === 0) mode = "normal";
      }
      continue;
    }
    if (mode === "single_quote") {
      if (char === "'" && next === "'") { index += 1; continue; }
      if (char === "'") mode = "normal";
      continue;
    }
    if (mode === "double_quote") {
      if (char === '"' && next === '"') { index += 1; continue; }
      if (char === '"') mode = "normal";
      continue;
    }
    if (mode === "dollar_quote") {
      if (sql.startsWith(dollarTag, index)) {
        index += dollarTag.length - 1;
        mode = "normal";
      }
      continue;
    }

    if (char === "-" && next === "-") { mode = "line_comment"; index += 1; continue; }
    if (char === "/" && next === "*") { mode = "block_comment"; blockDepth = 1; index += 1; continue; }
    if (char === "'") { mode = "single_quote"; continue; }
    if (char === '"') { mode = "double_quote"; continue; }
    if (char === "$") {
      const match = /^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/.exec(sql.slice(index));
      if (match) {
        dollarTag = match[0];
        mode = "dollar_quote";
        index += dollarTag.length - 1;
        continue;
      }
    }
    if (char === "(") parenDepth += 1;
    else if (char === ")" && parenDepth > 0) parenDepth -= 1;
    else if (char === ";" && parenDepth === 0) {
      statements.push(sql.slice(start, index));
      start = index + 1;
    }
  }
  statements.push(sql.slice(start));
  return statements.filter((statement) => canonicalizeSql(statement).length > 0);
}

function normalizeStatements(statements) {
  return statements.map(canonicalizeSql).filter(Boolean);
}

function canonicalizeSql(sql) {
  let output = "";
  let mode = "normal";
  let dollarTag = "";
  let blockDepth = 0;
  let pendingSpace = false;
  const appendNormal = (value) => {
    if (pendingSpace && output.length > 0 && !output.endsWith(" ")) output += " ";
    pendingSpace = false;
    output += value;
  };

  for (let index = 0; index < sql.length; index += 1) {
    const char = sql[index];
    const next = sql[index + 1];
    if (mode === "line_comment") {
      if (char === "\n") { mode = "normal"; pendingSpace = true; }
      continue;
    }
    if (mode === "block_comment") {
      if (char === "/" && next === "*") { blockDepth += 1; index += 1; continue; }
      if (char === "*" && next === "/") {
        blockDepth -= 1;
        index += 1;
        if (blockDepth === 0) { mode = "normal"; pendingSpace = true; }
      }
      continue;
    }
    if (mode === "single_quote") {
      output += char;
      if (char === "'" && next === "'") { output += next; index += 1; continue; }
      if (char === "'") mode = "normal";
      continue;
    }
    if (mode === "double_quote") {
      output += char;
      if (char === '"' && next === '"') { output += next; index += 1; continue; }
      if (char === '"') mode = "normal";
      continue;
    }
    if (mode === "dollar_quote") {
      if (sql.startsWith(dollarTag, index)) {
        output += dollarTag;
        index += dollarTag.length - 1;
        mode = "normal";
      } else output += char;
      continue;
    }

    if (char === "-" && next === "-") { mode = "line_comment"; index += 1; continue; }
    if (char === "/" && next === "*") { mode = "block_comment"; blockDepth = 1; index += 1; continue; }
    if (/\s/.test(char)) { pendingSpace = true; continue; }
    if (char === "'") { appendNormal(char); mode = "single_quote"; continue; }
    if (char === '"') { appendNormal(char); mode = "double_quote"; continue; }
    if (char === "$") {
      const match = /^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/.exec(sql.slice(index));
      if (match) {
        appendNormal(match[0]);
        dollarTag = match[0];
        mode = "dollar_quote";
        index += dollarTag.length - 1;
        continue;
      }
    }
    appendNormal(char);
  }
  return output.trim().replace(/;$/, "").trim();
}

function digestStatements(statements) {
  return createHash("sha256").update(JSON.stringify(statements)).digest("hex");
}
