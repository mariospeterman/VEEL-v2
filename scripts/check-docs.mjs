import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const required = [
  "docs/v2-new-build/INDEX.md",
  "docs/v2-new-build/build-plan.md",
  "docs/v2-new-build/full-platform-blueprint.md",
  "docs/v2-new-build/diagrams.md",
  "docs/v2-new-build/route-map.md",
  "docs/v2-new-build/infra-decisions.md",
  "docs/v2-new-build/app-architecture.md",
  "docs/v2-new-build/stack-decision.md",
  "docs/v2-new-build/adr/0001-fastify-supabase-decision.md",
  "docs/v2-new-build/adr/0002-provider-decisions-2026.md",
  "docs/v2-new-build/contracts-and-schema.md",
  "docs/v2-new-build/product/mutuals.md",
  "docs/v2-new-build/product/event-access.md",
  "docs/v2-new-build/compliance/dac7-dac8-vat-system.md",
  "docs/v2-new-build/recommendation-discovery.md",
  "docs/v2-new-build/profile-activity-ranking.md",
  "docs/v2-new-build/compliance/adult-content-compliance.md",
  "docs/v2-new-build/compliance/age-kyc-jurisdictions.md",
  "docs/v2-new-build/frontend/design-system.md",
  "docs/v2-new-build/frontend/component-map.md",
  "docs/v2-new-build/frontend/copy-system.md",
  "docs/v2-new-build/frontend/motion-system.md",
  "docs/v2-new-build/providers/identity-provider-wiring.md",
  "docs/v2-new-build/providers/content-protection.md",
  "docs/v2-new-build/providers/provider-map.md",
  "docs/v2-new-build/ai-mcp-use-cases.md",
  "AGENTS.md",
  "CLAUDE.md",
  ".cursor/rules/veel-v2.mdc",
  "docs/ai-tooling/agent-operating-rules.md",
  ".env.example",
  "packages/contracts/openapi.yaml",
  "packages/database/schema-blueprint.sql"
];

const missing = required.filter((path) => !existsSync(path));

if (missing.length > 0) {
  console.error("Missing required scaffold files:");
  for (const path of missing) {
    console.error(`- ${path}`);
  }
  process.exit(1);
}

const openapi = readFileSync("packages/contracts/openapi.yaml", "utf8");
const routeMap = readFileSync("docs/v2-new-build/route-map.md", "utf8");
const schemaBlueprint = readFileSync("packages/database/schema-blueprint.sql", "utf8");

const normalizePath = (path) =>
  path
    .replace(/\{[^}]+\}/g, ":param")
    .replace(/:[A-Za-z0-9_]+/g, ":param");

const openapiPaths = new Set(
  [...openapi.matchAll(/^  (\/v1\/[^\n:]+):$/gm)].map((match) => normalizePath(match[1])),
);

const routeMapPaths = new Set(
  [...routeMap.matchAll(/\/v1\/[A-Za-z0-9{}:_/-]+/g)]
    .map((match) => match[0])
    .map(normalizePath),
);

const missingFromRouteMap = [...openapiPaths].filter((path) => !routeMapPaths.has(path));
const missingFromOpenapi = [...routeMapPaths].filter((path) => !openapiPaths.has(path));

if (missingFromRouteMap.length > 0 || missingFromOpenapi.length > 0) {
  console.error("OpenAPI and route map path sets differ after dynamic-segment normalization.");
  if (missingFromRouteMap.length > 0) {
    console.error("In OpenAPI but not route map:");
    for (const path of missingFromRouteMap) console.error(`- ${path}`);
  }
  if (missingFromOpenapi.length > 0) {
    console.error("In route map but not OpenAPI:");
    for (const path of missingFromOpenapi) console.error(`- ${path}`);
  }
  process.exit(1);
}

const missingOperationIds = [];
const operationIds = [];
const operationRegex = /^  (\/v1\/[^\n:]+):|^    (get|post|patch|put|delete):|^      operationId:/gm;
let currentPath = null;
let currentMethod = null;
let currentHasOperationId = false;
for (const match of openapi.matchAll(operationRegex)) {
  if (match[1]) {
    if (currentPath && currentMethod && !currentHasOperationId) {
      missingOperationIds.push(`${currentMethod.toUpperCase()} ${currentPath}`);
    }
    currentPath = match[1];
    currentMethod = null;
    currentHasOperationId = false;
  } else if (match[2]) {
    if (currentPath && currentMethod && !currentHasOperationId) {
      missingOperationIds.push(`${currentMethod.toUpperCase()} ${currentPath}`);
    }
    currentMethod = match[2];
    currentHasOperationId = false;
  } else if (currentPath && currentMethod) {
    currentHasOperationId = true;
    const lineStart = openapi.slice(match.index).split("\n", 1)[0];
    const operationId = lineStart.split("operationId:")[1]?.trim();
    if (operationId) operationIds.push(operationId);
  }
}
if (currentPath && currentMethod && !currentHasOperationId) {
  missingOperationIds.push(`${currentMethod.toUpperCase()} ${currentPath}`);
}

if (missingOperationIds.length > 0) {
  console.error("OpenAPI operations missing operationId:");
  for (const operation of missingOperationIds) console.error(`- ${operation}`);
  process.exit(1);
}

const duplicateOperationIds = operationIds.filter((id, index) => operationIds.indexOf(id) !== index);
if (duplicateOperationIds.length > 0) {
  console.error("Duplicate OpenAPI operationId values:");
  for (const id of [...new Set(duplicateOperationIds)]) console.error(`- ${id}`);
  process.exit(1);
}

const docsFiles = [];
const walkDocs = (dir) => {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) walkDocs(full);
    else if (full.endsWith(".md")) docsFiles.push(full);
  }
};
walkDocs("docs/v2-new-build");

