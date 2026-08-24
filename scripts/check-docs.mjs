import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

const required = [
  "docs/v2-new-build/INDEX.md",
  "docs/v2-new-build/build-plan.md",
  "docs/v2-new-build/full-platform-blueprint.md",
  "docs/v2-new-build/diagrams.md",
  "docs/v2-new-build/route-map.md",
  "docs/v2-new-build/infra-decisions.md",
  "docs/v2-new-build/app-architecture.md",
  "docs/v2-new-build/stack-decision.md",
  "docs/v2-new-build/current-implementation-status.md",
  "docs/v2-new-build/production-status.json",
  "docs/v2-new-build/slice-workflow.md",
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
  "docs/v2-new-build/mcp-staging-proof.md",
  "AGENTS.md",
  "CLAUDE.md",
  ".cursor/rules/veel-v2.mdc",
  "docs/ai-tooling/agent-operating-rules.md",
  ".agents/skills/wevid-production-loop/SKILL.md",
  ".agents/skills/wevid-production-loop/agents/openai.yaml",
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
const buildPlan = readFileSync("docs/v2-new-build/build-plan.md", "utf8");
const agentsRouter = readFileSync("AGENTS.md", "utf8");
const implementationStatus = readFileSync(
  "docs/v2-new-build/current-implementation-status.md",
  "utf8",
);
const sliceWorkflow = readFileSync("docs/v2-new-build/slice-workflow.md", "utf8");
const index = readFileSync("docs/v2-new-build/INDEX.md", "utf8");
const productionStatus = JSON.parse(
  readFileSync("docs/v2-new-build/production-status.json", "utf8"),
);

const walkTestRequirements = [
  ["AGENTS production-loop skill", agentsRouter, "$wevid-production-loop"],
  ["AGENTS current-state route", agentsRouter, "docs/v2-new-build/current-implementation-status.md"],
  ["AGENTS build-plan route", agentsRouter, "docs/v2-new-build/build-plan.md"],
  ["AGENTS slice-workflow route", agentsRouter, "docs/v2-new-build/slice-workflow.md"],
  ["status merged baseline", implementationStatus, "| Latest merged baseline |"],
  ["status merged slice", implementationStatus, "| Latest merged slice |"],
  ["status merged migration", implementationStatus, "| Latest merged migration |"],
  ["status merged evidence", implementationStatus, "| Latest merged evidence |"],
  ["status blockers", implementationStatus, "| Known launch blockers |"],
  ["status next slice", implementationStatus, "| Next planned slice |"],
  ["status provider-blocked state", implementationStatus, "CODE_COMPLETE_PROVIDER_BLOCKED"],
  ["workflow walk test", sliceWorkflow, "### Five-Minute Walk Test"],
  ["workflow active mutex", sliceWorkflow, "wevid-active-slice"],
  ["workflow protected main", sliceWorkflow, "protected `main`"],
];

for (const [label, source, expected] of walkTestRequirements) {
  if (!source.includes(expected)) {
    console.error(`Production walk test failed: missing ${label} (${expected}).`);
    process.exit(1);
  }
}

const canonicalSlices = new Set(
  [
    ...buildPlan.matchAll(
      /^\| ((?:[0-9]{2}[A-Z]?)|(?:Convergence [0-9]{2})) \| ([^|]+) \|/gm,
    ),
  ].map(([, sliceId, goal]) =>
    `${sliceId.startsWith("Convergence ") ? sliceId : `Launch ${sliceId}`} — ${goal.trim()}`,
  ),
);
const nextSlice = productionStatus.nextPlannedSlice;
if (nextSlice !== null && (typeof nextSlice !== "string" || !canonicalSlices.has(nextSlice))) {
  console.error(
    `Production walk test failed: next planned slice is not in build-plan.md (${nextSlice ?? "missing"}).`,
  );
  process.exit(1);
}

const nextSliceMarker = nextSlice
  ? `Next planned production slice: **${nextSlice}**.`
  : "No further production code slice is planned; only external launch gates remain.";
for (const [label, source] of [
  ["INDEX.md", index],
  ["build-plan.md", buildPlan],
  ["current-implementation-status.md", implementationStatus],
]) {
  if (!source.includes(nextSliceMarker)) {
    console.error(`Production status drift: ${label} does not agree on ${nextSlice}.`);
    process.exit(1);
  }
}

if (/^\| (?:Active slice|Branch|Pull request|State) \|/m.test(implementationStatus) || /Active on (?:draft )?PR #\d+/i.test(buildPlan)) {
  console.error("Production status drift: protected-main docs contain transient active-PR truth.");
  process.exit(1);
}

const readinessVocabulary = new Set([
  "DESIGNED",
  "CODE_COMPLETE",
  "UNIT_TESTED",
  "REAL_POSTGRES_PROVEN",
  "BROWSER_PROVEN",
  "STAGING_PROVEN",
  "PROVIDER_APPROVED",
  "LEGAL_APPROVED",
  "OPERATIONS_APPROVED",
  "LAUNCH_ENABLED",
]);
for (const state of [
  ...(productionStatus.latestMergedEvidenceStates ?? []),
  ...(productionStatus.outstandingLaunchGates ?? []),
]) {
  if (!readinessVocabulary.has(state)) {
    console.error(`Production status drift: unsupported readiness state ${state}.`);
    process.exit(1);
  }
}

if (!/^[0-9a-f]{40}$/.test(productionStatus.latestMergedBaseline ?? "")) {
  console.error("Production status drift: latestMergedBaseline must be a full commit SHA.");
  process.exit(1);
}

try {
  execFileSync("git", ["merge-base", "--is-ancestor", productionStatus.latestMergedBaseline, "HEAD"]);
} catch {
  console.error("Production status drift: recorded merged baseline is not an ancestor of HEAD.");
  process.exit(1);
}

const baselineMigrations = execFileSync(
  "git",
  ["ls-tree", "-r", "--name-only", productionStatus.latestMergedBaseline, "packages/database/migrations"],
  { encoding: "utf8" },
)
  .trim()
  .split("\n")
  .filter((path) => /^packages\/database\/migrations\/\d{4}_.+\.sql$/.test(path) && !path.endsWith(".down.sql"))
  .sort();
const latestBaselineMigration = baselineMigrations.at(-1);
if (latestBaselineMigration !== productionStatus.latestMergedMigration) {
  console.error(
    `Production status drift: recorded latest migration ${productionStatus.latestMergedMigration} differs from baseline tree ${latestBaselineMigration ?? "missing"}.`,
  );
  process.exit(1);
}

if (process.env.GITHUB_TOKEN && process.env.GITHUB_REPOSITORY) {
  const response = await fetch(
    `https://api.github.com/repos/${process.env.GITHUB_REPOSITORY}/pulls?state=open&per_page=100`,
    {
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
        "X-GitHub-Api-Version": "2022-11-28",
      },
    },
  );
  if (!response.ok) {
    console.error(`Production status drift: GitHub mutex query failed (${response.status}).`);
    process.exit(1);
  }
  const activePullRequests = (await response.json()).filter((pullRequest) =>
    pullRequest.labels?.some((label) => label.name === "wevid-active-slice"),
  );
  if (activePullRequests.length > 1) {
    console.error("Production status drift: more than one open PR carries wevid-active-slice.");
    process.exit(1);
  }
  const activePullRequest = activePullRequests[0];
  const activeBranch = activePullRequest?.head?.ref;
  const latestMergedConvergence = /^Convergence (\d{2})\b/.exec(
    productionStatus.latestMergedSlice ?? "",
  )?.[1];
  const isScopedReviewRepair = latestMergedConvergence
    ? new RegExp(
        `^codex/converge-${latestMergedConvergence}-(?:[a-z0-9]+-)+repairs?$`,
      ).test(activeBranch ?? "")
    : false;
  if (
    activePullRequest &&
    !isScopedReviewRepair &&
    (typeof productionStatus.nextPlannedBranch !== "string" ||
      activeBranch !== productionStatus.nextPlannedBranch)
  ) {
    console.error(
      `Production status drift: active branch ${activeBranch ?? "missing"} does not match planned branch ${productionStatus.nextPlannedBranch}.`,
    );
    process.exit(1);
  }
}

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