const activeDocs = docsFiles.filter((path) => !path.includes("/archive/"));
const activeDocsText = activeDocs.map((path) => readFileSync(path, "utf8")).join("\n\n");

const staleDocPatterns = [
  /\bprototype\b/i,
  /\brebuild\b/i,
  /\bport old\b/i,
  /\bcopy old\b/i,
  /\bproposal\b/i,
  /\bTODO\b/,
  /\bTBD\b/,
  /\bpremium live room\b/i,
  /\bproductType:\s*unlock\b/,
];

for (const pattern of staleDocPatterns) {
  if (pattern.test(activeDocsText)) {
    console.error(`Forbidden stale wording found in active docs: ${pattern}`);
    process.exit(1);
  }
}

const invalidStatuses = [];
for (const file of activeDocs) {
  const text = readFileSync(file, "utf8");
  const statusMatch = text.match(/^Status:\s*(.+)$/m);
  if (!statusMatch || !["accepted", "draft", "archived"].includes(statusMatch[1].trim())) {
    invalidStatuses.push(file);
  }
}
if (invalidStatuses.length > 0) {
  console.error("Active docs missing accepted/draft/archived status:");
  for (const file of invalidStatuses) console.error(`- ${file}`);
  process.exit(1);
}

const docRouteExamples = new Map();
for (const file of activeDocs) {
  const text = readFileSync(file, "utf8");
  for (const match of text.matchAll(/\/v1\/[A-Za-z0-9{}:_/-]+/g)) {
    const normalized = normalizePath(match[0]);
    if (!openapiPaths.has(normalized)) {
      docRouteExamples.set(`${file}:${match[0]}`, normalized);
    }
  }
}
if (docRouteExamples.size > 0) {
  console.error("Active docs contain /v1 route examples missing from OpenAPI:");
  for (const [source] of docRouteExamples) console.error(`- ${source}`);
  process.exit(1);
}

const getSqlEnum = (name) => {
  const match = schemaBlueprint.match(new RegExp(`create type ${name} as enum\\s*\\(([\\s\\S]*?)\\);`, "m"));
  if (!match) return [];
  return [...match[1].matchAll(/'([^']+)'/g)].map((item) => item[1]).sort();
};
const getOpenapiInlineEnum = (schemaName) => {
  const schemaStart = openapi.indexOf(`    ${schemaName}:`);
  if (schemaStart === -1) return [];
  const nextSchema = openapi.slice(schemaStart + 1).search(/\n    [A-Za-z0-9]+:\n/);
  const block = nextSchema === -1 ? openapi.slice(schemaStart) : openapi.slice(schemaStart, schemaStart + 1 + nextSchema);
  const match = block.match(/enum:\s*\[([^\]]+)\]/);
  if (!match) return [];
  return match[1].split(",").map((item) => item.trim()).sort();
};
const getOpenapiSchemaBlock = (schemaName) => {
  const schemaStart = openapi.indexOf(`    ${schemaName}:`);
  if (schemaStart === -1) return "";
  const nextSchema = openapi.slice(schemaStart + 1).search(/\n    [A-Za-z0-9]+:\n/);
  return nextSchema === -1 ? openapi.slice(schemaStart) : openapi.slice(schemaStart, schemaStart + 1 + nextSchema);
};
const assertEnumEqual = (label, left, right) => {
  if (left.join("|") !== right.join("|")) {
    console.error(`${label} enum mismatch.`);
    console.error(`OpenAPI: ${left.join(", ")}`);
    console.error(`SQL: ${right.join(", ")}`);
    process.exit(1);
  }
};
assertEnumEqual("ProductType/payment_product_type", getOpenapiInlineEnum("ProductType"), getSqlEnum("payment_product_type"));
const paymentStateMatch = getOpenapiSchemaBlock("PaymentIntent").match(/state:\s*\{\s*type:\s*string,\s*enum:\s*\[([^\]]+)\]\s*\}/);
if (paymentStateMatch) {
  const paymentState = paymentStateMatch[1].split(",").map((item) => item.trim()).sort();
  assertEnumEqual("PaymentIntent.state/payment_state", paymentState, getSqlEnum("payment_state"));
}

const criticalMethodsMissingRequiredIdempotency = [];
const pathBlocks = [...openapi.matchAll(/^  (\/v1\/[^\n:]+):\n([\s\S]*?)(?=^  \/v1\/|\ncomponents:)/gm)];
for (const [, path, block] of pathBlocks) {
  for (const methodMatch of block.matchAll(/^    (post|patch|put|delete):\n([\s\S]*?)(?=^    (?:get|post|patch|put|delete):|(?![\s\S]))/gm)) {
    const methodBlock = methodMatch[2];
    if (!methodBlock.includes("#/components/parameters/RequiredIdempotencyKey") && !path.includes("/webhooks/")) {
      criticalMethodsMissingRequiredIdempotency.push(`${methodMatch[1].toUpperCase()} ${path}`);
    }
  }
}
if (criticalMethodsMissingRequiredIdempotency.length > 0) {
  console.error("Critical OpenAPI mutations missing RequiredIdempotencyKey:");
  for (const operation of criticalMethodsMissingRequiredIdempotency) console.error(`- ${operation}`);
  process.exit(1);
}

const forbiddenPatterns = [
  /productType:\s*unlock\b/,
  /enum:\s*\[[^\]]*\bunlock\b[^\]]*\]/,
  /\bpremium live room\b/i,
  /\bDrop\b/,
];

for (const pattern of forbiddenPatterns) {
  if (pattern.test(openapi)) {
    console.error(`Forbidden stale contract pattern found: ${pattern}`);
    process.exit(1);
  }
}

console.log("Veel v2 scaffold docs, route map, and OpenAPI checks passed.");