const apiRouteFiles = [];
const walkApiRoutes = (dir) => {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) walkApiRoutes(full);
    else if (full.endsWith(".ts")) apiRouteFiles.push(full);
  }
};
walkApiRoutes("apps/api/src");

const openapiOperations = new Set();
let operationPath = null;
for (const match of openapi.matchAll(/^  (\/[^\n:]+):|^    (get|post|patch|put|delete):/gm)) {
  if (match[1]) {
    operationPath = match[1].startsWith("/v1/") ? normalizePath(match[1]) : null;
  } else if (operationPath && match[2]) {
    openapiOperations.add(`${match[2].toUpperCase()} ${operationPath}`);
  }
}

const fastifyOperations = new Set();
for (const file of apiRouteFiles) {
  const text = readFileSync(file, "utf8");
  for (const match of text.matchAll(/app\.(get|post|patch|put|delete)(?:<[^>]+>)?\(\s*["'`](\/v1\/[A-Za-z0-9{}:_/-]+)["'`]/g)) {
    fastifyOperations.add(`${match[1].toUpperCase()} ${normalizePath(match[2])}`);
  }
}

const missingFromFastify = [...openapiOperations].filter((route) => !fastifyOperations.has(route));
const missingFromContract = [...fastifyOperations].filter((route) => !openapiOperations.has(route));

if (missingFromFastify.length > 0 || missingFromContract.length > 0) {
  console.error("OpenAPI and Fastify route registrations differ after dynamic-segment normalization.");
  if (missingFromFastify.length > 0) {
    console.error("In OpenAPI but not registered in Fastify:");
    for (const route of missingFromFastify) console.error(`- ${route}`);
  }
  if (missingFromContract.length > 0) {
    console.error("Registered in Fastify but missing from OpenAPI:");
    for (const route of missingFromContract) console.error(`- ${route}`);
  }
  process.exit(1);
}

const missingOperationIds = [];
const operationIds = [];
const operationRegex = /^  (\/[^\n:]+):|^    (get|post|patch|put|delete):|^      operationId:/gm;
let currentPath = null;
let currentMethod = null;
let currentHasOperationId = false;
for (const match of openapi.matchAll(operationRegex)) {
  if (match[1]) {
    if (currentPath && currentMethod && !currentHasOperationId) {
      missingOperationIds.push(`${currentMethod.toUpperCase()} ${currentPath}`);
    }
    currentPath = match[1].startsWith("/v1/") ? match[1] : null;
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
const pathBlocks = [...openapi.matchAll(/^  (\/v1\/[^\n:]+):\n([\s\S]*?)(?=^  \/|\ncomponents:)/gm)];
for (const [, path, block] of pathBlocks) {
  for (const methodMatch of block.matchAll(/^    (post|patch|put|delete):\n([\s\S]*?)(?=^    (?:get|post|patch|put|delete):|(?![\s\S]))/gm)) {
    const methodBlock = methodMatch[2];
    const hasRequiredIdempotencyKey = methodBlock.includes(
      "#/components/parameters/RequiredIdempotencyKey"
    );
    const hasCheckoutCapabilityPolicy = methodBlock.includes(
      "x-idempotency-policy: checkout-capability"
    );
    const hasSingleUseAuthProofPolicy = methodBlock.includes(
      "x-idempotency-policy: single-use-auth-proof"
    );
    const hasBestEffortObservationPolicy = methodBlock.includes(
      "x-idempotency-policy: best-effort-observation-no-business-state"
    );
    const hasReadOnlyQueryPolicy = methodBlock.includes(
      "x-idempotency-policy: read-only-structured-query"
    );
    if (
      !hasRequiredIdempotencyKey &&
      !hasCheckoutCapabilityPolicy &&
      !hasSingleUseAuthProofPolicy &&
      !hasBestEffortObservationPolicy &&
      !hasReadOnlyQueryPolicy &&
      !path.includes("/webhooks/")
    ) {
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

console.log("WeVid docs, route map, and OpenAPI checks passed.");
