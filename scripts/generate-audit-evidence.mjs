#!/usr/bin/env node

import { createHash, randomBytes } from "node:crypto";
import {
  closeSync,
  existsSync,
  fsyncSync,
  linkSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  renameSync,
  unlinkSync,
  writeFileSync
} from "node:fs";
import { basename, dirname, extname, isAbsolute, join, normalize, relative, resolve, sep } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const baselineSha = "71ceabcfaa8a5258e1b935a391ff4e6e7330c682";
const expectedAuditSha256 = "c668e9e6c0fec6a265dbef6c8f3174b41b2109a255e2c79472db5e73985e67a7";
const expectedBaselinePathCount = 1069;
const auditSourceName = "WeVid_Full_Audit_71ceabc.txt";
const scriptPath = fileURLToPath(import.meta.url);
const repositoryRoot = resolve(dirname(scriptPath), "..");
const evidenceDirectory = "docs/v2-new-build/audit-evidence/71ceabc";
const ledgerPath = `${evidenceDirectory}/issue-ledger.json`;
const manifestPath = `${evidenceDirectory}/file-coverage.json`;
const receiptDirectory = `${evidenceDirectory}/execution-receipts`;
const semanticReviewDirectory = `${evidenceDirectory}/semantic-reviews`;
const originalEvidenceIndexPath = `${evidenceDirectory}/audit-inputs/original-evidence-index.json`;
const originalEvidenceMemberDirectory = `${evidenceDirectory}/audit-inputs/original`;
const generatedOutputPaths = new Set([ledgerPath, manifestPath]);
const sourceFingerprintExcludedPrefixes = [`${receiptDirectory}/`, `${semanticReviewDirectory}/`];
const protectedDirtyPaths = new Set(["docs/v2-new-build/current-implementation-status.md"]);
const prohibitedStagedPaths = new Set([
  ...protectedDirtyPaths,
  "packages/database/migrations/0130_recurring_membership_correctness.sql",
  "packages/database/migrations/0130_recurring_membership_correctness.down.sql"
]);
const shellWrapperExecutables = new Set([
  "bash", "cmd", "cmd.exe", "dash", "fish", "powershell", "pwsh", "sh", "zsh"
]);
const receiptResultKinds = new Set(["generic", "vitest", "node_test", "playwright"]);
const promotableReceiptResultKinds = new Set(["vitest", "node_test", "playwright"]);
const noOpExecutables = new Set(["false", "true"]);
const trustedAttestationState = Object.freeze({
  state: "unavailable",
  closureEligible: false,
  reason: "No approved external trust anchor or independently verified CI attestation was supplied. Tracked receipts and semantic reviews remain declarations."
});
const supplementalReviewSources = Object.freeze({
  functionalityReview: Object.freeze({
    name: "WeVid_PR134_Functionality_and_Double_Check.txt",
    sha256: "51a2cfca515c26d1251bfe4bc52551f0f44073366811cc004429088ff6a6408e",
    lineCount: 197,
    reviewedHead: "f46be653eed21541cb4cf82ebfb29ade058cef84"
  }),
  continuationInstruction: Object.freeze({
    name: "WeVid_PR134_Continue_Codex_Instruction.txt",
    sha256: "9d2fbbb4e1a1bef6afcba744786da3edece12f0bb3bef91904f972e54a79e523",
    lineCount: 158,
    reviewedHead: "f46be653eed21541cb4cf82ebfb29ade058cef84"
  }),
  closureDoubleCheck: Object.freeze({
    name: "WeVid_8505a69_Closure_Double_Check.txt",
    trackedPath: `${evidenceDirectory}/audit-inputs/WeVid_8505a69_Closure_Double_Check.txt`,
    sha256: "2ee902e3fc51d211c66aba7000c90106f1a53b7190d2e4abb74d7e9cec234c52",
    lineCount: 105,
    reviewedHead: "8505a69decabed50691557f255d2fc832fef6145"
  })
});

const preservationCheckpoint = Object.freeze({
  id: "wevid-checkpoint-71ceabc-s1m154",
  trackedPatchSha256: "befae1c8bddbc72fcf31659b046a1e898a4912110f73a92c9b80475069797617",
  untrackedArchiveSha256: "723a3cd8200c7a41113fee1cf72d15900cf0e8ffde822bf3ac645ab662899978"
});

const idPattern = "(?:ROOT|AUTH|CONTENT|PAY|WA|FE|DB|RES|CONTRACT|ROLLBACK|SUP|INT|TEST|MIGTEST-GAP|D|DM)-\\d{2}";
const registerLinePattern = new RegExp(`^- (${idPattern})\\b(.*)$`);
const detailHeadingPattern = new RegExp(`^(?:#{2,3}\\s+|\\*\\*)?(${idPattern})\\b`);

const domainByPrefix = Object.freeze({
  ROOT: "integration-runtime-authority",
  AUTH: "authentication-verification-admin-mcp",
  CONTENT: "content-discovery-social-live-messages-organizations",
  PAY: "payments-subscriptions-receipts-referrals",
  WA: "workers-notifications-analytics",
  FE: "frontend-client-privacy-product",
  DB: "database-rls-schema-migrations",
  RES: "api-errors-refunds-lifecycle",
  CONTRACT: "openapi-contract",
  ROLLBACK: "rollback-privacy-recovery",
  SUP: "enterprise-proof-integrity",
  INT: "real-database-integration-tests",
  TEST: "shared-api-test-fidelity",
  "MIGTEST-GAP": "migration-test-coverage",
  D: "architecture-provider-operations-docs",
  DM: "money-commerce-compliance-docs"
});

const issueDispositionRegistry = new Map();
const supplementalDispositionRegistry = new Map();

function registerDisposition(ids, definition) {
  for (const id of ids) {
    if (issueDispositionRegistry.has(id)) fail(`Duplicate disposition registry entry: ${id}`);
    issueDispositionRegistry.set(id, Object.freeze({ ...definition }));
  }
}

export function registerSupplementalDisposition(registry, ids, definition) {
  const allowed = new Set(["fixed", "superseded", "deferred_scope", "blocked_external", "unresolved"]);
  if (!allowed.has(definition.finalDisposition)) {
    fail(`Invalid supplemental disposition: ${definition.finalDisposition}`);
  }
  for (const id of ids) {
    if (!/^PR134-\d{3}$/.test(id)) fail(`Invalid supplemental finding ID: ${id}`);
    if (registry.has(id)) fail(`Duplicate supplemental disposition registry entry: ${id}`);
    registry.set(id, Object.freeze({
      workflowState: definition.finalDisposition === "unresolved" ? "confirmed" : "closed",
      executions: [],
      residualWork: [],
      externalPrerequisites: [],
      scopeDecision: null,
      ...definition
    }));
  }
}

function unverifiedHistoricalExecution(command, evidencePaths, environment = "historical local worktree") {
  return Object.freeze({
    kind: "historical_execution_claim",
    command,
    environment,
    evidencePaths,
    verificationState: "unverified",
    limitation: "No captured command/version/exit/result/log receipt was supplied for this historical claim."
  });
}

export function receiptReference(receiptId, definition) {
  if (!/^[a-z0-9][a-z0-9._-]{5,127}$/.test(receiptId)) {
    fail(`Invalid execution receipt ID: ${receiptId}`);
  }
  if (!definition || !Array.isArray(definition.argv) || definition.argv.length === 0 ||
      definition.argv.some((value) => typeof value !== "string" || value.length === 0)) {
    fail(`Receipt reference ${receiptId} requires exact command argv`);
  }
  if (definition.cwd !== ".") fail(`Receipt reference ${receiptId} requires cwd=.`);
  if (!promotableReceiptResultKinds.has(definition.resultKind)) {
    fail(`Receipt reference ${receiptId} requires a structured promotable result kind`);
  }
  if (noOpExecutables.has(basename(definition.argv[0]).toLowerCase())) {
    fail(`Receipt reference ${receiptId} cannot use a no-op executable`);
  }
  const evidencePaths = definition.evidencePaths ?? [];
  if (!Array.isArray(evidencePaths) || evidencePaths.some((path) => !repositoryPathIsSafe(path))) {
    fail(`Receipt reference ${receiptId} has invalid expected evidence paths`);
  }
  return Object.freeze({
    kind: "execution_receipt_reference",
    receiptId,
    expectedCommand: Object.freeze({ argv: Object.freeze([...definition.argv]), cwd: definition.cwd }),
    expectedResultKind: definition.resultKind,
    evidencePaths: Object.freeze([...evidencePaths])
  });
}

function fixed(ids, definition) {
  registerDisposition(ids, {
    workflowState: "verified",
    finalDisposition: "fixed",
    completeness: "issue_specific_repair_and_regression_evidence_present",
    residualWork: [],
    externalPrerequisites: [],
    scopeDecision: null,
    ...definition,
    finalTreeEvidenceRecorded: true
  });
}

function superseded(ids, definition) {
  registerDisposition(ids, {
    workflowState: "closed",
    finalDisposition: "superseded",
    completeness: "reported_hypothesis_or_authority_replaced",
    residualWork: [],
    externalPrerequisites: [],
    scopeDecision: null,
    finalTreeEvidenceRecorded: true,
    ...definition
  });
}

function deferred(ids, definition) {
  registerDisposition(ids, {
    workflowState: "closed",
    finalDisposition: "deferred_scope",
    completeness: "explicitly_outside_accepted_launch_scope",
    residualWork: [],
    externalPrerequisites: [],
    finalTreeEvidenceRecorded: false,
    ...definition
  });
}

function blocked(ids, definition) {
  registerDisposition(ids, {
    workflowState: "closed",
    finalDisposition: "blocked_external",
    completeness: "named_owner_prerequisite_and_release_gate_recorded",
    residualWork: [],
    scopeDecision: null,
    finalTreeEvidenceRecorded: false,
    ...definition
  });
}

function unresolved(ids, definition) {
  registerDisposition(ids, {
    workflowState: "confirmed",
    finalDisposition: "unresolved",
    completeness: "independent_local_work_remains",
    externalPrerequisites: [],
    scopeDecision: null,
    finalTreeEvidenceRecorded: false,
    ...definition
  });
}

fixed(["ROOT-01"], {
  summary: "Runtime pins and the reachable production dependency graph were updated, with an expiry-bound allowlist for the one accepted provider-owned advisory.",
  affectedPaths: [".node-version", ".nvmrc", "Dockerfile", "pnpm-lock.yaml", "scripts/audit-production-dependencies.mjs"],
  executions: [unverifiedHistoricalExecution("pnpm deps:check && pnpm audit:prod", ["scripts/audit-production-dependencies.test.mjs", "docs/v2-new-build/dependency-security-status.md"])]
});

superseded(["ROOT-02"], {
  summary: "The generalized wallet-profile failure was withdrawn by the audit; the remaining redundant lookup was also removed and covered against canonical users.id.",
  affectedPaths: ["apps/api/src/modules/profile/profile-creator-repository.ts"],
  executions: [unverifiedHistoricalExecution("pnpm --filter @veel/api exec vitest run test/profile-creator-repository.test.ts", ["apps/api/test/profile-creator-repository.test.ts"])]
});

fixed(["ROOT-03", "ROOT-04"], {
  summary: "Creator earnings are grouped by asset and public memberships use the canonical active-plan mapper instead of a duplicate hardcoded presenter.",
  affectedPaths: ["apps/api/src/modules/profile/profile-dashboard-repository.ts", "apps/api/src/modules/profile/profile-user-mappers.ts", "apps/web/app/app/profile/earnings/page.tsx"],
  executions: [unverifiedHistoricalExecution("pnpm --filter @veel/api exec vitest run test/profile-dashboard-mappers.test.ts test/profile-user-mappers.test.ts test/profile-creator-repository.test.ts", ["apps/api/test/profile-dashboard-mappers.test.ts", "apps/api/test/profile-user-mappers.test.ts"])]
});

fixed(["ROOT-05"], {
  summary: "Staging migration convergence now classifies only a verified pending suffix and rejects history holes, unknown remote versions, and changed applied SQL.",
  affectedPaths: ["scripts/check-supabase-migration-history.mjs", "scripts/migration-history-classifier.mjs"],
  executions: [unverifiedHistoricalExecution("node --test scripts/migration-history-classifier.test.mjs", ["scripts/migration-history-classifier.test.mjs"])]
});

fixed(["ROOT-06"], {
  summary: "Staging journeys are derived from exact-release evidence and required proof outcomes; missing, stale, blocked, or failed evidence cannot become PASS.",
  affectedPaths: ["scripts/staging-acceptance-status.mjs", "scripts/staging-acceptance.mjs", "docs/v2-new-build/operator/staging-acceptance.json"],
  executions: [unverifiedHistoricalExecution("pnpm exec vitest run scripts/staging-gates.test.mjs", ["scripts/staging-gates.test.mjs"])]
});

fixed(["ROOT-07"], {
  summary: "SOLANA_CLUSTER is canonical, all compatibility projections reject contradictions, and staging compares private RPC genesis to the official cluster endpoint.",
  affectedPaths: ["packages/config/src/public.ts", "packages/config/src/index.ts", "apps/web/src/public-env.ts", "scripts/verify-solana-rpc-network.mjs"],
  executions: [unverifiedHistoricalExecution("pnpm --filter @veel/config test && pnpm --filter @veel/web test -- src/public-env.test.ts && node --test scripts/verify-solana-rpc-network.test.mjs scripts/staging-gates.test.mjs", ["packages/config/src/index.test.ts", "apps/web/src/public-env.test.ts", "scripts/verify-solana-rpc-network.test.mjs"])]
});

superseded(["ROOT-08"], {
  summary: "The legacy generic assistant execution surface was retired: capabilities expose no executable tools and session/tool-call writes return provider_unavailable instead of canned success.",
  affectedPaths: ["apps/api/src/modules/ai/ai-route-policy.ts", "apps/api/src/modules/ai/ai-routes.ts", "docs/v2-new-build/safety-admin-ai.md"],
  executions: [unverifiedHistoricalExecution("pnpm --filter @veel/api exec vitest run test/app.test.ts test/mcp.test.ts", ["apps/api/test/app.test.ts", "apps/api/test/mcp.test.ts"])]
});

fixed(["ROOT-09", "INT-01", "INT-02"], {
  summary: "One guarded wildcard integration command discovers the Didit lifecycle suite, CI calls that command, and the suite uses the shared non-production database-target guard.",
  affectedPaths: ["apps/api/package.json", ".github/workflows/ci.yml", "apps/api/test/didit-verification.integration.test.ts", "apps/api/test/integration-database.ts"],
  executions: [unverifiedHistoricalExecution("node --test scripts/api-integration-suite.test.mjs", ["scripts/api-integration-suite.test.mjs"]), unverifiedHistoricalExecution("pnpm --filter @veel/api test:integration", ["apps/api/test/didit-verification.integration.test.ts"], "disposable PostgreSQL; provider HTTP fixtures")]
});

fixed(["AUTH-01", "AUTH-02", "AUTH-03", "AUTH-04", "AUTH-05", "AUTH-06", "AUTH-16", "AUTH-22", "AUTH-23"], {
  summary: "Verification now reserves durable handoff state, separates launch TTL from decision validity, maps provider subjects correctly, applies monotonic decisions, reconciles early callbacks, preserves distinct Sumsub events, and uses a real hosted launch contract.",
  affectedPaths: ["apps/api/src/modules/verification/verification-repository.ts", "apps/api/src/modules/verification/verification-provider-adapters.ts", "apps/api/src/modules/age/age-repository.ts", "packages/database/migrations/0122_verification_lifecycle_hardening.sql"],
  executions: [unverifiedHistoricalExecution("pnpm --filter @veel/api exec vitest run test/app.test.ts test/didit-verification.integration.test.ts", ["apps/api/test/app.test.ts", "apps/api/test/didit-verification.integration.test.ts"]), unverifiedHistoricalExecution("pnpm --filter @veel/api test:integration -- didit-verification.integration.test.ts", ["packages/database/migrations/0122_verification_lifecycle_hardening.sql"], "disposable PostgreSQL; signed provider fixtures")]
});

fixed(["AUTH-07"], {
  summary: "Recovery exchange is bound to the genuine provider session/authentication time and a per-user revocation epoch, including logout-all races.",
  affectedPaths: ["apps/api/src/modules/session/supabase-auth.ts", "packages/database/migrations/0119_recovery_session_revocation_boundary.sql"],
  executions: [unverifiedHistoricalExecution("pnpm --filter @veel/api exec vitest run test/supabase-auth.test.ts test/recovery-session-revocation.integration.test.ts", ["apps/api/test/supabase-auth.test.ts", "apps/api/test/recovery-session-revocation.integration.test.ts"])]
});

fixed(["AUTH-08"], {
  summary: "OAuth authorization-code consumption and token insertion now share one transaction and one code can mint at most one token under concurrency.",
  affectedPaths: ["apps/api/src/modules/mcp/mcp-repository.ts", "packages/database/migrations/0125_mcp_oauth_atomic_redemption.sql"],
  executions: [unverifiedHistoricalExecution("pnpm --filter @veel/api exec vitest run test/mcp-oauth-redemption.integration.test.ts test/mcp.test.ts", ["apps/api/test/mcp-oauth-redemption.integration.test.ts"])]
});

fixed(["AUTH-11", "AUTH-18"], {
  summary: "Admin lists use endpoint-scoped compound keysets from the last returned row, including priority boundaries; live SQL columns are qualified and parsed by PostgreSQL.",
  affectedPaths: ["apps/api/src/modules/admin/admin-repository-mapper-utils.ts", "apps/api/src/modules/admin/admin-repository-event-ops.ts"],
  executions: [unverifiedHistoricalExecution("pnpm --filter @veel/api exec vitest run src/modules/admin/admin-repository-mapper-utils.test.ts test/admin-pagination.integration.test.ts test/admin-staff.integration.test.ts", ["apps/api/src/modules/admin/admin-repository-mapper-utils.test.ts", "apps/api/test/admin-pagination.integration.test.ts"])]
});

fixed(["AUTH-12", "AUTH-13", "AUTH-19", "AUTH-21"], {
  summary: "Admin operations now use canonical open-report, exact feature-flag, verification-record, and minimized MCP tool projections.",
  affectedPaths: ["apps/api/src/modules/admin/admin-repository-access.ts", "apps/api/src/modules/admin/admin-repository-feature-flag.ts", "apps/api/src/modules/admin/admin-repository-event-ops.ts", "packages/database/migrations/0127_admin_operations_projection_authority.sql"],
  executions: [unverifiedHistoricalExecution("pnpm --filter @veel/api exec vitest run test/admin-authority-projections.integration.test.ts", ["apps/api/test/admin-authority-projections.integration.test.ts"], "disposable PostgreSQL")]
});

fixed(["AUTH-14"], {
  summary: "MCP tool quotas use the distributed limiter boundary keyed by connection and tool-risk bucket, with bounded expiry and two-replica coverage.",
  affectedPaths: ["apps/api/src/modules/mcp/mcp-routes.ts"],
  executions: [unverifiedHistoricalExecution("pnpm --filter @veel/api exec vitest run test/mcp.test.ts", ["apps/api/test/mcp.test.ts"])]
});

fixed(["AUTH-17"], {
  summary: "A concurrent consumed wallet-proof loser maps to the documented invalid-proof response instead of the global 500 path.",
  affectedPaths: ["apps/api/src/modules/auth/wallet-auth-routes.ts"],
  executions: [unverifiedHistoricalExecution("pnpm --filter @veel/api exec vitest run test/app.test.ts", ["apps/api/test/app.test.ts"])]
});

fixed(["AUTH-20"], {
  summary: "Organization owner-set changes serialize on one organization-scoped lock and recheck the last-owner invariant transactionally.",
  affectedPaths: ["apps/api/src/modules/admin/admin-repository-organization.ts"],
  executions: [unverifiedHistoricalExecution("pnpm --filter @veel/api exec vitest run test/admin-staff.integration.test.ts", ["apps/api/test/admin-staff.integration.test.ts"], "disposable PostgreSQL")]
});

blocked(["AUTH-09"], {
  summary: "The private avatar-staging migration and cleanup design is prepared but intentionally not applied without explicit owner approval for the new storage/table lifecycle; production promotion remains blocked on this P1 boundary.",
  affectedPaths: ["apps/api/src/modules/profile/profile-routes.ts"],
  executions: [],
  externalPrerequisites: [{
    owner: "repository owner and Supabase storage operator",
    prerequisite: "Explicitly approve the private profile-avatar-staging bucket plus operation/evidence/cleanup tables and guarded rollback semantics.",
    proofCommand: "Apply the approved migration to disposable PostgreSQL/Supabase Storage, then run avatar decode, quota, ownership, replacement, abandoned-object cleanup, and rollback/refusal tests.",
    failClosedState: "Treat AUTH-09 as a production release blocker; do not promote the current public raw-avatar path."
  }]
});

blocked(["AUTH-15"], {
  summary: "The exact deployed Didit signed-freshness contract remains provider-ambiguous; no alternate cryptography was invented and production verification stays gated pending signed fixtures.",
  affectedPaths: ["apps/api/src/modules/verification/didit-webhook.ts"],
  executions: [],
  externalPrerequisites: [{
    owner: "identity provider owner and Didit technical contact",
    prerequisite: "Confirm whether the deployed signature binds the body timestamp or a signed header/body tuple and supply rotation-safe signed fixtures.",
    proofCommand: "Run stale-body/current-header, exact replay, rotation overlap, and valid-current signed fixtures against the configured Didit webhook before enabling the provider.",
    failClosedState: "Didit-backed production verification must remain disabled until the signed freshness contract is proven."
  }]
});

fixed(["CONTENT-01"], {
  summary: "Composition mutability and publication authorization no longer depend on the upload-only provider-processing state, including ready multi-asset drafts.",
  affectedPaths: ["apps/api/src/modules/content/content-media-repository.ts", "apps/api/src/modules/content/content-repository.ts"],
  executions: [unverifiedHistoricalExecution("pnpm --filter @veel/api exec vitest run test/content-media-repository.test.ts test/app.test.ts", ["apps/api/test/content-media-repository.test.ts"])]
});

fixed(["CONTENT-02", "CONTENT-03"], {
  summary: "Video creation is durably reserved before provider side effects and Bunny receipt plus replay work is recoverable and idempotent after interruption.",
  affectedPaths: ["apps/api/src/modules/content/content-media-repository.ts", "apps/api/src/modules/content/media-upload-adapter.ts", "packages/database/migrations/0123_media_upload_operation_hardening.sql"],
  executions: [unverifiedHistoricalExecution("pnpm --filter @veel/api exec vitest run test/content-media-durability.integration.test.ts test/media-upload-adapter.test.ts", ["apps/api/test/content-media-durability.integration.test.ts", "apps/api/test/media-upload-adapter.test.ts"])]
});

fixed(["CONTENT-04"], {
  summary: "Like/save/comment-like commands reserve durable actor/action/target/key receipts so delayed A/B/A replays cannot toggle state again.",
  affectedPaths: ["apps/api/src/modules/engagement/engagement-content-actions-repository.ts", "apps/api/src/modules/engagement/engagement-comment-repository.ts"],
  executions: [unverifiedHistoricalExecution("pnpm --filter @veel/api test:integration", ["apps/api/test/authenticated-happy-path.integration.test.ts"], "disposable PostgreSQL")]
});

fixed(["CONTENT-05", "CONTENT-06"], {
  summary: "Discover reuses canonical eligibility and signed media projections, while mixed search carries typed per-group compound cursors and rejects legacy cross-type values.",
  affectedPaths: ["apps/api/src/modules/discover/discover-content-queries.ts", "apps/api/src/modules/discover/discover-cursor.ts", "apps/api/src/modules/discover/discover-routes.ts"],
  executions: [unverifiedHistoricalExecution("pnpm --filter @veel/api exec vitest run test/discover-cursor.test.ts test/discover-authority.integration.test.ts test/app.test.ts", ["apps/api/test/discover-cursor.test.ts", "apps/api/test/discover-authority.integration.test.ts"])]
});

fixed(["CONTENT-09"], {
  summary: "Mutuals presentation media kind is derived from migrated content/media fields rather than the nonexistent content_items.media_kind column.",
  affectedPaths: ["apps/api/src/modules/mutuals/mutuals-repository.ts", "apps/api/src/modules/mutuals/mutuals-repository-mappers.ts"],
  executions: [unverifiedHistoricalExecution("pnpm --filter @veel/api exec vitest run test/mutuals-repository-mappers.test.ts", ["apps/api/test/mutuals-repository-mappers.test.ts"])]
});

fixed(["CONTENT-12"], {
  summary: "Creator-request acceptance is bound to an exact monotonic terms revision; only creator counteroffers can change the price or delivery/cancellation terms.",
  affectedPaths: ["apps/api/src/modules/message/message-commercial-repository.ts", "packages/database/migrations/0124_structured_creator_request_terms_revision.sql"],
  executions: [unverifiedHistoricalExecution("pnpm --filter @veel/api exec vitest run test/app.test.ts", ["apps/api/test/app.test.ts", "packages/database/test/migrations.test.ts"])]
});

fixed(["CONTENT-13"], {
  summary: "Paid-event chat now grants membership access only when the room explicitly includes profile members; otherwise an Event Access/live pass is required.",
  affectedPaths: ["apps/api/src/modules/live/live-chat-repository.ts"],
  executions: [unverifiedHistoricalExecution("pnpm --filter @veel/api exec vitest run test/app.test.ts", ["apps/api/test/app.test.ts"])]
});

fixed(["CONTENT-15"], {
  summary: "Managed-creator reporting includes historical allocations only when the exact referenced agreement granted analytics permission.",
  affectedPaths: ["apps/api/src/modules/managed-creator/managed-creator-repository.ts"],
  executions: [unverifiedHistoricalExecution("pnpm --filter @veel/api exec vitest run test/managed-creator-reporting.integration.test.ts", ["apps/api/test/managed-creator-reporting.integration.test.ts"], "disposable PostgreSQL")]
});

fixed(["CONTENT-19"], {
  summary: "Private image objects are projected through short-lived authorized canonical delivery capabilities, including bounded width variants and revoked-access denial.",
  affectedPaths: ["apps/api/src/modules/content/content-route-shared.ts", "apps/web/app/content/content-renderer.tsx"],
  executions: [unverifiedHistoricalExecution("pnpm --filter @veel/api exec vitest run test/content-image-delivery.test.ts", ["apps/api/test/content-image-delivery.test.ts"])]
});

fixed(["CONTENT-20"], {
  summary: "Purpose-bound performer verification persists threshold_age and result_over_threshold so approved adult evidence reaches canonical performer release readiness.",
  affectedPaths: ["apps/api/src/modules/verification/verification-repository.ts"],
  executions: [unverifiedHistoricalExecution("pnpm --filter @veel/api exec vitest run test/didit-verification.integration.test.ts", ["apps/api/test/didit-verification.integration.test.ts"], "disposable PostgreSQL; signed provider fixtures")]
});

deferred(["CONTENT-11"], {
  summary: "The subscriber_only mapper branch is unreachable under the canonical payment-product enum; removal is dormant vocabulary cleanup, not a supported launch behavior.",
  affectedPaths: ["apps/api/src/modules/content/content-repository-mappers.ts"],
  executions: [],
  scopeDecision: {
    authority: "The audit itself classifies CONTENT-11 as conditional dormant cleanup; canonical launch membership access remains visibility/access-rule based.",
    acceptedBehavior: "No subscriber_only payment product is advertised or accepted; membership access continues through canonical subscription and entitlement authorities."
  }
});

fixed(["PAY-01"], {
  summary: "Settlement verification consumes an exact transfer-instruction multiset so one instruction cannot satisfy two equal split legs.",
  affectedPaths: ["apps/api/src/modules/payment/solana-payment.ts"],
  executions: [unverifiedHistoricalExecution("pnpm --filter @veel/api exec vitest run test/payment-solana.test.ts", ["apps/api/test/payment-solana.test.ts"])]
});

fixed(["PAY-06"], {
  summary: "Solana receipt and normalized replay event writes share one transaction, and authenticated redelivery repairs a historical receipt-only orphan.",
  affectedPaths: ["apps/api/src/modules/payment/payment-evidence-repository.ts"],
  executions: [unverifiedHistoricalExecution("pnpm --filter @veel/api exec vitest run test/payment-evidence-repository.test.ts", ["apps/api/test/payment-evidence-repository.test.ts"])]
});

fixed(["PAY-07", "PAY-08"], {
  summary: "Confirmation-email leasing filters deliverable recipients before the limit, retries classified transient failures, fences stale leases, and dead-letters permanent/exhausted work.",
  affectedPaths: ["apps/worker/src/payment-confirmation-email.ts"],
  executions: [unverifiedHistoricalExecution("pnpm --filter @veel/api exec vitest run test/payment-confirmation-email.integration.test.ts && pnpm --filter @veel/worker test", ["apps/api/test/payment-confirmation-email.integration.test.ts", "apps/worker/test/index.test.ts"])]
});

fixed(["PAY-09"], {
  summary: "Receipt email formats stored atomic token amounts with exact asset decimals instead of printing raw integers as whole SOL/USDC.",
  affectedPaths: ["apps/worker/src/payment-confirmation-email.ts", "apps/web/src/format-asset-amount.ts"],
  executions: [unverifiedHistoricalExecution("pnpm --filter @veel/worker test && pnpm --filter @veel/web exec vitest run test/format-asset-amount.test.ts", ["apps/worker/test/index.test.ts", "apps/web/test/format-asset-amount.test.ts"])]
});

blocked(["PAY-02", "PAY-03", "PAY-04", "PAY-05", "PAY-10", "PAY-11", "PAY-17", "DM-08"], {
  summary: "Recurring collection correctness, unique delegation terms, cancellation arbitration, typed recovery, immutable plan terms, and financial artifacts require the proposed recurring-authority migration; no unapproved financial schema mutation was made.",
  affectedPaths: ["apps/worker/src/subscription-collections.ts", "apps/api/src/modules/subscription", "packages/database/migrations/0098_recurring_membership_authority.sql"],
  executions: [],
  externalPrerequisites: [{
    owner: "repository owner, payments owner, and legal/commercial approver",
    prerequisite: "Approve corrected seeded plan cents and the versioned recurring consent, nonce, immutable authorization, cancellation, receipt, and accounting migration plus stricter Solana delegation verification.",
    proofCommand: "Run migration up/down/up on populated disposable PostgreSQL, two-worker concurrency/cancellation/reconciliation suites, exact Solana delegation fixtures, receipt/accounting projections, and the staging subscription proof.",
    failClosedState: "SUBSCRIPTIONS_ENABLED remains false and recurring products must not be sold or promoted until the approved migration and exact provider evidence pass."
  }]
});

deferred(["PAY-16"], {
  summary: "General content unlock remains the explicitly documented native-SOL-first launch product; extending that product to USDC is a separate product-scope change, not an implied partial implementation.",
  affectedPaths: ["apps/api/src/modules/content/content-read-repository.ts", "docs/v2-new-build/payments-and-monetisation.md"],
  executions: [],
  scopeDecision: {
    authority: "AGENTS.md architecture default selects native SOL devnet first and SPL/USDC capable paths without requiring every product to advertise both assets.",
    acceptedBehavior: "Content unlock advertises SOL only; existing Support/commercial one-time USDC paths remain separate and no UI may claim USDC content unlock."
  }
});

fixed(["WA-01", "WA-02", "WA-03", "WA-04"], {
  summary: "Web Push validates endpoint/key/DNS boundaries, uses a bounded pinned transport, fences account/subscription generations, prevents starvation, and rechecks preferences before dispatch.",
  affectedPaths: ["apps/api/src/modules/notification/notification-device-repository.ts", "apps/worker/src/notification-delivery.ts", "packages/database/migrations/0121_notification_push_delivery_hardening.sql"],
  executions: [unverifiedHistoricalExecution("pnpm --filter @veel/api exec vitest run test/notification-push-delivery.integration.test.ts test/app.test.ts && pnpm --filter @veel/worker test", ["apps/api/test/notification-push-delivery.integration.test.ts", "apps/worker/test/index.test.ts"])]
});

fixed(["WA-05", "WA-06"], {
  summary: "Suppressed analytics points hide sample size and platform queries require the canonical analytics-read permission with bounded audit purpose.",
  affectedPaths: ["apps/api/src/modules/analytics/analytics-service.ts", "apps/api/src/modules/analytics/analytics-routes.ts", "apps/api/src/modules/admin/admin-route-auth.ts"],
  executions: [unverifiedHistoricalExecution("pnpm --filter @veel/api exec vitest run test/analytics.test.ts test/analytics-core.integration.test.ts test/admin-permissions.test.ts", ["apps/api/test/analytics.test.ts", "apps/api/test/analytics-core.integration.test.ts"])]
});

fixed(["WA-07", "WA-08", "WA-09", "WA-10", "WA-11", "WA-12"], {
  summary: "Analytics projections snapshot one media asset, scope replay identity correctly, enqueue minute work, enforce raw retention, compare per-source reconciliation, and dead-letter exhausted recovered leases.",
  affectedPaths: ["apps/worker/src/analytics-projections.ts", "packages/database/migrations/0126_analytics_projection_retention_hardening.sql"],
  executions: [unverifiedHistoricalExecution("pnpm --filter @veel/worker test && pnpm --filter @veel/api exec vitest run test/analytics-core.integration.test.ts", ["apps/worker/test/index.test.ts", "apps/api/test/analytics-core.integration.test.ts"], "unit plus disposable PostgreSQL")]
});

fixed(["FE-01", "FE-02"], {
  summary: "Private message retry work is actor/session/conversation scoped, cleared on logout/account switch, retains transient failures, and preserves logical-send idempotency.",
  affectedPaths: ["apps/web/app/messages/message-composer.tsx", "apps/web/src/messages/offline-message-queue.ts"],
  executions: [unverifiedHistoricalExecution("pnpm --filter @veel/web exec vitest run src/messages/offline-message-queue.test.ts src/session/clear-user-scoped-browser-state.test.ts", ["apps/web/src/messages/offline-message-queue.test.ts", "apps/web/src/session/clear-user-scoped-browser-state.test.ts"])]
});

fixed(["FE-06"], {
  summary: "All affected continuation paths use one exact-origin parser that rejects network paths, backslashes, encoded separators, credentials, and control characters.",
  affectedPaths: ["apps/web/src/navigation/safe-same-origin-path.ts", "apps/web/app/auth/confirm/route.ts"],
  executions: [unverifiedHistoricalExecution("pnpm --filter @veel/web exec vitest run src/navigation/safe-same-origin-path.test.ts app/auth/confirm/route.test.ts", ["apps/web/src/navigation/safe-same-origin-path.test.ts", "apps/web/app/auth/confirm/route.test.ts"])]
});

fixed(["FE-17"], {
  summary: "Recent searches are actor-scoped, session-bounded, expiring, clearable, and removed with other private browser state on logout or account switch.",
  affectedPaths: ["apps/web/src/search/recent-searches.ts", "apps/web/app/app/search/search-experience.tsx"],
  executions: [unverifiedHistoricalExecution("pnpm --filter @veel/web exec vitest run src/search/recent-searches.test.ts src/session/clear-user-scoped-browser-state.test.ts", ["apps/web/src/search/recent-searches.test.ts"])]
});

fixed(["FE-20"], {
  summary: "Subscription cents and token atomic integers use separate exact bigint-safe parsers/formatters; consumer forms no longer ask for raw atomic values.",
  affectedPaths: ["apps/web/src/format-asset-amount.ts", "apps/web/src/commercial-amount-input.ts", "apps/web/src/subscription-price-input.ts"],
  executions: [unverifiedHistoricalExecution("pnpm --filter @veel/web exec vitest run test/format-asset-amount.test.ts test/money-input-boundaries.test.ts", ["apps/web/test/format-asset-amount.test.ts", "apps/web/test/money-input-boundaries.test.ts"])]
});

fixed(["FE-25"], {
  summary: "Backend-confirmed access payments trigger bounded canonical projection refresh while the UI remains awaiting_projection until the owning domain grants access.",
  affectedPaths: ["apps/web/src/payment-confirmation-projection.ts", "apps/web/src/payment-handoff-panel.tsx"],
  executions: [unverifiedHistoricalExecution("pnpm --filter @veel/web exec vitest run src/payment-confirmation-projection.test.ts", ["apps/web/src/payment-confirmation-projection.test.ts"])]
});

fixed(["DB-01", "DB-02", "DB-07"], {
  summary: "Migration 0120 removes effective browser-role grants/policies from named server-owned identity, finance, content, counter, comment, media, and organization authorities while preserving backend access.",
  affectedPaths: ["packages/database/migrations/0120_data_api_server_authority.sql"],
  executions: [unverifiedHistoricalExecution("pnpm --filter @veel/api exec vitest run test/data-api-authority.integration.test.ts", ["apps/api/test/data-api-authority.integration.test.ts"], "disposable PostgreSQL with anon/authenticated/backend roles")]
});

fixed(["DB-03"], {
  summary: "OpenAPI 3.1 nullable shapes use JSON Schema unions and representative null/non-null resources validate under Draft 2020-12.",
  affectedPaths: ["packages/contracts/openapi.yaml"],
  executions: [unverifiedHistoricalExecution("pnpm --filter @veel/contracts test", ["packages/contracts/src/openapi-schema.test.ts"])]
});

fixed(["DB-05"], {
  summary: "Migration 0039 rollback uses catalog-guarded supported ALTER PUBLICATION syntax and executes through down/reapply proof.",
  affectedPaths: ["packages/database/migrations/0039_realtime_projection_publication.down.sql"],
  executions: [unverifiedHistoricalExecution("pnpm --filter @veel/database exec vitest run test/rollbacks.integration.test.ts", ["packages/database/test/rollbacks.integration.test.ts"], "disposable PostgreSQL")]
});

fixed(["RES-01", "RES-02"], {
  summary: "Unexpected errors return a stable sanitized resource/request ID, and refund requests are validated through the canonical runtime contract before repository access.",
  affectedPaths: ["apps/api/src/app.ts", "apps/api/src/modules/refund/refund-routes.ts"],
  executions: [unverifiedHistoricalExecution("pnpm --filter @veel/api exec vitest run test/app.test.ts", ["apps/api/test/app.test.ts"])]
});

fixed(["RES-03"], {
  summary: "Ordinary termination drains the API, runs close hooks once, bounds stuck shutdown, and exits nonzero on close failure.",
  affectedPaths: ["apps/api/src/api-shutdown.ts", "apps/api/src/server.ts"],
  executions: [unverifiedHistoricalExecution("pnpm --filter @veel/api exec vitest run test/api-shutdown.test.ts", ["apps/api/test/api-shutdown.test.ts"])]
});

fixed(["RES-04"], {
  summary: "Activity and refund histories use stable compound keysets from the last visible row, including equal timestamps and legacy cursor compatibility.",
  affectedPaths: ["apps/api/src/shared/keyset-pagination.ts", "apps/api/src/modules/activity/activity-ledger-repository.ts", "apps/api/src/modules/refund/refund-repository.ts"],
  executions: [unverifiedHistoricalExecution("pnpm --filter @veel/api exec vitest run test/keyset-pagination.test.ts test/activity-refund-resilience.integration.test.ts", ["apps/api/test/keyset-pagination.test.ts", "apps/api/test/activity-refund-resilience.integration.test.ts"])]
});

fixed(["RES-05"], {
  summary: "Same-key refund requests serialize on a scoped advisory lock, replay the original result, and conflict on changed input.",
  affectedPaths: ["apps/api/src/modules/refund/refund-repository.ts"],
  executions: [unverifiedHistoricalExecution("pnpm --filter @veel/api exec vitest run test/activity-refund-resilience.integration.test.ts", ["apps/api/test/activity-refund-resilience.integration.test.ts"], "disposable PostgreSQL")]
});

fixed(["CONTRACT-01"], {
  summary: "Age webhooks are provider-specific literal routes whose schemas accept the documented Sumsub/Yoti payloads and describe the authentication/acknowledgement runtime actually uses.",
  affectedPaths: ["packages/contracts/openapi.yaml", "apps/api/src/modules/age/age-routes.ts"],
  executions: [unverifiedHistoricalExecution("pnpm --filter @veel/contracts test && pnpm --filter @veel/api exec vitest run test/app.test.ts", ["packages/contracts/src/openapi-schema.test.ts", "apps/api/test/app.test.ts"])]
});

fixed(["CONTRACT-02", "CONTRACT-03"], {
  summary: "Playback capabilities are response-only and public/admin payment state vocabularies include every reachable state, including cancelled.",
  affectedPaths: ["packages/contracts/openapi.yaml"],
  executions: [unverifiedHistoricalExecution("pnpm --filter @veel/contracts test", ["packages/contracts/src/openapi-schema.test.ts"])]
});

fixed(["ROLLBACK-01"], {
  summary: "Migration 0117 down refuses before destructive DDL when retained Moment/expiry evidence exists, while empty rollback/reapply remains executable.",
  affectedPaths: ["packages/database/migrations/0117_moments_and_scheduled_publication.down.sql"],
  executions: [unverifiedHistoricalExecution("pnpm --filter @veel/database exec vitest run test/rollbacks.integration.test.ts", ["packages/database/test/rollbacks.integration.test.ts"], "disposable PostgreSQL with populated and empty fixtures")]
});

fixed(["TEST-01"], {
  summary: "The live-room fixture now distinguishes omitted fields from explicit null, so reserved-room tests no longer receive fabricated provider IDs or host secrets.",
  affectedPaths: ["apps/api/test/app.test.ts"],
  executions: [unverifiedHistoricalExecution("pnpm --filter @veel/api exec vitest run test/app.test.ts", ["apps/api/test/app.test.ts"])]
});

deferred(["MIGTEST-GAP-01"], {
  summary: "Supported privacy-sensitive rollback/refusal paths execute in disposable PostgreSQL; exhaustive destructive rollback of every historical migration is not an accepted repository guarantee.",
  affectedPaths: ["packages/database/test/rollbacks.integration.test.ts"],
  executions: [],
  scopeDecision: {
    authority: "AGENTS.md requires reversible migrations where practical, not destructive reversibility of every applied historical migration.",
    acceptedBehavior: "Guarded supported paths are executable; data-bearing down migrations may refuse rather than erase retained facts."
  }
});

fixed(["MIGTEST-GAP-02"], {
  summary: "The migration oracle now includes real-role observable allow/deny behavior for the audited Data API authority rather than policy-name substrings alone.",
  affectedPaths: ["apps/api/test/data-api-authority.integration.test.ts"],
  executions: [unverifiedHistoricalExecution("pnpm --filter @veel/api exec vitest run test/data-api-authority.integration.test.ts", ["apps/api/test/data-api-authority.integration.test.ts"], "disposable PostgreSQL with direct roles")]
});

superseded(["MIGTEST-GAP-03"], {
  summary: "Per-file substring assertions are not the accepted completeness model; the canonical gate applies the ordered forward chain and tests final-schema invariants instead.",
  affectedPaths: ["packages/database/scripts/check-migrations.mjs", "packages/database/test/migrations.test.ts"],
  executions: [unverifiedHistoricalExecution("pnpm database:check", ["packages/database/scripts/check-migrations.mjs", "packages/database/test/migrations.test.ts"])]
});

fixed(["MIGTEST-GAP-04"], {
  summary: "The canonical guarded API integration suite now includes final-schema repository SQL for verification, media, Data API, discovery, admin, analytics, reporting, push, OAuth, refunds, and recovery.",
  affectedPaths: ["apps/api/test", "scripts/api-integration-suite.test.mjs"],
  executions: [unverifiedHistoricalExecution("node --test scripts/api-integration-suite.test.mjs", ["scripts/api-integration-suite.test.mjs"]), unverifiedHistoricalExecution("pnpm --filter @veel/api test:integration", ["apps/api/test"], "disposable PostgreSQL")]
});

fixed(["D-02", "D-03", "D-04", "D-05", "D-06"], {
  summary: "Canonical docs now distinguish opaque app sessions from recovery/Realtime, lock one onboarding flow, separate capability-specific KYC/KYB/age decisions, align runtime config ownership, and distinguish storage readiness from release eligibility.",
  affectedPaths: ["docs/v2-new-build/auth-supabase-realtime.md", "docs/v2-new-build/providers/identity-provider-wiring.md", "docs/v2-new-build/deployment-topology.md", "docs/v2-new-build/media-live-providers.md"],
  executions: [unverifiedHistoricalExecution("pnpm docs:check", ["scripts/check-docs.mjs"])]
});

fixed(["D-07", "DM-01"], {
  summary: "Active ranking docs exclude purchase, unlock, subscription, revenue, wallet, referral, and other money facts, and a repository policy check rejects their reintroduction.",
  affectedPaths: ["docs/v2-new-build/recommendation-discovery.md", "docs/v2-new-build/profile-activity-ranking.md", "docs/v2-new-build/engagement-strategy.md", "scripts/check-ranking-policy.mjs"],
  executions: [unverifiedHistoricalExecution("pnpm ranking:policy", ["scripts/check-ranking-policy.test.mjs"])]
});

fixed(["D-10"], {
  summary: "Canonical MCP docs identify 2026-07-28 as final/latest while explicitly naming the tested 2025-11-25 initialize-based compatibility target and upgrade gate.",
  affectedPaths: ["docs/v2-new-build/adr/0002-provider-decisions-2026.md", "docs/v2-new-build/mcp-staging-proof.md", "docs/v2-new-build/product/mcp-profile-bridge.md"],
  executions: [unverifiedHistoricalExecution("pnpm docs:check", ["scripts/check-docs.mjs"])]
});

deferred(["D-11"], {
  summary: "Current scope deliberately stores bounded provenance references as unverified claims; a full C2PA validator and ownership proof remain outside the accepted bridge.",
  affectedPaths: ["docs/v2-new-build/product/mcp-media-provenance-bridge.md", "docs/v2-new-build/adr/0002-provider-decisions-2026.md"],
  executions: [],
  scopeDecision: {
    authority: "The accepted MCP media bridge explicitly states references are claims, not validation or ownership results, and exposes no publish endpoint.",
    acceptedBehavior: "Only bounded opaque references are retained; UI/API must not label them verified, ownership-proven, or portable credentials."
  }
});

fixed(["D-12"], {
  summary: "Docs expose the narrow current MCP registry and move wish-list actions outside runtime scope; legacy generic AI execution is disabled rather than presented as implemented.",
  affectedPaths: ["docs/v2-new-build/ai-mcp-use-cases.md", "docs/v2-new-build/safety-admin-ai.md", "apps/api/src/modules/ai/ai-routes.ts"],
  executions: [unverifiedHistoricalExecution("pnpm docs:check && pnpm --filter @veel/api exec vitest run test/mcp.test.ts test/app.test.ts", ["scripts/check-docs.mjs", "apps/api/test/mcp.test.ts"])]
});

fixed(["DM-02", "DM-03", "DM-04", "DM-05", "DM-07", "DM-12"], {
  summary: "Active money/social docs now use opaque app-session authority, exact current record names, paid-live-event access, non-preferential membership benefits, policy-driven creator KYC, and mark manual renewal recovery unsupported.",
  affectedPaths: ["docs/v2-new-build/profile-activity-ranking.md", "docs/v2-new-build/engagement-strategy.md", "docs/v2-new-build/business-monetisation.md", "docs/v2-new-build/compliance/dac7-dac8-vat-system.md"],
  executions: [unverifiedHistoricalExecution("pnpm docs:check && pnpm ranking:policy", ["scripts/check-docs.mjs", "scripts/check-ranking-policy.test.mjs"])]
});

blocked(["DM-09"], {
  summary: "A transaction-time seller/tax/fiat evidence model cannot be selected safely without counsel-approved product classifications and an approved rate/evidence source; production legal approval remains fail-closed.",
  affectedPaths: ["docs/v2-new-build/compliance/dac7-dac8-vat-system.md", "apps/api/src/modules/payment/payment-durable-confirmation.ts"],
  executions: [],
  externalPrerequisites: [{
    owner: "legal/tax owner and payments architecture owner",
    prerequisite: "Approve the seller-of-record/product/jurisdiction matrix and the official tax/fiat evidence provider or source, including correction and retention rules.",
    proofCommand: "Run product/jurisdiction fixtures through immutable quote, seller/tax determination, receipt/invoice, correction, and accounting-export staging journeys with counsel-approved expected outcomes.",
    failClosedState: "Production monetisation remains behind LEGAL_APPROVED and OPERATIONS_APPROVED; no tax-ready or invoice-ready claim may be made from placeholder/null facts."
  }]
});

unresolved(["AUTH-10"], {
  summary: "Feature-flag, report moderation, support case/policy, privacy request, and profile mutations now reserve durable actor/action/target/version/request-hash receipts, replay original responses after later writes, reject changed input or target reuse, isolate actors, and serialize concurrent retries; closure classification remains pending authorized evidence review.",
  affectedPaths: ["apps/api/src/shared/mutation-command-receipt.ts", "apps/api/src/modules/admin/admin-repository-feature-flag.ts", "apps/api/src/modules/admin/admin-repository-moderation.ts", "apps/api/src/modules/admin/admin-repository-privacy.ts", "apps/api/src/modules/admin/admin-repository-support.ts", "apps/api/src/modules/profile/profile-mutation-repository.ts", "packages/database/migrations/0128_mutation_command_receipts.sql"],
  executions: [
    unverifiedHistoricalExecution("executed focused real-PostgreSQL AUTH-10 integration selection (4/4 across eight mutation paths)", ["apps/api/test/mutation-command-idempotency.integration.test.ts"], "disposable migrated PostgreSQL"),
    unverifiedHistoricalExecution("executed migration 0128 down/up proof and canonical migration suite (101/101)", ["packages/database/migrations/0128_mutation_command_receipts.sql", "packages/database/migrations/0128_mutation_command_receipts.down.sql", "packages/database/test/migrations.test.ts"], "disposable migrated PostgreSQL"),
    unverifiedHistoricalExecution("executed focused AUTH-10 route conflict selection (2/2)", ["apps/api/test/app.test.ts"])
  ],
  residualWork: ["Obtain authorized final evidence review for disposition promotion; no implementation or release-gate bypass is implied by the focused passes."]
});

unresolved(["CONTENT-07"], {
  summary: "The remaining comments, notifications, Event Access passes, organization dashboards, Mutuals feed, and Mutuals list projections now use endpoint-scoped compound keysets over every ORDER BY field, derive the next cursor from the last visible row, and use lookahead only for has-more detection.",
  affectedPaths: ["apps/api/src/shared/keyset-pagination.ts", "apps/api/src/modules/engagement/engagement-comment-repository.ts", "apps/api/src/modules/notification/notification-repository.ts", "apps/api/src/modules/event/event-access-pass-methods.ts", "apps/api/src/modules/organization/organization-repository.ts", "apps/api/src/modules/mutuals/mutuals-repository.ts"],
  executions: [unverifiedHistoricalExecution("executed focused CONTENT-07 pagination selection (5/5 unit; 1/1 real PostgreSQL)", ["apps/api/test/pagination-authorities.test.ts", "apps/api/test/pagination-authorities.integration.test.ts"], "local Node.js 22.23.4 plus disposable migrated PostgreSQL")],
  residualWork: ["Obtain authorized final evidence review for disposition promotion; retain the existing release gates."]
});

unresolved(["CONTENT-08"], {
  summary: "Event create/update, feed-preference update, and live reserve/attach/create now project fresh RETURNING data without rereading the statement-start base-table snapshot, so the first persisted write returns its canonical projection.",
  affectedPaths: ["apps/api/src/modules/event/event-core-repository.ts", "apps/api/src/modules/live/live-room-repository.ts", "apps/api/src/modules/engagement/engagement-preferences-repository.ts"],
  executions: [unverifiedHistoricalExecution("executed focused first-call DML projection integration selection (1/1)", ["apps/api/test/repository-dml-projections.integration.test.ts"], "disposable fully migrated PostgreSQL")],
  residualWork: ["Obtain authorized final evidence review for disposition promotion; retain the existing release gates."]
});

unresolved(["CONTENT-10"], {
  summary: "Discover content signing improved, but creator directories, Mutuals, live-room reads, and chat-author projections still do not share one complete block/private/age/safety predicate.",
  affectedPaths: ["apps/api/src/modules/discover", "apps/api/src/modules/mutuals", "apps/api/src/modules/live"],
  executions: [],
  residualWork: ["Converge the remaining read/write surfaces on canonical eligibility and prove the cross-surface privacy matrix."]
});

unresolved(["CONTENT-14"], {
  summary: "Conversation, message, commercial-interaction, and creator-owned live-room repositories now expose bounded deterministic compound keysets, but the audit-requested over-limit database and client lazy-loading proof is not yet recorded.",
  affectedPaths: ["apps/api/src/modules/message/message-read-repository.ts", "apps/api/src/modules/message/message-commercial-repository.ts", "apps/api/src/modules/live/live-control-repository.ts"],
  executions: [],
  residualWork: ["Add and execute >50-message/commercial and >20-live-room real-PostgreSQL pagination walks plus browser/client lazy-loading coverage before promoting the disposition."]
});

unresolved(["CONTENT-16"], {
  summary: "Organization owner/admin membership mutation now rejects invited-to-active transitions; only the invitee acceptance authority may activate an invitation.",
  affectedPaths: ["apps/api/src/modules/organization/organization-repository.ts"],
  executions: [unverifiedHistoricalExecution("executed focused organization membership lifecycle selection", ["apps/api/test/organization-membership-lifecycle.test.ts"])],
  residualWork: ["Obtain authorized final evidence review for disposition promotion; retain the existing release gates."]
});

unresolved(["CONTENT-17"], {
  summary: "Some organization, management, performer, metadata, publish, and event commands still omit target identity/version from durable idempotency fingerprints.",
  affectedPaths: ["apps/api/src/modules/organization", "apps/api/src/modules/managed-creator", "apps/api/src/modules/performer"],
  executions: [],
  residualWork: ["Bind target/action/version and prove same-key same-body different-target conflicts across every affected command."]
});

unresolved(["CONTENT-18"], {
  summary: "The chronological feed now reads indexed keyset candidates in bounded 128-to-512-row batches, reauthorizes only those candidate IDs through the canonical eligible_content authority in the same repeatable-read transaction, advances denied batches without an arbitrary corpus ceiling, and excludes money signals; representative 100k+ native PostgreSQL measurements remain outstanding.",
  affectedPaths: ["apps/api/src/modules/content/content-feed-cursor.ts", "apps/api/src/modules/content/content-feed-repository.ts", "packages/database/migrations/0140_verification_policy_acl_age_attempt.sql", "scripts/check-ranking-policy.mjs"],
  executions: [
    unverifiedHistoricalExecution("executed focused chronological cursor/query-policy selection (15/15)", ["apps/api/test/content-feed-cursor.test.ts", "apps/api/test/content-feed-query-policy.test.ts"], "local Node.js 22.23.4")
  ],
  residualWork: ["Run native and staging EXPLAIN ANALYZE/load proof at 100k+ chronological candidates with realistic authorization graphs before claiming production-scale behavior.", "Obtain authorized final evidence review for disposition promotion; retain the existing release gates."]
});

unresolved(["PAY-12"], {
  summary: "Referral activity now pages stable individual share/commission events by an event-kind/event-id compound keyset from the last visible row, preserving equal-timestamp and multi-commission records across adjacent inserts.",
  affectedPaths: ["apps/api/src/modules/referral/referral-repository.ts", "apps/api/src/modules/referral/referral-routes.ts", "apps/api/src/modules/referral/types.ts", "packages/contracts/openapi.yaml"],
  executions: [unverifiedHistoricalExecution("executed focused PAY-12..15 API repository/unit selection (8/8)", ["apps/api/test/referral-pagination.test.ts", "apps/api/test/payment-submission-idempotency.test.ts", "apps/api/test/subscription-submission-idempotency.test.ts", "apps/api/test/subscription-list-pagination.test.ts"]), unverifiedHistoricalExecution("executed focused PAY-12..15 route selection (3/3)", ["apps/api/test/app.test.ts"]), unverifiedHistoricalExecution("executed OpenAPI schema selection (7/7); regeneration hash c6e104e1a92bf67871417706923f2f242901a6af5c87175ad0aa47495c3c5349", ["packages/contracts/src/openapi-schema.test.ts", "packages/contracts/src/generated/openapi.ts"])],
  residualWork: ["Obtain authorized final evidence review for disposition promotion; retain all payment release gates."]
});

unresolved(["PAY-13"], {
  summary: "Payment and subscription authorization submissions now bind durable actor/action/target/request receipts to the idempotency key, replay completed responses, reject changed signatures, and serialize concurrent retries without duplicate attempts.",
  affectedPaths: ["apps/api/src/modules/payment/payment-submission.ts", "apps/api/src/modules/payment/payment-intent-routes.ts", "apps/api/src/modules/subscription/subscription-authorization-verification-repository.ts", "apps/api/src/modules/subscription/subscription-routes.ts", "apps/api/src/shared/mutation-command-receipt.ts"],
  executions: [unverifiedHistoricalExecution("executed focused PAY-12..15 API repository/unit selection (8/8)", ["apps/api/test/payment-submission-idempotency.test.ts", "apps/api/test/subscription-submission-idempotency.test.ts"]), unverifiedHistoricalExecution("executed focused PAY-12..15 route selection (3/3)", ["apps/api/test/app.test.ts"]), unverifiedHistoricalExecution("executed OpenAPI schema selection (7/7)", ["packages/contracts/src/openapi-schema.test.ts"])],
  residualWork: ["Obtain authorized final evidence review for disposition promotion; recurring financial migrations and provider proof remain separately approval-gated."]
});

unresolved(["PAY-14"], {
  summary: "Subscription reads now project only a closed set of UI-safe failure categories, preserving actionable insufficient-funds, revoked-authorization, provider-unavailable, or setup-mismatch remediation without exposing raw provider details.",
  affectedPaths: ["apps/api/src/modules/subscription/subscription-repository.ts", "apps/api/src/modules/subscription/subscription-repository-mappers.ts", "apps/api/src/modules/subscription/types.ts", "packages/contracts/openapi.yaml"],
  executions: [unverifiedHistoricalExecution("executed focused PAY-12..15 API repository/unit selection (8/8)", ["apps/api/test/subscription-list-pagination.test.ts"]), unverifiedHistoricalExecution("executed OpenAPI schema selection (7/7)", ["packages/contracts/src/openapi-schema.test.ts"])],
  residualWork: ["Obtain authorized final evidence review for disposition promotion; retain all recurring-payment release gates."]
});

unresolved(["PAY-15"], {
  summary: "Plan listing is restricted to the bounded platform catalog, creator checkout uses the canonical creator-offer selector, and user subscriptions use bounded active/history and scope-filtered compound-keyset pages; the audit-requested ideal composite/partial indexes were intentionally not added without migration approval.",
  affectedPaths: ["apps/api/src/modules/subscription/subscription-repository.ts", "apps/api/src/modules/subscription/subscription-pagination.ts", "apps/api/src/modules/subscription/subscription-routes.ts", "apps/api/src/modules/subscription/types.ts", "packages/contracts/openapi.yaml"],
  executions: [unverifiedHistoricalExecution("executed focused PAY-12..15 API repository/unit selection (8/8)", ["apps/api/test/subscription-list-pagination.test.ts"]), unverifiedHistoricalExecution("executed focused PAY-12..15 route selection (3/3)", ["apps/api/test/app.test.ts"]), unverifiedHistoricalExecution("executed OpenAPI schema selection (7/7)", ["packages/contracts/src/openapi-schema.test.ts"])],
  residualWork: ["Obtain explicit migration approval, add the measured composite/partial indexes for the final bounded query shapes, and prove realistic-volume plans before promoting the disposition."]
});

unresolved(["FE-03"], {
  summary: "Phone Messages now preserves a real inbox state: the server no longer substitutes the first conversation, and Back clears selection instead of immediately reopening that thread.",
  affectedPaths: ["apps/web/app/app/messages/page.tsx", "apps/web/app/messages/messages-workspace.tsx", "apps/web/src/messages/conversation-selection.ts"],
  executions: [unverifiedHistoricalExecution("executed targeted frontend unit selection (25/25)", ["apps/web/src/messages/conversation-selection.test.ts"]), unverifiedHistoricalExecution("node node_modules/typescript/bin/tsc --noEmit -p apps/web/tsconfig.json", ["apps/web/tsconfig.json"])],
  residualWork: ["Execute the existing phone browser journey at the final tree and obtain authorized final evidence review for disposition promotion."]
});

unresolved(["FE-04"], {
  summary: "Reply state is conversation-scoped and the composer/commercial panel remount by selected conversation, so draft, attachment, retry, and reply state no longer silently crosses thread identity at the source boundary.",
  affectedPaths: ["apps/web/app/messages/messages-workspace.tsx", "apps/web/app/messages/message-composer.tsx", "apps/web/src/messages/conversation-selection.ts"],
  executions: [unverifiedHistoricalExecution("executed targeted frontend unit selection (25/25)", ["apps/web/src/messages/conversation-selection.test.ts"]), unverifiedHistoricalExecution("node node_modules/typescript/bin/tsc --noEmit -p apps/web/tsconfig.json", ["apps/web/tsconfig.json"])],
  residualWork: ["Add and execute a browser case for draft/attachment switching plus fast navigation during send before promoting the disposition."]
});

unresolved(["FE-05"], {
  summary: "Read attempts are keyed by conversation and visible unread range, so a successful first mark-read no longer suppresses later conversations or newly arrived messages at the source boundary.",
  affectedPaths: ["apps/web/app/messages/conversation-state-actions.tsx", "apps/web/src/messages/conversation-selection.ts"],
  executions: [unverifiedHistoricalExecution("executed targeted frontend unit selection (25/25)", ["apps/web/src/messages/conversation-selection.test.ts"]), unverifiedHistoricalExecution("node node_modules/typescript/bin/tsc --noEmit -p apps/web/tsconfig.json", ["apps/web/tsconfig.json"])],
  residualWork: ["Add and execute a browser case spanning multiple successfully read threads and a new arrival in the open thread before promoting the disposition."]
});

unresolved(["FE-07"], {
  summary: "Moment content and engagement children are keyed by content identity, resetting carousel, poll, and engagement-local state when the active Moment changes.",
  affectedPaths: ["apps/web/app/app/moments/moment-viewer.tsx"],
  executions: [unverifiedHistoricalExecution("node node_modules/typescript/bin/tsc --noEmit -p apps/web/tsconfig.json", ["apps/web/tsconfig.json"])],
  residualWork: ["Add and execute a two-Moment browser regression for carousel/poll/engagement state carryover before promoting the disposition."]
});

unresolved(["FE-08"], {
  summary: "Moment arrow shortcuts now ignore editable and interactive targets, IME composition, modified events, and already-prevented events.",
  affectedPaths: ["apps/web/app/app/moments/moment-viewer.tsx", "apps/web/src/navigation/global-shortcut-policy.ts"],
  executions: [unverifiedHistoricalExecution("executed targeted frontend unit selection (25/25)", ["apps/web/src/navigation/global-shortcut-policy.test.ts"]), unverifiedHistoricalExecution("node node_modules/typescript/bin/tsc --noEmit -p apps/web/tsconfig.json", ["apps/web/tsconfig.json"])],
  residualWork: ["Add and execute a real textarea-in-Moment browser assertion before promoting the disposition."]
});

unresolved(["FE-09"], {
  summary: "Composer restore no longer overwrites the saved snapshot before hydration and resumable upload identity is deterministic and asset-scoped, but the restored ContentItem still does not hydrate the ordered uploaded asset/status/session composition without file reselection.",
  affectedPaths: ["apps/web/app/create/image-composer.tsx", "apps/web/src/media/resumable-upload-key.ts"],
  executions: [unverifiedHistoricalExecution("executed targeted frontend unit selection (25/25)", ["apps/web/src/media/resumable-upload-key.test.ts"]), unverifiedHistoricalExecution("node node_modules/typescript/bin/tsc --noEmit -p apps/web/tsconfig.json", ["apps/web/tsconfig.json"])],
  residualWork: ["Hydrate server-owned ordered asset/status/session state and browser-prove restore before response, mid-transfer, after transfer, and after provider-ready without requiring file reselection."]
});

unresolved(["FE-10"], {
  summary: "Public/server config now rejects mainnet that inherits a devnet RPC, and the embedded provider chooses only a chain-matching official fallback endpoint.",
  affectedPaths: ["packages/config/src/public.ts", "packages/config/src/index.ts", "apps/web/src/public-env.ts", "apps/web/src/wallet/embedded-wallet-providers.tsx"],
  executions: [unverifiedHistoricalExecution("executed focused config and public-environment selection (52/52)", ["packages/config/src/index.test.ts", "apps/web/src/public-env.test.ts"]), unverifiedHistoricalExecution("node node_modules/typescript/bin/tsc --noEmit -p apps/web/tsconfig.json", ["apps/web/tsconfig.json"])],
  residualWork: ["Obtain authorized final evidence review for disposition promotion; production network/provider proof remains a separate release gate."]
});

unresolved(["FE-11"], {
  summary: "Checkout now mounts both wallet runtimes and provides external Wallet Adapter selection/retry, but the payment bridge still lacks an embedded-provider transaction-signing path for a freshly loaded login wallet.",
  affectedPaths: ["apps/web/src/payment-wallet-bridge.tsx", "apps/web/src/payment-wallet-runtime.tsx"],
  executions: [unverifiedHistoricalExecution("node node_modules/typescript/bin/tsc --noEmit -p apps/web/tsconfig.json", ["apps/web/tsconfig.json"])],
  residualWork: ["Add the noncustodial embedded-wallet transaction path through the approved provider SDK and browser-prove fresh-login checkout, rejection, retry, and backend-confirmed settlement."]
});

unresolved(["FE-12"], {
  summary: "The notification list now owns an actor-keyed active TanStack query, so the existing Realtime prefix invalidation has a live consumer instead of invalidating unobserved state.",
  affectedPaths: ["apps/web/app/app/notifications/notification-list.tsx", "apps/web/src/realtime-provider.tsx"],
  executions: [unverifiedHistoricalExecution("node node_modules/vitest/vitest.mjs run apps/web (28 files, 136 tests)", ["apps/web/app/app/notifications/notification-list.tsx", "apps/web/src/realtime-provider.tsx"]), unverifiedHistoricalExecution("node node_modules/typescript/bin/tsc --noEmit -p apps/web/tsconfig.json", ["apps/web/tsconfig.json"])],
  residualWork: ["Browser-prove realtime arrival, reconnect gap recovery, and account switch before promoting the disposition."]
});

unresolved(["FE-13"], {
  summary: "The app shell now exposes labelled Search, Notifications, and Wallet quick actions at phone and tablet breakpoints.",
  affectedPaths: ["apps/web/app/app-shell.tsx", "apps/web/app/styles/responsive.css"],
  executions: [unverifiedHistoricalExecution("node node_modules/typescript/bin/tsc --noEmit -p apps/web/tsconfig.json", ["apps/web/tsconfig.json"])],
  residualWork: ["Execute the existing phone quick-action browser journey at the final tree before promoting the disposition."]
});

unresolved(["FE-14"], {
  summary: "Own Profile uses canonical public stats, creator-local media tabs, and cursor-backed load-more through the existing content authority instead of a first-page-only local view.",
  affectedPaths: ["apps/web/app/app/profile/page.tsx", "apps/web/app/app/profile/profile-media-grid.tsx", "apps/web/src/api-client-read.ts"],
  executions: [unverifiedHistoricalExecution("node node_modules/vitest/vitest.mjs run apps/web (28 files, 136 tests)", ["apps/web/app/app/profile/profile-media-grid.tsx"]), unverifiedHistoricalExecution("node node_modules/typescript/bin/tsc --noEmit -p apps/web/tsconfig.json", ["apps/web/tsconfig.json"])],
  residualWork: ["Add and execute browser coverage for canonical counts, tab filters, and load-more exhaustion before promoting the disposition."]
});

unresolved(["FE-15"], {
  summary: "The feed evicts off-window cards behind measured spacers and bounds the rendered card window to 60 instead of retaining an unbounded component/DOM tree.",
  affectedPaths: ["apps/web/app/app/feed-experience.tsx", "apps/web/src/feed/bounded-feed-window.ts"],
  executions: [unverifiedHistoricalExecution("executed targeted frontend unit selection (25/25)", ["apps/web/src/feed/bounded-feed-window.test.ts"]), unverifiedHistoricalExecution("node node_modules/typescript/bin/tsc --noEmit -p apps/web/tsconfig.json", ["apps/web/tsconfig.json"])],
  residualWork: ["Run a long-session constrained-device browser/performance proof before promoting the disposition or claiming production-scale UX."]
});

unresolved(["FE-16"], {
  summary: "Both themes now provide contrast-safe strong-accent/on-solid tokens and audited solid-accent controls use them instead of low-contrast foreground combinations.",
  affectedPaths: ["apps/web/app/styles/tokens-base.css", "apps/web/src/theme-contrast.test.ts", "apps/web/app/app/settings/content-preference-control.tsx"],
  executions: [unverifiedHistoricalExecution("executed targeted frontend unit selection (25/25)", ["apps/web/src/theme-contrast.test.ts"]), unverifiedHistoricalExecution("node node_modules/typescript/bin/tsc --noEmit -p apps/web/tsconfig.json", ["apps/web/tsconfig.json"])],
  residualWork: ["Browser/axe-prove both themes and selected, error, focus, and transient states before promoting the disposition."]
});

unresolved(["FE-18"], {
  summary: "The generic admin section still truncates records and primitive fields, auto-selects the first organization, and lacks typed pagination/detail/reason-required operations across several critical sections.",
  affectedPaths: ["apps/web/app/admin/[section]/page.tsx", "apps/web/app/admin/admin-shell.tsx"],
  executions: [],
  residualWork: ["Replace generic truncation with typed bounded pagination/detail/action surfaces for content, safety, live, providers, privacy, and organization operations, then browser-prove authorized and denied actions."]
});

unresolved(["FE-19"], {
  summary: "The admin shell now establishes a viewport-height vertical scroll owner under the globally hidden body overflow, but the rendered keyboard/viewport behavior has not been proven.",
  affectedPaths: ["apps/web/app/admin/admin-shell.tsx"],
  executions: [unverifiedHistoricalExecution("node node_modules/typescript/bin/tsc --noEmit -p apps/web/tsconfig.json", ["apps/web/tsconfig.json"])],
  residualWork: ["Execute authenticated 360x640 and desktop keyboard-scroll browser proof before promoting the disposition."]
});

unresolved(["FE-21"], {
  summary: "The Follow control no longer resynchronizes stale initial props when pending ends, so a successful local follow/unfollow mutation survives completion.",
  affectedPaths: ["apps/web/app/follow-button.tsx"],
  executions: [unverifiedHistoricalExecution("node node_modules/typescript/bin/tsc --noEmit -p apps/web/tsconfig.json", ["apps/web/tsconfig.json"])],
  residualWork: ["Execute the existing follow-to-unfollow browser flow at the final tree, including public Profile, before promoting the disposition."]
});

unresolved(["FE-22"], {
  summary: "Settings now provides validated profile/avatar editing through the existing mutations, and the Mutuals destination is truthfully labelled as viewing connections rather than a nonexistent privacy-management workflow.",
  affectedPaths: ["apps/web/app/app/settings/profile-editor.tsx", "apps/web/app/app/settings/page.tsx", "apps/web/app/app/settings/privacy-controls.tsx"],
  executions: [unverifiedHistoricalExecution("node node_modules/vitest/vitest.mjs run apps/web (28 files, 136 tests)", ["apps/web/app/app/settings/profile-editor.tsx", "apps/web/app/app/settings/privacy-controls.tsx"]), unverifiedHistoricalExecution("node node_modules/typescript/bin/tsc --noEmit -p apps/web/tsconfig.json", ["apps/web/tsconfig.json"])],
  residualWork: ["Browser-prove profile save/avatar failure handling and the corrected Mutuals destination copy before promoting the disposition."]
});

unresolved(["FE-23"], {
  summary: "Frontend authorities now route provider/state/route ownership to frontend-architecture and the route map, while mockups and narrow design/copy/motion documents are explicitly non-competing references.",
  affectedPaths: ["docs/v2-new-build/frontend-architecture.md", "docs/v2-new-build/frontend/component-map.md", "docs/v2-new-build/frontend/copy-system.md", "docs/v2-new-build/frontend/design-system.md", "docs/v2-new-build/frontend/motion-system.md", "docs/v2-new-build/frontend/ui-kit-lock.md", "docs/v2-new-build/native-ui-ux-screens.md", "apps/web/public/mockup/design.md", "apps/web/README.md"],
  executions: [unverifiedHistoricalExecution("node scripts/check-docs.mjs", ["scripts/check-docs.mjs"])],
  residualWork: ["Obtain authorized final evidence review for disposition promotion; no runtime or release claim follows from documentation consistency alone."]
});

unresolved(["FE-24"], {
  summary: "Creator Membership checkout now lazy-loads a runtime that mounts WalletRuntimeProviders around the authorization panel, removing the named missing-provider-context failure.",
  affectedPaths: ["apps/web/app/profile/[handle]/creator-membership-checkout.tsx", "apps/web/app/profile/[handle]/creator-membership-runtime.tsx", "apps/web/app/profile/[handle]/page.tsx"],
  executions: [unverifiedHistoricalExecution("node node_modules/typescript/bin/tsc --noEmit -p apps/web/tsconfig.json", ["apps/web/tsconfig.json"])],
  residualWork: ["Add and execute a fresh-browser creator Membership provider-context journey before promoting the disposition; embedded payment signing remains the separate FE-11 residual."]
});

unresolved(["DB-04"], {
  summary: "The ordered immutable migration chain is now the only routed database-shape authority; the conceptual schema blueprint is retained and conspicuously labelled non-authoritative historical planning material.",
  affectedPaths: ["packages/database/schema-blueprint.sql", "docs/v2-new-build/INDEX.md", "docs/v2-new-build/contracts-and-schema.md"],
  executions: [unverifiedHistoricalExecution("node scripts/check-docs.mjs", ["scripts/check-docs.mjs", "packages/database/README.md"])],
  residualWork: ["Obtain authorized final evidence review for disposition promotion; exact database shape continues to require the migration and real-PostgreSQL gates."]
});

unresolved(["DB-06"], {
  summary: "A guarded pre-upgrade bridge now classifies and repairs only the three exact legacy CHECK-constraint shapes before immutable migration 0046/0056/0077 runs; a populated 0045-prefix database reached 0128 with final rejected/both/access_pass_granted values and constraints that reject the legacy vocabulary.",
  affectedPaths: ["scripts/legacy-migration-bridge.mjs", "scripts/apply-legacy-migration-bridge.mjs", "scripts/legacy-migration-bridge.test.mjs", "packages/database/pre-upgrade/legacy-check-constraint-bridge.sql", "packages/database/README.md"],
  executions: [
    unverifiedHistoricalExecution("executed manual populated legacy-upgrade proof: immutable 0001-0045 prefix, exact 0046/0056/0077 classification, guarded bridge apply, then immutable 0046-0128 forward chain and final legacy-value refusal", ["packages/database/pre-upgrade/legacy-check-constraint-bridge.sql", "packages/database/README.md"], "disposable local PostgreSQL 14 database wevid_db06_prefix on 127.0.0.1:55438"),
    unverifiedHistoricalExecution("executed legacy migration bridge test selection (3/3)", ["scripts/legacy-migration-bridge.test.mjs"])
  ],
  residualWork: ["Obtain authorized final evidence review for disposition promotion; production/staging upgrade remains operator-controlled and must use the guarded check/apply workflow."]
});

unresolved(["SUP-01"], {
  summary: "The enterprise script is now explicitly a projection smoke and never emits provider approval; exact-release staging acceptance requires separately registered, current, subject/environment-bound enterprise evidence.",
  affectedPaths: ["apps/api/scripts/prove-enterprise-managed-creators.mjs", "scripts/staging-proof-plan.mjs", "scripts/staging-acceptance-status.mjs"],
  executions: [unverifiedHistoricalExecution("executed enterprise projection proof selection (3/3)", ["scripts/enterprise-projection-proof.test.mjs"])],
  residualWork: ["Obtain authorized final evidence review for disposition promotion; real Enterprise/KYB provider evidence remains an external release prerequisite."]
});

unresolved(["INT-03"], {
  summary: "The long integration journey now allocates per-run identities/tokens/wallet fixtures and uses an advisory journey lock; the global recipient-policy test has its own advisory lock and guarded database target, teardown follows FK order, and two independent full-suite processes completed against one migrated database.",
  affectedPaths: ["apps/api/test/authenticated-happy-path.integration.test.ts", "apps/api/test/policy-content-eligibility.integration.test.ts", "apps/api/test/integration-database.ts"],
  executions: [
    unverifiedHistoricalExecution("executed full authenticated integration suite after isolation/teardown corrections (4/4; 26.73s)", ["apps/api/test/authenticated-happy-path.integration.test.ts"], "disposable fully migrated PostgreSQL"),
    unverifiedHistoricalExecution("executed two independent full-suite processes concurrently against one migrated database (process A 4/4 in 36.08s; process B 4/4 in 42.61s; advisory lock serialized exhaustive journeys and teardown completed)", ["apps/api/test/authenticated-happy-path.integration.test.ts", "apps/api/test/policy-content-eligibility.integration.test.ts"], "shared disposable fully migrated PostgreSQL"),
    unverifiedHistoricalExecution("executed authenticated happy path and recipient-policy suite concurrently against one migrated database (happy path 4/4 in 26.62s; policy 1/1 in 3.34s)", ["apps/api/test/authenticated-happy-path.integration.test.ts", "apps/api/test/policy-content-eligibility.integration.test.ts"], "shared disposable fully migrated PostgreSQL"),
    unverifiedHistoricalExecution("executed static integration-suite policy selection (3/3)", ["scripts/api-integration-suite.test.mjs"])
  ],
  residualWork: ["Obtain authorized final evidence review for disposition promotion; no release gate is weakened by local concurrency proof."]
});

unresolved(["D-01"], {
  summary: "The docs index now routes current architecture to one system map plus ADRs and narrow domain authorities; queue, analytics, and OpenAPI generation direction match the implemented runtime, while broad blueprints and diagrams are explicitly orientation-only.",
  affectedPaths: ["docs/v2-new-build/INDEX.md", "docs/v2-new-build/app-architecture.md", "docs/v2-new-build/backend-fastify-architecture.md", "docs/v2-new-build/infra-decisions.md", "docs/v2-new-build/full-platform-blueprint.md", "docs/v2-new-build/diagrams.md"],
  executions: [unverifiedHistoricalExecution("node scripts/check-docs.mjs", ["scripts/check-docs.mjs"])],
  residualWork: ["Obtain authorized final evidence review for disposition promotion; implementation and provider authorities remain narrower than architecture prose."]
});

unresolved(["D-08"], {
  summary: "Every active router now defers exact database shape to the immutable migration chain and labels schema-blueprint.sql as historical non-authoritative planning material.",
  affectedPaths: ["docs/v2-new-build/INDEX.md", "docs/v2-new-build/contracts-and-schema.md", "packages/database/schema-blueprint.sql", "packages/database/README.md"],
  executions: [unverifiedHistoricalExecution("node scripts/check-docs.mjs", ["scripts/check-docs.mjs"])],
  residualWork: ["Obtain authorized final evidence review for disposition promotion; schema claims still require executable migration/catalog proof."]
});

unresolved(["D-09"], {
  summary: "The route map now separates page-entry requirements from protected-data policy, records anonymous Safe profile/content entry and remediation routes, includes canonical content detail, and labels phase as grouping rather than readiness evidence.",
  affectedPaths: ["docs/v2-new-build/route-map.md"],
  executions: [unverifiedHistoricalExecution("node scripts/check-docs.mjs", ["scripts/check-docs.mjs"])],
  residualWork: ["Obtain authorized final evidence review for disposition promotion; final route-guard/browser proof remains independent of documentation consistency."]
});

unresolved(["D-13"], {
  summary: "Staging acceptance no longer stores unbound PASS results, but the protected current implementation status still contains stale migration, landing-modal, Enterprise, creator-eligibility, and historical branch-authority statements.",
  affectedPaths: ["docs/v2-new-build/current-implementation-status.md", "docs/v2-new-build/operator/staging-acceptance.json", "docs/v2-new-build/operator/staging-acceptance.md"],
  executions: [],
  residualWork: ["Reconcile the protected merged-status authority at the correct final baseline and remove the remaining stale current-state assertions without inventing branch or release evidence."]
});

unresolved(["DM-06"], {
  summary: "The liability gap matrix is now an explicitly dated archived planning snapshot, routes current implementation to the protected status authority, includes Ultra, and distinguishes individual Studio from organization-scoped Enterprise.",
  affectedPaths: ["docs/v2-new-build/liability-compliance-audit.md"],
  executions: [unverifiedHistoricalExecution("node scripts/check-docs.mjs", ["scripts/check-docs.mjs"])],
  residualWork: ["Obtain authorized final evidence review for disposition promotion; D-13's protected-status conflicts remain separately open."]
});

unresolved(["DM-10"], {
  summary: "Event Access routes now defer to the route map/OpenAPI, implemented and deferred surfaces are explicit, and pass types alone own price, currency, capacity, limits, and sale windows.",
  affectedPaths: ["docs/v2-new-build/product/event-access.md", "docs/v2-new-build/route-map.md", "packages/contracts/openapi.yaml"],
  executions: [unverifiedHistoricalExecution("node scripts/check-docs.mjs", ["scripts/check-docs.mjs"])],
  residualWork: ["Obtain authorized final evidence review for disposition promotion; deferred reissue/offline/admin capabilities remain non-advertised until implemented."]
});

unresolved(["DM-11"], {
  summary: "Payments documentation now states that current code resolves one supplied active referral token and labels Partner-over-Invite-over-Share precedence, Invite entities, campaign caps, and broader product eligibility as planned rather than implemented.",
  affectedPaths: ["docs/v2-new-build/payments-and-monetisation.md", "docs/v2-new-build/business-monetisation.md"],
  executions: [unverifiedHistoricalExecution("node scripts/check-docs.mjs", ["scripts/check-docs.mjs"])],
  residualWork: ["Obtain authorized final evidence review for disposition promotion; advanced referral policy remains out of current runtime scope."]
});

unresolved(["DM-13"], {
  summary: "The payments authority now publishes an exact per-product SOL/configured-SPL capability matrix and states that a new asset requires stored mint/decimals, composition, verification, receipt, UI, and failure-path evidence rather than a dropdown.",
  affectedPaths: ["docs/v2-new-build/payments-and-monetisation.md"],
  executions: [unverifiedHistoricalExecution("node scripts/check-docs.mjs", ["scripts/check-docs.mjs"])],
  residualWork: ["Obtain authorized final evidence review for disposition promotion; unsupported asset/product combinations remain explicitly unsupported."]
});

unresolved(["DM-14"], {
  summary: "Referral language is now bounded to the platform-fee quote basis known at purchase time and explicitly says future refunds or later tax corrections are not automatically clawed back or netted by the noncustodial split.",
  affectedPaths: ["docs/v2-new-build/payments-and-monetisation.md", "docs/v2-new-build/business-monetisation.md"],
  executions: [unverifiedHistoricalExecution("node scripts/check-docs.mjs", ["scripts/check-docs.mjs"])],
  residualWork: ["Obtain authorized final evidence review for disposition promotion; any append-only refund/tax remedy still requires approved legal and accounting policy."]
});

unresolved(["DM-15"], {
  summary: "The payments document now separates code/automated evidence from final-commit real-PostgreSQL, browser, provider, legal, and operations proof, and records recurring and tax boundaries as disabled or foundations-only instead of blanket launch claims.",
  affectedPaths: ["docs/v2-new-build/payments-and-monetisation.md", "docs/v2-new-build/current-implementation-status.md"],
  executions: [unverifiedHistoricalExecution("node scripts/check-docs.mjs", ["scripts/check-docs.mjs"])],
  residualWork: ["Obtain authorized final evidence review for disposition promotion; D-13's stale protected-status statements and all provider/legal/operations gates remain separately open."]
});

const supplementalFindings = Object.freeze([
  {
    id: "PR134-001",
    title: "Generated audit evidence is not reproducible after commit",
    domain: "audit-evidence-integrity",
    relatedBaselineIds: ["D-13"],
    affectedPaths: [ledgerPath, manifestPath, "scripts/generate-audit-evidence.mjs"],
    source: { sourceKey: "continuationInstruction", startLine: 28, endLine: 35 },
    summary: "The committed artifacts embed mutable branch/HEAD/worktree state and include generated-ledger bytes in their source fingerprint, so committing the outputs invalidates the next check.",
    residualWork: ["Prove deterministic generation and --check from a fresh committed checkout, with the final commit association stored outside the recursive artifacts."]
  },
  {
    id: "PR134-002",
    title: "Sensitive canonical tables remain readable through over-broad database authority",
    domain: "database-rls-schema-migrations",
    relatedBaselineIds: ["DB-01"],
    affectedPaths: ["packages/database/migrations/0120_data_api_server_authority.sql"],
    source: { sourceKey: "continuationInstruction", startLine: 39, endLine: 42 },
    summary: "The follow-up review reports retained cross-user access to provider identity, app-session, recovery, and verification authorities under staff-linked or legacy grants.",
    residualWork: ["Complete final-catalog grant, policy, function, default-privilege, and role-specific native PostgreSQL proof before restoring DB-01 to fixed."]
  },
  {
    id: "PR134-003",
    title: "Verification consumers disagree about the canonical current decision",
    domain: "authentication-verification-admin-mcp",
    relatedBaselineIds: ["AUTH-01", "AUTH-05", "CONTENT-20"],
    affectedPaths: ["apps/api/src/modules/verification", "apps/api/src/modules/age", "apps/api/src/modules/content", "apps/api/src/modules/organization"],
    source: { sourceKey: "continuationInstruction", startLine: 44, endLine: 49 },
    summary: "Some consumers select historical valid verification rows before selecting the current decision, and adult-publisher evidence can omit the threshold fact required by downstream release checks.",
    residualWork: ["Use one adverse-first current-decision authority and prove age, KYC, KYB, performer, publication, reporting, and admin behavior across replacement and revocation histories."]
  },
  {
    id: "PR134-004",
    title: "Organization owner mutation SQL has an untyped JSON parameter failure",
    domain: "authentication-verification-admin-mcp",
    relatedBaselineIds: ["AUTH-20"],
    affectedPaths: ["apps/api/src/modules/admin/admin-repository-organization.ts"],
    source: { sourceKey: "continuationInstruction", startLine: 54, endLine: 55 },
    summary: "The follow-up native SQL reproduction raises PostgreSQL 42P18 in jsonb_build_object before the last-owner invariant can be exercised.",
    residualWork: ["Type the SQL parameters explicitly and rerun native concurrent demotion, removal, revocation, replay, and rollback cases."]
  },
  {
    id: "PR134-005",
    title: "Timestamp cursors lose PostgreSQL microseconds",
    domain: "api-pagination",
    relatedBaselineIds: ["AUTH-11", "CONTENT-07", "CONTENT-14", "PAY-12", "PAY-15", "RES-04"],
    affectedPaths: ["apps/api/src/shared/keyset-pagination.ts", "apps/api/src/modules/admin", "apps/api/src/modules/message", "apps/api/src/modules/subscription"],
    source: { sourceKey: "continuationInstruction", startLine: 62, endLine: 70 },
    summary: "Date.toISOString truncates PostgreSQL ordering precision, so a continuation can skip rows whose timestamps differ only below the millisecond boundary.",
    residualWork: ["Preserve or deliberately normalize ordering precision end to end and prove complete multi-page walks in native PostgreSQL plus client continuation."]
  },
  {
    id: "PR134-006",
    title: "Payment email renders atomic token units as whole assets",
    domain: "payments-subscriptions-receipts-referrals",
    relatedBaselineIds: ["PAY-09"],
    affectedPaths: ["apps/worker/src/payment-confirmation-email.ts", "apps/web/src/format-asset-amount.ts"],
    source: { sourceKey: "continuationInstruction", startLine: 76, endLine: 77 },
    summary: "The worker email path does not use an exact environment-neutral asset formatter and can render one SOL or USDC as its raw atomic integer.",
    residualWork: ["Use authoritative asset decimals with string/BigInt arithmetic and capture text and HTML test receipts for fractional and large values."]
  },
  {
    id: "PR134-007",
    title: "Accepted pending chain evidence lacks durable status progression",
    domain: "payments-subscriptions-receipts-referrals",
    relatedBaselineIds: ["PAY-13", "PAY-17"],
    affectedPaths: ["apps/api/src/modules/payment", "apps/api/src/modules/subscription", "apps/worker/src/subscription-collections.ts"],
    source: { sourceKey: "continuationInstruction", startLine: 79, endLine: 82 },
    summary: "Immutable command replay can freeze a retryable pending observation when no canonical reconciliation job advances the already accepted signature and terms.",
    residualWork: ["Persist bounded reconciliation, distinguish pending from terminal failure, fence side effects, and prove crash/retry/concurrency progression without a new logical key."]
  },
  {
    id: "PR134-008",
    title: "Opening a second tab can erase another valid offline message queue",
    domain: "frontend-client-privacy-product",
    relatedBaselineIds: ["FE-01", "FE-02"],
    affectedPaths: ["apps/web/src/messages/offline-message-queue.ts", "apps/web/app/messages/message-composer.tsx"],
    source: { sourceKey: "continuationInstruction", startLine: 101, endLine: 102 },
    summary: "The per-tab session marker can trigger global actor outbox clearing when another same-account tab owns valid queued work.",
    residualWork: ["Define actor/auth-session/tab ownership and browser-prove reload, two tabs, account switch, logout, leases, retries, and slow delivery."]
  },
  {
    id: "PR134-009",
    title: "Feed window eviction has no reverse rehydration path",
    domain: "frontend-client-privacy-product",
    relatedBaselineIds: ["CONTENT-18", "FE-15"],
    affectedPaths: ["apps/web/app/app/feed-experience.tsx", "apps/web/src/feed/bounded-feed-window.ts", "apps/api/src/modules/content/content-feed-repository.ts"],
    source: { sourceKey: "continuationInstruction", startLine: 104, endLine: 105 },
    summary: "The bounded card helper replaces evicted content with a blank spacer but cannot load it again when the user scrolls backward.",
    residualWork: ["Provide bidirectional page/window restoration and representative large-corpus query, DOM, memory, and long-scroll evidence."]
  },
  {
    id: "PR134-010",
    title: "Mounted image state does not absorb renewed signed resources",
    domain: "frontend-client-privacy-product",
    relatedBaselineIds: ["CONTENT-19"],
    affectedPaths: ["apps/web/app/content/content-renderer.tsx", "apps/web/app/app/feed-experience.tsx", "apps/web/app/app/moments/moment-viewer.tsx"],
    source: { sourceKey: "continuationInstruction", startLine: 107, endLine: 108 },
    summary: "A router refresh can fetch renewed media while mounted feed and Moment state continues to render the initial signed resource.",
    residualWork: ["Merge renewed keyed media into mounted state without losing pages or scroll and prove expiry, revocation, account switch, and retry-storm boundaries."]
  },
  {
    id: "PR134-011",
    title: "Large-video checksum calculation buffers the whole file",
    domain: "content-discovery-social-live-messages-organizations",
    relatedBaselineIds: ["CONTENT-02", "CONTENT-03", "FE-09"],
    affectedPaths: ["apps/web/src/media", "apps/web/app/create"],
    source: { sourceKey: "continuationInstruction", startLine: 110, endLine: 111 },
    summary: "The current checksum helper calls arrayBuffer for an allowed multi-gigabyte upload before TUS, creating an unbounded main-thread memory boundary.",
    residualWork: ["Use a maintained bounded-memory or provider-supported checksum boundary and measure representative phone memory, responsiveness, resume, cancellation, and conflict behavior."]
  },
  {
    id: "PR134-012",
    title: "Email transport lacks a total response deadline and can stall later worker queues",
    domain: "workers-notifications-analytics",
    relatedBaselineIds: ["PAY-07", "PAY-08"],
    affectedPaths: ["apps/worker/src/payment-confirmation-email.ts", "apps/worker/src/index.ts"],
    source: { sourceKey: "continuationInstruction", startLine: 116, endLine: 117 },
    summary: "A bounded request is insufficient when response-body consumption can hang the sequential worker tick past its lease and fairness budget.",
    residualWork: ["Bound transport and body time, preserve idempotency/fencing, and prove retries, dead letters, and progress of unrelated queues during stalls."]
  },
  {
    id: "PR134-013",
    title: "The pending media-scope migration cannot upgrade populated preferences",
    domain: "database-rls-schema-migrations",
    relatedBaselineIds: ["DB-06", "MIGTEST-GAP-01", "ROLLBACK-01"],
    affectedPaths: ["packages/database/migrations/0130_media_core_scope_transition.sql", "packages/database/test/rollbacks.integration.test.ts"],
    source: { sourceKey: "closureDoubleCheck", startLine: 34, endLine: 35 },
    summary: "The reviewed 0130 order writes latest while the old recommended/following CHECK is still effective, aborting an ordinary populated upgrade with SQLSTATE 23514.",
    residualWork: ["Retain native populated 0129-to-current, rollback/reapply, and legacy-value refusal evidence; confirm no retained/shared environment applied different 0130 bytes before deployment."]
  },
  {
    id: "PR134-014",
    title: "Canonical identity session and recovery tables retain broad browser-role access",
    domain: "database-rls-schema-migrations",
    relatedBaselineIds: ["DB-01", "AUTH-01"],
    affectedPaths: ["packages/database/migrations/0133_canonical_identity_data_api_authority.sql", "apps/api/test/data-api-authority.integration.test.ts"],
    source: { sourceKey: "closureDoubleCheck", startLine: 37, endLine: 38 },
    summary: "Low-privilege staff and retained legacy grants can expose cross-user identity links and opaque session/recovery metadata through direct Data API authority.",
    residualWork: ["Preserve native effective-catalog and role-matrix proof, including retained grants, global future-function defaults, legitimate reviewed helpers, and no plaintext-credential overclaim."]
  },
  {
    id: "PR134-015",
    title: "Current verification decisions still diverge across consumers",
    domain: "authentication-verification-admin-mcp",
    relatedBaselineIds: ["AUTH-05", "CONTENT-20"],
    affectedPaths: ["packages/database/migrations/0134_canonical_current_verification_decision.sql", "apps/api/src/modules/verification", "apps/api/src/modules/age", "apps/api/src/modules/profile", "apps/api/src/modules/organization"],
    source: { sourceKey: "closureDoubleCheck", startLine: 40, endLine: 41 },
    summary: "Historical-valid-first queries can disagree with the current adverse or expired verification decision across onboarding, earning, KYB, performer, content, and admin consumers.",
    residualWork: ["Use one authenticated-event-time, provenance-aware selector and deterministic adverse-first tie policy across every actual consumer, then retain native transition and delayed-event proof."]
  },
  {
    id: "PR134-016",
    title: "Adult publisher approval lacks a trustworthy age fact consumed by release policy",
    domain: "authentication-verification-admin-mcp",
    relatedBaselineIds: ["AUTH-05", "CONTENT-20"],
    affectedPaths: ["apps/api/src/modules/verification/verification-repository.ts", "apps/api/src/modules/performer", "apps/api/src/modules/content/content-safety-repository.ts"],
    source: { sourceKey: "closureDoubleCheck", startLine: 43, endLine: 44 },
    summary: "Adult-purpose approval records omit the threshold fact required by performer and publication eligibility, while document/liveness/face facts alone cannot establish age.",
    residualWork: ["Obtain explicit authorization for the production-impacting policy migration, then require linked current authenticated adult and over-18 evidence through normalized provider outcome, performer release, exact revision, and publication denial/revocation tests."]
  },
  {
    id: "PR134-017",
    title: "Age and identity provider attempts cannot resume after ambiguous creation",
    domain: "authentication-verification-admin-mcp",
    relatedBaselineIds: ["AUTH-05", "RES-05"],
    affectedPaths: ["apps/api/src/modules/age", "apps/api/src/modules/verification", "packages/contracts/openapi.yaml"],
    source: { sourceKey: "closureDoubleCheck", startLine: 46, endLine: 47 },
    summary: "An identical reservation conflicts, a new key can start another remote session, and no authenticated current-attempt status/resume/reconciliation route persists a lost launch response.",
    residualWork: ["Persist and return one active logical handoff, keep ambiguous creation reconciling without provider shopping, and use authenticated provider results for recovery and Yoti tied/reversed notification arbitration."]
  },
  {
    id: "PR134-018",
    title: "A lost payment acknowledgement can prompt a second wallet transfer",
    domain: "payments-subscriptions-receipts-referrals",
    relatedBaselineIds: ["PAY-13", "PAY-17"],
    affectedPaths: ["apps/web/src/payment-wallet-bridge.tsx", "apps/web/src/payment-submission-recovery.ts", "apps/api/src/modules/payment"],
    source: { sourceKey: "closureDoubleCheck", startLine: 49, endLine: 50 },
    summary: "The reviewed browser loses an already-broadcast signature when WeVid acknowledgement fails, then allows a retry to build and sign another transfer for the same intent.",
    residualWork: ["Retain exact signed bytes/signature/actor/wallet/intent/terms before acknowledgement, recover only that attempt across reload/tabs, and keep real devnet/mobile-wallet/indexer proof separate."]
  },
  {
    id: "PR134-019",
    title: "Feed restoration can overwrite fresh authorization with stale resources",
    domain: "frontend-client-privacy-product",
    relatedBaselineIds: ["CONTENT-19", "FE-15"],
    affectedPaths: ["apps/web/app/app/feed-experience.tsx", "apps/web/src/feed/authorized-feed-view-restore.ts"],
    source: { sourceKey: "closureDoubleCheck", startLine: 52, endLine: 53 },
    summary: "A cached full page can replace newly authorized server data after sensitivity, hide, block, unpublish, release, or account-policy changes.",
    residualWork: ["Cache only bounded view identity/geometry and reauthorize current visible IDs before rendering; retain browser proof for preference, hide, block, unpublish, and no-forbidden-flash cases."]
  },
  {
    id: "PR134-020",
    title: "Historical poll replay can expose a current private projection",
    domain: "content-discovery-social-live-messages-organizations",
    relatedBaselineIds: ["CONTENT-07", "AUTH-05"],
    affectedPaths: ["apps/api/src/modules/content/content-poll-repository.ts", "apps/api/test/app.test.ts"],
    source: { sourceKey: "closureDoubleCheck", startLine: 55, endLine: 56 },
    summary: "A completed vote receipt authorizes reading the current question/options/counts without current content visibility or eligibility.",
    residualWork: ["Require fresh canonical eligibility for current projection or return only an immutable retained receipt; keep new voting and editing retired."]
  },
  {
    id: "PR134-021",
    title: "Paid member owner and live playback resources cannot renew",
    domain: "frontend-client-privacy-product",
    relatedBaselineIds: ["CONTENT-19", "FE-15"],
    affectedPaths: ["apps/web/app/content/content-renderer.tsx", "apps/web/app/provider-playback.tsx", "apps/web/app/live"],
    source: { sourceKey: "closureDoubleCheck", startLine: 58, endLine: 59 },
    summary: "Signed playback expiry renewal is reachable only when a public usage allowance exists, excluding legitimate paid, member, owner, and live resources.",
    residualWork: ["Keep authorization renewal independent from allowance reservation, coalesce keyed retries, honor denial immediately, and retain actual provider/device proof as a separate gate."]
  },
  {
    id: "PR134-022",
    title: "Browser camera credentials outlive application session changes",
    domain: "frontend-client-privacy-product",
    relatedBaselineIds: ["CONTENT-20", "FE-09"],
    affectedPaths: ["apps/web/app/app/live/[liveRoomId]/live-host-workspace.tsx", "apps/web/src/session/user-scope-invalidation.ts"],
    source: { sourceKey: "closureDoubleCheck", startLine: 61, endLine: 62 },
    summary: "Exposed host capture state and ingest credentials are not cleared on cross-tab logout, account switch, revoked app session, or owner loss.",
    residualWork: ["Retain browser cleanup regressions and document that provider ingest suspension/rotation/expiry and advanced OBS lifetime require distinct real-provider evidence."]
  },
  {
    id: "PR134-023",
    title: "Chronological feed still performs whole-corpus eligibility work",
    domain: "content-discovery-social-live-messages-organizations",
    relatedBaselineIds: ["CONTENT-14", "CONTENT-18"],
    affectedPaths: ["apps/api/src/modules/content/content-feed-repository.ts", "apps/api/test/content-feed-query-policy.test.ts"],
    source: { sourceKey: "closureDoubleCheck", startLine: 64, endLine: 65 },
    summary: "The reviewed query materializes all eligible content before applying its page limit, so chronological ordering alone does not bound canonical policy work.",
    residualWork: ["Keep bounded indexed candidate/keyset selection plus canonical fresh eligibility, and capture representative native plans, p95/p99 latency, and memory before any scalability claim."]
  },
  {
    id: "PR134-024",
    title: "Private avatars and creator-original export remain incomplete",
    domain: "frontend-client-privacy-product",
    relatedBaselineIds: ["CONTENT-03", "FE-09", "RES-05"],
    affectedPaths: ["apps/api/src/modules/profile", "apps/api/src/modules/engagement", "apps/worker/src", "apps/web/app/app/settings"],
    source: { sourceKey: "closureDoubleCheck", startLine: 67, endLine: 68 },
    summary: "Avatar writes fail closed without the requested private lifecycle, while data-request tracking has no usable revision-pinned creator archive, protected delivery, cleanup, or restore path.",
    residualWork: ["Implement or explicitly defer both accepted boundaries with private originals, current-owner access, bounded worker processing, replacement/expiry cleanup, and no third-party PII or identity evidence."]
  },
  {
    id: "PR134-025",
    title: "Closure evidence is stale and original inputs are not reconciled",
    domain: "audit-evidence-integrity",
    relatedBaselineIds: ["D-13"],
    affectedPaths: [ledgerPath, manifestPath, `${evidenceDirectory}/audit-inputs`, "scripts/generate-audit-evidence.mjs"],
    source: { sourceKey: "closureDoubleCheck", startLine: 70, endLine: 71 },
    summary: "The reviewed generated files are stale, the supplied original inputs are absent, unresolved and pending coverage remains, and no trusted attestation exists.",
    residualWork: ["Validate and track supplied inputs, regenerate exact index-bound working artifacts, preserve unresolved coverage and trusted-attestation absence, and associate final CI without recursive SHA claims."]
  },
  {
    id: "PR134-026",
    title: "A JSON null feed cursor escapes the typed error boundary",
    domain: "api-pagination",
    relatedBaselineIds: ["AUTH-11", "CONTENT-07"],
    affectedPaths: ["apps/api/src/modules/content/content-feed-cursor.ts", "apps/api/test/content-feed-cursor.test.ts", "apps/api/test/app.test.ts"],
    source: { sourceKey: "closureDoubleCheck", startLine: 73, endLine: 74 },
    summary: "Decoded null/scalar/array cursor values can be dereferenced before shape validation and bypass the route's intended client-error mapping.",
    residualWork: ["Retain decoder and HTTP regressions for non-plain values, malformed bounds, scope binding, timestamp precision, restart behavior, and stable ordering."]
  },
  {
    id: "PR134-027",
    title: "Asynchronous media preparation can overwrite a newer selection",
    domain: "frontend-client-privacy-product",
    relatedBaselineIds: ["CONTENT-03", "FE-09"],
    affectedPaths: ["apps/web/app/create/image-composer.tsx", "apps/web/src/media/media-selection-coordinator.ts"],
    source: { sourceKey: "closureDoubleCheck", startLine: 76, endLine: 77 },
    summary: "Video metadata completion commits a stale assets closure after later selection, removal, or unmount work.",
    residualWork: ["Merge by stable asset ID against current state, cancel stale work, enforce the ten-asset bound atomically, and retain out-of-order/removal/reselect/unmount tests."]
  },
  {
    id: "PR134-028",
    title: "Installed backend Solana SDKs do not support the pinned Node runtime",
    domain: "integration-runtime-authority",
    relatedBaselineIds: ["ROOT-01", "D-04"],
    affectedPaths: ["apps/api/package.json", "apps/worker/package.json", "pnpm-lock.yaml", ".nvmrc"],
    source: { sourceKey: "closureDoubleCheck", startLine: 79, endLine: 80 },
    summary: "Exact installed program SDK metadata requires Node 24 while the application and launch containers pin Node 22; green imports do not establish a supported production contract.",
    residualWork: ["Obtain explicit approval for the compatibility-sensitive SDK selection, then exercise the exact APIs, peers, lockfile, build, and runtime on the chosen supported Node path."]
  },
  {
    id: "PR134-029",
    title: "Accepted USDC decimals can diverge from displayed units",
    domain: "payments-subscriptions-receipts-referrals",
    relatedBaselineIds: ["PAY-09", "DM-13"],
    affectedPaths: ["packages/config/src/index.ts", "packages/config/src/index.test.ts", "apps/web/src/format-asset-amount.ts"],
    source: { sourceKey: "closureDoubleCheck", startLine: 82, endLine: 83 },
    summary: "Runtime quote and verification decimals can be configured differently from the fixed-six USDC formatter, silently mislabelling accepted units.",
    residualWork: ["Constrain the currently supported USDC mint contract to six decimals or carry immutable mint/decimal facts through every historical quote, receipt, email, and display."]
  },
  {
    id: "PR134-030",
    title: "The short setup guide omits payment evidence and acceptance recovery",
    domain: "architecture-provider-operations-docs",
    relatedBaselineIds: ["D-04", "DM-15"],
    affectedPaths: ["docs/v2-new-build/add-keys-and-test-core-app.md", "docs/v2-new-build/operator/provider-setup-and-demo-data.md"],
    source: { sourceKey: "closureDoubleCheck", startLine: 85, endLine: 86 },
    summary: "The entry guide lacks the Helius signed webhook configuration and complete immutable quote, consent, wallet, verification, access/receipt, Activity, and delayed-ack journey.",
    residualWork: ["Keep exact environment and callback names, distinguish local fixtures from real devnet/provider proof, and never offer another payment while a sent attempt is uncertain."]
  },
  {
    id: "PR134-031",
    title: "Disabled recurring payments still lack accepted local integrity invariants",
    domain: "payments-subscriptions-receipts-referrals",
    relatedBaselineIds: ["PAY-13", "PAY-17", "DM-15"],
    affectedPaths: ["apps/api/src/modules/subscription", "apps/worker/src/subscription-collections.ts", "packages/database/migrations"],
    source: { sourceKey: "closureDoubleCheck", startLine: 88, endLine: 88 },
    summary: "The reconciliation worker does not by itself supply pre-broadcast cancellation fencing, immutable accepted commercial snapshots, durable nonce and period authority, exact delegation linkage, seed-unit correction, or measured selectors.",
    residualWork: ["Keep subscriptions disabled while implementing the local invariants and preserve native concurrency separately from official-program devnet and device acceptance."]
  }
].map((finding) => Object.freeze({
  ...finding,
  recordType: "pr134_supplemental_finding"
})));

registerSupplementalDisposition(
  supplementalDispositionRegistry,
  supplementalFindings.map((finding) => finding.id),
  {
    finalDisposition: "unresolved",
    workflowState: "confirmed",
    residualWork: [
      "Complete the issue-specific repair or accepted disposition and capture exact-source verification receipts."
    ]
  }
);

export function getSupplementalFindings() {
  return supplementalFindings;
}

const rootCauseGroupById = Object.freeze({
  "ROOT-01": "dependency-security-baseline",
  "AUTH-07": "recovery-session-revocation",
  "CONTENT-01": "media-composition-publication-state",
  "CONTENT-09": "mutuals-final-schema-compatibility",
  "PAY-01": "exact-split-settlement",
  "PAY-06": "provider-inbox-atomicity",
  "PAY-07": "payment-confirmation-email-queue",
  "PAY-08": "payment-confirmation-email-queue",
  "FE-01": "private-message-client-outbox",
  "FE-02": "private-message-client-outbox",
  "FE-06": "same-origin-navigation",
  "DB-01": "server-owned-data-api-authority",
  "DB-02": "server-owned-data-api-authority",
  "DB-07": "server-owned-data-api-authority",
  "DB-05": "rollback-safety",
  "ROLLBACK-01": "rollback-safety",
  "MIGTEST-GAP-01": "rollback-safety",
  "RES-01": "safe-api-boundary",
  "RES-02": "safe-api-boundary",
  "ROOT-09": "canonical-real-database-suite",
  "INT-01": "canonical-real-database-suite",
  "INT-02": "canonical-real-database-suite",
  "MIGTEST-GAP-02": "real-database-security-oracles",
  "MIGTEST-GAP-04": "real-database-query-oracles",
  "WA-01": "bounded-web-push-delivery",
  "WA-02": "bounded-web-push-delivery",
  "D-10": "mcp-version-authority"
});

function fail(message) {
  throw new Error(message);
}

function compareCodePoints(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function runGit(args, options = {}) {
  return execFileSync("git", args, {
    cwd: options.cwd ?? repositoryRoot,
    encoding: options.buffer ? "buffer" : "utf8",
    input: options.input,
    maxBuffer: 512 * 1024 * 1024
  });
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function sortedObject(value) {
  if (Array.isArray(value)) return value.map(sortedObject);
  if (value && typeof value === "object" && !(value instanceof Date)) {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, entry]) => entry !== undefined)
        .sort(([left], [right]) => compareCodePoints(left, right))
        .map(([key, entry]) => [key, sortedObject(entry)])
    );
  }
  return value;
}

export function stableJson(value) {
  return `${JSON.stringify(sortedObject(value), null, 2)}\n`;
}

function parseArguments(argv) {
  let auditPath = null;
  let check = false;
  let workspaceReportPath = null;
  let printSourceFingerprint = false;

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--audit") {
      auditPath = argv[index + 1];
      if (!auditPath) fail("--audit requires a path");
      index += 1;
    } else if (argument === "--check") {
      check = true;
    } else if (argument === "--workspace-report") {
      workspaceReportPath = argv[index + 1];
      if (!workspaceReportPath) fail("--workspace-report requires a path");
      index += 1;
    } else if (argument === "--print-source-fingerprint") {
      printSourceFingerprint = true;
    } else if (argument === "--help") {
      process.stdout.write(
        "Usage: node scripts/generate-audit-evidence.mjs [--audit PATH] [--check] " +
        "[--workspace-report PATH] [--print-source-fingerprint]\n"
      );
      process.exit(0);
    } else {
      fail(`Unknown argument: ${argument}`);
    }
  }

  return {
    auditPath: auditPath ? resolve(auditPath) : null,
    check,
    workspaceReportPath: workspaceReportPath ? resolve(workspaceReportPath) : null,
    printSourceFingerprint
  };
}

function expectedIds() {
  const groups = [
    ["ROOT", 9],
    ["AUTH", 23],
    ["CONTENT", 20],
    ["PAY", 17],
    ["WA", 12],
    ["FE", 25],
    ["DB", 7],
    ["RES", 5],
    ["CONTRACT", 3],
    ["ROLLBACK", 1],
    ["SUP", 1],
    ["INT", 3],
    ["TEST", 1],
    ["MIGTEST-GAP", 4],
    ["D", 13],
    ["DM", 15]
  ];

  return groups.flatMap(([prefix, count]) =>
    Array.from({ length: count }, (_, index) => `${prefix}-${String(index + 1).padStart(2, "0")}`)
  );
}

function issuePrefix(id) {
  return id.replace(/-\d{2}$/, "");
}

function issueTitle(id, rawLine) {
  let remainder = rawLine.replace(new RegExp(`^- ${id}\\s*`), "").replace(/^—\s*/, "");
  const segments = remainder.split(" — ");
  let title = segments.at(-1)?.trim() ?? remainder.trim();
  title = title.replace(/^P[123](?:\/P[123])?[^:—]*:\s*/, "");
  return title;
}

function issuePriorities(rawLine) {
  return [...new Set([...rawLine.matchAll(/\bP([123])\b/g)].map((match) => `P${match[1]}`))];
}

function parseAudit(auditPath) {
  if (!existsSync(auditPath)) fail(`Audit source does not exist: ${auditPath}`);
  const auditBytes = readFileSync(auditPath);
  const actualAuditSha = sha256(auditBytes);
  if (actualAuditSha !== expectedAuditSha256) {
    fail(`Audit SHA-256 mismatch: expected ${expectedAuditSha256}, received ${actualAuditSha}`);
  }

  const text = auditBytes.toString("utf8").replace(/\r\n/g, "\n");
  const lines = text.split("\n");
  const registerStart = lines.findIndex((line) => line.startsWith("6. FINDING REGISTER"));
  const registerEnd = lines.findIndex((line) => line.startsWith("7. COMPLETE PRODUCTION DEPENDENCY ADVISORY REGISTER"));
  if (registerStart === -1 || registerEnd === -1 || registerEnd <= registerStart) {
    fail("Could not locate the bounded finding register in the audit source");
  }

  const records = [];
  for (let index = registerStart + 1; index < registerEnd; index += 1) {
    const match = lines[index].match(registerLinePattern);
    if (!match) continue;
    records.push({
      id: match[1],
      line: index + 1,
      rawLine: lines[index]
    });
  }

  const expected = expectedIds();
  const actualIds = records.map((record) => record.id);
  const actualSet = new Set(actualIds);
  if (records.length !== 159 || actualSet.size !== 159) {
    fail(`Expected 159 unique finding records, received ${records.length} records and ${actualSet.size} unique IDs`);
  }
  const missing = expected.filter((id) => !actualSet.has(id));
  const unexpected = actualIds.filter((id) => !expected.includes(id));
  if (missing.length > 0 || unexpected.length > 0) {
    fail(`Finding ID mismatch; missing=${missing.join(",") || "none"}; unexpected=${unexpected.join(",") || "none"}`);
  }

  const appendixStart = lines.findIndex((line) => line.startsWith("APPENDIX 1:"));
  if (appendixStart === -1) fail("Could not locate audit appendices");
  const detailMarkers = [];
  let appendix = null;
  let sourceReport = null;
  const appendixBoundaries = [];
  for (let index = appendixStart; index < lines.length; index += 1) {
    const appendixMatch = lines[index].match(/^APPENDIX (\d+):\s*(.+)$/);
    if (appendixMatch) {
      appendix = Number(appendixMatch[1]);
      sourceReport = null;
      appendixBoundaries.push(index + 1);
      continue;
    }
    const sourceMatch = lines[index].match(/^Source report:\s*(.+)$/);
    if (sourceMatch) {
      sourceReport = sourceMatch[1].trim();
      continue;
    }
    const detailMatch = lines[index].match(detailHeadingPattern);
    if (detailMatch && actualSet.has(detailMatch[1])) {
      detailMarkers.push({
        id: detailMatch[1],
        appendix,
        sourceReport,
        startLine: index + 1
      });
    }
  }

  const detailsById = new Map();
  for (let index = 0; index < detailMarkers.length; index += 1) {
    const marker = detailMarkers[index];
    const nextMarkerLine = detailMarkers[index + 1]?.startLine ?? lines.length + 1;
    const nextAppendixLine = appendixBoundaries.find((line) => line > marker.startLine) ?? lines.length + 1;
    const occurrence = {
      appendix: marker.appendix,
      sourceReport: marker.sourceReport,
      startLine: marker.startLine,
      endLine: Math.min(nextMarkerLine, nextAppendixLine) - 1
    };
    const occurrences = detailsById.get(marker.id) ?? [];
    occurrences.push(occurrence);
    detailsById.set(marker.id, occurrences);
  }

  return {
    lineCount: lines.at(-1) === "" ? lines.length - 1 : lines.length,
    registerStartLine: registerStart + 1,
    registerEndLine: registerEnd - 1,
    records,
    detailsById
  };
}

function statusForIssue(id) {
  const status = issueDispositionRegistry.get(id);
  if (!status) fail(`Missing explicit disposition registry entry: ${id}`);
  return status;
}

export function resolveSupplementalRecords(
  findings,
  registry,
  { snapshot, receipts, reviewSources = supplementalReviewSources }
) {
  const expectedIds = new Set(findings.map((finding) => finding.id));
  const missing = [...expectedIds].filter((id) => !registry.has(id));
  const unexpected = [...registry.keys()].filter((id) => !expectedIds.has(id));
  if (missing.length > 0 || unexpected.length > 0) {
    fail(`Supplemental disposition registry mismatch; missing=${missing.join(",") || "none"}; unexpected=${unexpected.join(",") || "none"}`);
  }

  return findings.map((finding, index) => {
    const status = registry.get(finding.id);
    const sourceDefinition = reviewSources[finding.source.sourceKey];
    if (!sourceDefinition) fail(`Unknown supplemental source key: ${finding.source.sourceKey}`);
    const trackedSource = sourceDefinition.trackedPath
      ? snapshot.entriesByPath.get(sourceDefinition.trackedPath)
      : null;
    if (sourceDefinition.trackedPath && !trackedSource) {
      fail(`Tracked supplemental source is missing: ${sourceDefinition.trackedPath}`);
    }
    if (trackedSource) {
      const lineCount = trackedSource.bytes.toString("utf8").split("\n").length -
        (trackedSource.bytes.toString("utf8").endsWith("\n") ? 1 : 0);
      if (trackedSource.sha256 !== sourceDefinition.sha256 || lineCount !== sourceDefinition.lineCount) {
        fail(`Tracked supplemental source metadata mismatch: ${sourceDefinition.trackedPath}`);
      }
    }
    const executions = status.executions.map((execution) => resolveExecution(execution, receipts, snapshot));
    const evidenceRequired = status.finalDisposition === "fixed" || status.finalDisposition === "superseded";
    const allExecutionsVerified = executions.length > 0 && executions.every(executionSupportsClosure);
    const reopenedForEvidence = evidenceRequired && !allExecutionsVerified;
    const finalDisposition = reopenedForEvidence ? "unresolved" : status.finalDisposition;
    const residualWork = [...finding.residualWork, ...status.residualWork];
    if (reopenedForEvidence) {
      residualWork.push("Capture and validate every exact-bound supplemental receipt, then obtain independent trusted CI/release attestation.");
    }
    return {
      ...finding,
      ordinal: index + 1,
      workflowState: reopenedForEvidence ? "confirmed" : status.workflowState,
      finalDisposition,
      source: {
        name: sourceDefinition.name,
        sha256: sourceDefinition.sha256,
        lineCount: sourceDefinition.lineCount,
        reviewedHead: sourceDefinition.reviewedHead,
        startLine: finding.source.startLine,
        endLine: finding.source.endLine,
        sourceAvailableInTrackedIndex: Boolean(trackedSource)
      },
      resolution: {
        desiredDisposition: status.finalDisposition,
        residualWork,
        scopeDecision: status.scopeDecision
      },
      verification: {
        executions,
        finalTreeEvidenceRecorded: evidenceRequired && allExecutionsVerified,
        rule: "Supplemental fixed/superseded dispositions require exact argv/cwd/result/evidence receipt declarations plus independent trusted attestation; missing, invalid, generic, or unattested evidence reopens the finding."
      },
      externalPrerequisites: status.externalPrerequisites
    };
  });
}

function buildIssueLedger(parsedAudit, { snapshot, receipts, originalEvidenceImport }) {
  const supplements = resolveSupplementalRecords(supplementalFindings, supplementalDispositionRegistry, {
    snapshot,
    receipts
  });
  const supplementalById = new Map(supplements.map((finding) => [finding.id, finding]));
  const groupMembers = new Map();
  for (const [id, group] of Object.entries(rootCauseGroupById)) {
    const members = groupMembers.get(group) ?? [];
    members.push(id);
    groupMembers.set(group, members);
  }
  const supplementalByBaselineId = new Map();
  for (const finding of supplementalFindings) {
    for (const baselineId of finding.relatedBaselineIds) {
      const linked = supplementalByBaselineId.get(baselineId) ?? [];
      linked.push(finding.id);
      supplementalByBaselineId.set(baselineId, linked);
    }
  }

  const issues = parsedAudit.records.map((record, index) => {
    const prefix = issuePrefix(record.id);
    const status = statusForIssue(record.id);
    const rootCauseGroup = rootCauseGroupById[record.id] ?? null;
    const executions = status.executions.map((execution) => resolveExecution(execution, receipts, snapshot));
    const allExecutionsVerified = executions.length > 0 && executions.every(executionSupportsClosure);
    const linkedSupplementalFindings = supplementalByBaselineId.get(record.id) ?? [];
    const evidenceRequired = status.finalDisposition === "fixed" || status.finalDisposition === "superseded";
    const reopenedForEvidence = evidenceRequired && !allExecutionsVerified;
    const reopenedForSupplement = evidenceRequired && linkedSupplementalFindings.some(
      (supplementalId) => supplementalById.get(supplementalId)?.finalDisposition === "unresolved"
    );
    const finalDisposition = reopenedForEvidence || reopenedForSupplement
      ? "unresolved"
      : status.finalDisposition;
    const residualWork = [...status.residualWork];
    if (reopenedForEvidence) {
      residualWork.push("Capture and validate exact-bound command/version/exit/result/redacted-log receipt declarations and obtain independent trusted CI/release attestation.");
    }
    if (reopenedForSupplement) {
      residualWork.push(`Resolve and verify follow-up finding(s): ${linkedSupplementalFindings.join(", ")}.`);
    }
    return {
      id: record.id,
      ordinal: index + 1,
      domain: domainByPrefix[prefix],
      title: issueTitle(record.id, record.rawLine),
      priorities: issuePriorities(record.rawLine),
      recordType: "audit_record",
      conditionality: {
        kind: record.id === "ROOT-02" ? "narrowed_hypothesis" : "as_reported",
        sourceTextPreserved: true
      },
      source: {
        registerLine: record.line,
        rawRegisterText: record.rawLine,
        detailOccurrences: parsedAudit.detailsById.get(record.id) ?? []
      },
      rootCauseGroup,
      relatedIssues: rootCauseGroup
        ? (groupMembers.get(rootCauseGroup) ?? []).filter((id) => id !== record.id)
        : [],
      supplementalFindings: linkedSupplementalFindings,
      affectedPaths: status.affectedPaths,
      baselineEvidence: {
        state: originalEvidenceImport.state,
        originalEvidenceArchiveAvailable: originalEvidenceImport.originalEvidenceArchiveAvailable,
        limitation: originalEvidenceImport.limitation
      },
      workflowState: finalDisposition === status.finalDisposition ? status.workflowState : "confirmed",
      finalDisposition,
      resolution: {
        completeness: finalDisposition === status.finalDisposition
          ? status.completeness
          : "reopened_pending_current_evidence",
        summary: status.summary,
        sourceFingerprintSha256: snapshot.sourceFingerprintSha256,
        residualWork,
        scopeDecision: status.scopeDecision
      },
      verification: {
        executions,
        finalTreeEvidenceRecorded: status.finalTreeEvidenceRecorded && allExecutionsVerified && !reopenedForSupplement,
        rule: "A fixed or superseded record requires exact-bound structured receipt declarations and independently provisioned trusted attestation. Generic success, no-op commands, reviewer strings, and historical command prose are not closure proof."
      },
      externalPrerequisites: status.externalPrerequisites,
      documentation: [],
      owner: prefix.toLowerCase(),
      history: linkedSupplementalFindings.map((supplementalId) => ({
        event: "followup_finding_linked",
        supplementalId,
        dispositionEffect: evidenceRequired && supplementalById.get(supplementalId)?.finalDisposition === "unresolved"
          ? "reopened_pending_verification"
          : "supplemental_disposition_resolved_independently"
      }))
    };
  });

  const unresolvedCount = [...issues, ...supplements]
    .filter((issue) => issue.finalDisposition === "unresolved").length;

  return {
    schemaVersion: 2,
    ledgerState: unresolvedCount === 0 ? "final" : "working",
    audit: {
      id: "wevid-full-audit-2026-11-04-71ceabc",
      sourceName: auditSourceName,
      sourceSha256: expectedAuditSha256,
      inputProvisioning: "explicit_hash_pinned_repo_or_ci_input_required",
      sourceLineCount: parsedAudit.lineCount,
      baselineSha,
      recordCount: issues.length,
      registerRange: {
        startLine: parsedAudit.registerStartLine,
        endLine: parsedAudit.registerEndLine
      },
      originalRecordCount: 156,
      independentAdditions: ["AUTH-22", "AUTH-23", "PAY-17"]
    },
    repository: {
      baselineSha,
      coverageManifestPath: manifestPath,
      sourceSnapshot: {
        kind: snapshot.kind,
        trackedIndexPathCount: snapshot.entries.length,
        fingerprintIncludedPathCount: snapshot.fingerprintRows.length,
        sourceFingerprintSha256: snapshot.sourceFingerprintSha256,
        exclusions: {
          exactGeneratedOutputs: [...generatedOutputPaths].sort(compareCodePoints),
          excludedPrefixes: [...sourceFingerprintExcludedPrefixes].sort(compareCodePoints)
        },
        commitAssociation: "external_ci_or_release_receipt_required"
      }
    },
    preservationCheckpoint: {
      ...preservationCheckpoint,
      scope: "historical_preserved_workspace_checkpoint_not_current_committed_source"
    },
    originalEvidenceImport,
    trustedEvidenceAttestation: trustedAttestationState,
    statusModel: {
      workflowStates: ["untriaged", "confirmed", "in_progress", "implemented", "verified", "closed"],
      finalDispositions: ["unresolved", "fixed", "superseded", "deferred_scope", "blocked_external"],
      finalLedgerRule: "ledgerState=final is invalid while any issue has finalDisposition=unresolved",
      blockedExternalRule: "blocked_external requires a named owner, prerequisite, proof command, and fail-closed release or capability state; it cannot conceal unfinished routine local work",
      deferredScopeRule: "deferred_scope requires a cited accepted scope authority and an explicit non-advertised behavior",
      fixedRule: "fixed requires issue-specific affected paths, exact-bound captured receipt declarations, and an independently provisioned trusted attestation for every required execution boundary",
      receiptDeclarationRule: "Tracked local receipts bind exact argv/cwd/result kind/source/evidence but remain supporting declarations; generic results and no-op commands cannot promote findings",
      semanticReviewDeclarationRule: "Reviewer strings and exact-hash semantic review records are attribution declarations, not independent attestation and not closure-eligible by themselves",
      supplementalRule: "PR134 follow-up findings are counted separately and link back to canonical baseline IDs; a linked follow-up may reopen but never replace a baseline record."
    },
    summary: {
      baseline: {
        recordCount: issues.length,
        byDomain: countBy(issues, (issue) => issue.domain),
        byFinalDisposition: countBy(issues, (issue) => issue.finalDisposition),
        byWorkflowState: countBy(issues, (issue) => issue.workflowState)
      },
      supplemental: {
        recordCount: supplements.length,
        byDomain: countBy(supplements, (issue) => issue.domain),
        byFinalDisposition: countBy(supplements, (issue) => issue.finalDisposition),
        byWorkflowState: countBy(supplements, (issue) => issue.workflowState)
      },
      priorityMentions: {
        P1: issues.filter((issue) => issue.priorities.includes("P1")).length,
        P2: issues.filter((issue) => issue.priorities.includes("P2")).length,
        P3: issues.filter((issue) => issue.priorities.includes("P3")).length,
        noneExplicit: issues.filter((issue) => issue.priorities.length === 0).length,
        note: "Priority mention counts overlap when a record is labelled with more than one priority."
      }
    },
    issues,
    supplementalFindings: supplements
  };
}

function countBy(items, keyForItem) {
  const counts = {};
  for (const item of items) {
    const key = keyForItem(item);
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

function parseNullSeparated(buffer) {
  return buffer.toString("utf8").split("\0").filter(Boolean);
}

function baselineTree() {
  const resolvedBaseline = runGit(["rev-parse", `${baselineSha}^{commit}`]).trim();
  if (resolvedBaseline !== baselineSha) fail(`Baseline commit mismatch: ${resolvedBaseline}`);
  const records = parseNullSeparated(
    runGit(["ls-tree", "-rz", "--full-tree", baselineSha], { buffer: true })
  );
  const entries = new Map();
  for (const record of records) {
    const tab = record.indexOf("\t");
    if (tab === -1) fail(`Malformed git ls-tree record: ${record}`);
    const [mode, type, objectId] = record.slice(0, tab).split(" ");
    const path = record.slice(tab + 1);
    if (type !== "blob") fail(`Unexpected non-blob baseline entry at ${path}: ${type}`);
    entries.set(path, { mode, objectId });
  }
  if (entries.size !== expectedBaselinePathCount) {
    fail(`Baseline path count mismatch: expected ${expectedBaselinePathCount}, received ${entries.size}`);
  }
  const migrationLink = entries.get("supabase/migrations");
  if (migrationLink?.mode !== "120000") fail("Expected supabase/migrations to be the baseline migration symlink");
  return entries;
}

function isSourceFingerprintExcluded(path) {
  return generatedOutputPaths.has(path) ||
    sourceFingerprintExcludedPrefixes.some((prefix) => path.startsWith(prefix));
}

function parseIndexEntries(root) {
  const records = parseNullSeparated(
    runGit(["ls-files", "--stage", "-z"], { cwd: root, buffer: true })
  );
  return records.map((record) => {
    const tab = record.indexOf("\t");
    if (tab === -1) fail(`Malformed git ls-files record: ${record}`);
    const [mode, objectId, stage] = record.slice(0, tab).split(" ");
    const path = record.slice(tab + 1);
    if (stage !== "0") fail(`Unmerged index entry is not supported in audit evidence: ${path}`);
    return { path, mode, objectId };
  }).sort((left, right) => compareCodePoints(left.path, right.path));
}

function readIndexBlobMap(entries, root) {
  const objectIds = [...new Set(entries.map((entry) => entry.objectId))];
  if (objectIds.length === 0) return new Map();
  const response = runGit(["cat-file", "--batch"], {
    cwd: root,
    buffer: true,
    input: Buffer.from(`${objectIds.join("\n")}\n`)
  });
  const blobs = new Map();
  let offset = 0;

  for (const expectedObjectId of objectIds) {
    const headerEnd = response.indexOf(10, offset);
    if (headerEnd === -1) fail(`Missing git cat-file header for ${expectedObjectId}`);
    const [objectId, type, sizeText] = response.subarray(offset, headerEnd).toString("utf8").split(" ");
    const size = Number(sizeText);
    if (objectId !== expectedObjectId || type !== "blob" || !Number.isSafeInteger(size) || size < 0) {
      fail(`Unexpected git cat-file response for ${expectedObjectId}`);
    }
    const contentStart = headerEnd + 1;
    const contentEnd = contentStart + size;
    if (contentEnd >= response.length || response[contentEnd] !== 10) {
      fail(`Truncated git cat-file body for ${expectedObjectId}`);
    }
    blobs.set(objectId, response.subarray(contentStart, contentEnd));
    offset = contentEnd + 1;
  }
  if (offset !== response.length) fail("Unexpected trailing bytes from git cat-file --batch");
  return blobs;
}

export function buildIndexSnapshot(root = repositoryRoot) {
  const entries = parseIndexEntries(root);
  const blobs = readIndexBlobMap(entries, root);
  const objectFormat = runGit(["rev-parse", "--show-object-format"], { cwd: root }).trim();
  if (objectFormat !== "sha1" && objectFormat !== "sha256") {
    fail(`Unsupported Git object format: ${objectFormat}`);
  }

  const hydratedEntries = entries.map((entry) => {
    const bytes = blobs.get(entry.objectId);
    if (!bytes) fail(`Missing index blob bytes for ${entry.path}`);
    return Object.freeze({
      ...entry,
      bytes,
      sha256: sha256(bytes),
      fingerprintIncluded: !isSourceFingerprintExcluded(entry.path)
    });
  });
  const fingerprintRows = hydratedEntries
    .filter((entry) => entry.fingerprintIncluded)
    .map((entry) => ({ path: entry.path, mode: entry.mode, sha256: entry.sha256 }));

  return Object.freeze({
    kind: "git_index",
    objectFormat,
    entries: hydratedEntries,
    entriesByPath: new Map(hydratedEntries.map((entry) => [entry.path, entry])),
    sourceFingerprintSha256: sha256(Buffer.from(stableJson(fingerprintRows))),
    fingerprintRows
  });
}

export function observeWorkspace(root = repositoryRoot) {
  const dirtyTracked = parseNullSeparated(
    runGit(["diff", "--name-only", "-z"], { cwd: root, buffer: true })
  ).sort(compareCodePoints);
  const stagedTracked = parseNullSeparated(
    runGit(["diff", "--cached", "--name-only", "-z"], { cwd: root, buffer: true })
  ).sort(compareCodePoints);
  const untracked = parseNullSeparated(
    runGit(["ls-files", "--others", "--exclude-standard", "-z"], { cwd: root, buffer: true })
  ).sort(compareCodePoints);
  const protectedDirty = dirtyTracked.filter((path) => protectedDirtyPaths.has(path));
  const otherDirty = dirtyTracked.filter((path) => !protectedDirtyPaths.has(path));

  return {
    schemaVersion: 1,
    state: "local_workspace_observation_not_part_of_committed_evidence",
    trackedIndexCount: parseIndexEntries(root).length,
    stagedTracked,
    protectedDirty,
    otherDirty,
    untracked
  };
}

export function assertNoProhibitedStagedPaths(root = repositoryRoot) {
  const staged = parseNullSeparated(
    runGit(["diff", "--cached", "--name-only", "-z"], { cwd: root, buffer: true })
  );
  const prohibited = staged.filter((path) => prohibitedStagedPaths.has(path)).sort(compareCodePoints);
  if (prohibited.length > 0) {
    fail(`Prohibited path staged for audit evidence: ${prohibited.join(", ")}`);
  }
  return true;
}

export function assertCleanCaptureWorkspace(root = repositoryRoot) {
  const observation = observeWorkspace(root);
  const dirty = [...observation.protectedDirty, ...observation.otherDirty];
  if (dirty.length > 0 || observation.untracked.length > 0) {
    fail(
      "Execution capture requires a worktree whose tracked bytes exactly match the Git index and has no untracked paths; " +
      `dirty=${dirty.sort(compareCodePoints).join(",") || "none"}; ` +
      `untracked=${observation.untracked.join(",") || "none"}. Use a clean detached worktree of the settled source.`
    );
  }
  return true;
}

function assertSafeArchiveMemberPath(path) {
  if (typeof path !== "string" || path.length === 0 || path.length > 512) {
    fail("Original evidence archive member path is invalid");
  }
  if (path.includes("\\") || path.includes("\0") || path.startsWith("/") || /^[A-Za-z]:/.test(path)) {
    fail(`Unsafe original evidence archive member path: ${path}`);
  }
  const segments = path.split("/");
  if (segments.some((segment) => segment === "" || segment === "." || segment === "..")) {
    fail(`Unsafe original evidence archive member path: ${path}`);
  }
  return path;
}

export function validateOriginalEvidenceIndex(index, memberLookup, archiveLookup = () => null) {
  if (!index || index.schemaVersion !== 1 || !index.archive || !Array.isArray(index.members)) {
    fail("Original evidence index has an invalid shape");
  }
  const archive = index.archive;
  if (typeof archive.path !== "string" || !archive.path.startsWith(`${evidenceDirectory}/audit-inputs/`)) {
    fail("Original evidence archive path must stay inside the audit-inputs directory");
  }
  if (!/^[a-f0-9]{64}$/.test(archive.sha256 ?? "") || !Number.isSafeInteger(archive.bytes) || archive.bytes < 0) {
    fail("Original evidence archive digest metadata is invalid");
  }
  const archiveBytes = archiveLookup(archive.path);
  if (!Buffer.isBuffer(archiveBytes) || archiveBytes.length !== archive.bytes || sha256(archiveBytes) !== archive.sha256) {
    fail("Original evidence archive bytes do not match the import index");
  }
  if (index.members.length === 0 || index.members.length > 5_000) {
    fail("Original evidence archive member count is outside the supported bound");
  }

  const seen = new Set();
  let totalBytes = 0;
  const members = index.members.map((member) => {
    const path = assertSafeArchiveMemberPath(member.path);
    if (seen.has(path)) fail(`Duplicate original evidence archive member: ${path}`);
    seen.add(path);
    if (!/^[a-f0-9]{64}$/.test(member.sha256 ?? "") || !Number.isSafeInteger(member.bytes) || member.bytes < 0) {
      fail(`Invalid original evidence member digest metadata: ${path}`);
    }
    totalBytes += member.bytes;
    if (totalBytes > 256 * 1024 * 1024) fail("Original evidence archive exceeds the supported extracted-size bound");
    const bytes = memberLookup(path);
    if (!Buffer.isBuffer(bytes) || bytes.length !== member.bytes || sha256(bytes) !== member.sha256) {
      fail(`Original evidence member bytes do not match the import index: ${path}`);
    }
    return { path, bytes: member.bytes, sha256: member.sha256 };
  });

  return {
    state: "validated_original_archive_import",
    archive: { path: archive.path, bytes: archive.bytes, sha256: archive.sha256 },
    memberCount: members.length,
    totalExtractedBytes: totalBytes,
    members
  };
}

function loadOriginalEvidenceImport(snapshot) {
  const indexEntry = snapshot.entriesByPath.get(originalEvidenceIndexPath);
  if (!indexEntry) {
    return {
      state: "unavailable",
      originalEvidenceArchiveAvailable: false,
      limitation: "The original evidence ZIP, member index, finding-index, and per-path coverage manifest were not present in the tracked index; no import is fabricated."
    };
  }
  let index;
  try {
    index = JSON.parse(indexEntry.bytes.toString("utf8"));
  } catch {
    fail("Original evidence import index is not valid JSON");
  }
  const validated = validateOriginalEvidenceIndex(
    index,
    (memberPath) => snapshot.entriesByPath.get(`${originalEvidenceMemberDirectory}/${memberPath}`)?.bytes ?? null,
    (archivePath) => snapshot.entriesByPath.get(archivePath)?.bytes ?? null
  );
  const expectedMemberPaths = new Set(
    validated.members.map((member) => `${originalEvidenceMemberDirectory}/${member.path}`)
  );
  const unexpectedTrackedMembers = snapshot.entries
    .map((entry) => entry.path)
    .filter((path) => path.startsWith(`${originalEvidenceMemberDirectory}/`) && !expectedMemberPaths.has(path));
  if (unexpectedTrackedMembers.length > 0) {
    fail(`Unindexed original evidence members: ${unexpectedTrackedMembers.join(", ")}`);
  }
  const memberNames = new Set(validated.members.map((member) => member.path));
  return {
    ...validated,
    originalEvidenceArchiveAvailable: true,
    findingIndexAvailable: memberNames.has("finding-index.json"),
    perPathCoverageManifestAvailable: memberNames.has("WeVid_Coverage_71ceabc.json"),
    semanticCoverageImported: false,
    limitation: "Archive bytes and indexed members are validated, but semantic coverage is not promoted until the supplied manifest schema is parsed and reconciled to all baseline blobs."
  };
}

function isTestResultKind(kind) {
  return ["vitest", "node_test", "playwright"].includes(kind);
}

export function commandLooksTestLike(argv) {
  return Array.isArray(argv) && argv.some((argument) =>
    argument === "test" || argument === "--test" || argument === "vitest" || argument === "playwright" ||
    /^test(?::|$)/.test(argument)
  );
}

export function commandUsesShellWrapper(argv) {
  if (!Array.isArray(argv) || argv.length === 0) return false;
  let executableIndex = 0;
  if (basename(argv[0]).toLowerCase() === "env") {
    executableIndex = 1;
    while (executableIndex < argv.length) {
      const argument = argv[executableIndex];
      if (argument === "--") {
        executableIndex += 1;
        break;
      }
      if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(argument) ||
          ["-i", "--ignore-environment"].includes(argument) ||
          /^(?:--unset|--chdir)=/.test(argument)) {
        executableIndex += 1;
        continue;
      }
      if (["-u", "--unset", "-C", "--chdir", "-P"].includes(argument)) {
        executableIndex += 2;
        continue;
      }
      // `env -S` parses a command string itself, so it is never an acceptable direct argv boundary.
      if (argument === "-S" || argument === "--split-string" || argument.startsWith("--split-string=")) {
        return true;
      }
      // Unknown env options are fail-closed because they may change where the nested executable begins.
      if (argument.startsWith("-")) return true;
      break;
    }
  }
  return executableIndex < argv.length &&
    shellWrapperExecutables.has(basename(argv[executableIndex]).toLowerCase());
}

const secretArgumentName = "(?:(?:[a-z0-9]+[_-])*(?:api[_-]?key|authorization|cookie|database[_-]?url|encryption[_-]?key|password|private[_-]?key|refresh[_-]?token|secret[_-]?access[_-]?key|secret[_-]?key|secret|service[_-]?role[_-]?key|session(?:[_-]?(?:cookie|id|secret|token))?|token))";
const secretAssignmentPattern = new RegExp(`^(?:--?)?${secretArgumentName}(?:=|:).+`, "i");
const secretFlagPattern = new RegExp(`^(?:--?)?${secretArgumentName}$`, "i");
const secretJsonPattern = new RegExp(`["']${secretArgumentName}["']\\s*:\\s*["'][^"']+["']`, "i");
const secretQueryPattern = new RegExp(`([?&]${secretArgumentName}=)[^&\\s]+`, "gi");

export function redactSecretText(value) {
  return value
    .replace(/-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?-----END [^-]*PRIVATE KEY-----/g, "[REDACTED_PRIVATE_KEY]")
    .replace(/\bBearer\s+[^\s]+/gi, "Bearer [REDACTED]")
    .replace(/\b(postgres(?:ql)?):\/\/[^\s]+/gi, "$1://[REDACTED]")
    .replace(/\b([a-z][a-z0-9+.-]*):\/\/[^\s/@:]+:[^\s/@]+@/gi, "$1://[REDACTED]@")
    .replace(new RegExp(`\\b(${secretArgumentName})\\s*[:=]\\s*[^\\s]+`, "gi"), "$1=[REDACTED]")
    .replace(new RegExp(`(["']${secretArgumentName}["']\\s*:\\s*)["'](?:\\\\.|[^"'\\\\])*["']`, "gi"), "$1\"[REDACTED]\"")
    .replace(secretQueryPattern, "$1[REDACTED]")
    .replace(/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, "[REDACTED_JWT]");
}

export function secretBearingTextErrors(value, sensitiveValues = []) {
  if (typeof value !== "string") return ["invalid_text"];
  const errors = [];
  if (redactSecretText(value) !== value) errors.push("unredacted_secret_pattern");
  for (const secret of sensitiveValues) {
    if (typeof secret === "string" && secret.length >= 4 && value.includes(secret)) {
      errors.push("known_sensitive_value_present");
      break;
    }
  }
  return errors;
}

export function secretBearingArgvErrors(argv) {
  if (!Array.isArray(argv)) return ["invalid_command_argv"];
  const errors = [];
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (typeof value !== "string") continue;
    if (secretFlagPattern.test(value) && typeof argv[index + 1] === "string") {
      errors.push(`secret_value_argument:${index + 1}`);
    }
    if (secretAssignmentPattern.test(value) || secretJsonPattern.test(value) ||
        /\bBearer\s+\S+/i.test(value) || /-----BEGIN [^-]*PRIVATE KEY-----/.test(value) ||
        /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/.test(value) ||
        /^[a-z][a-z0-9+.-]*:\/\/[^\s/@:]+:[^\s/@]+@/i.test(value) ||
        new RegExp(`[?&]${secretArgumentName}=[^&\\s]+`, "i").test(value)) {
      errors.push(`secret_bearing_argument:${index}`);
    }
  }
  return [...new Set(errors)].sort(compareCodePoints);
}

export function redactCommandArgv(argv) {
  const redacted = [...argv];
  for (let index = 0; index < redacted.length; index += 1) {
    const value = redacted[index];
    if (secretFlagPattern.test(value) && index + 1 < redacted.length) redacted[index + 1] = "[REDACTED]";
    redacted[index] = value
      .replace(new RegExp(`^((?:--?)?${secretArgumentName})(?:=|:).+$`, "i"), "$1=[REDACTED]")
      .replace(new RegExp(`(["']${secretArgumentName}["']\\s*:\\s*)["'][^"']+["']`, "gi"), "$1\"[REDACTED]\"")
      .replace(/\bBearer\s+\S+/gi, "Bearer [REDACTED]")
      .replace(/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, "[REDACTED_JWT]")
      .replace(/^([a-z][a-z0-9+.-]*:\/\/)[^\s/@:]+:[^\s/@]+@/i, "$1[REDACTED]@")
      .replace(secretQueryPattern, "$1[REDACTED]");
  }
  return redacted;
}

export function validateExecutionReceipt(receipt, snapshot, reference = null) {
  const errors = [];
  if (!receipt || receipt.schemaVersion !== 1) errors.push("invalid_schema_version");
  if (typeof receipt?.id !== "string" || !/^[a-z0-9][a-z0-9._-]{5,127}$/.test(receipt.id)) {
    errors.push("invalid_receipt_id");
  }
  if (reference?.receiptId && receipt?.id !== reference.receiptId) errors.push("receipt_id_mismatch");
  if (receipt?.sourceFingerprintSha256 !== snapshot.sourceFingerprintSha256) {
    errors.push("source_fingerprint_mismatch");
  }
  if (!receipt?.command || !Array.isArray(receipt.command.argv) || receipt.command.argv.length === 0 ||
      receipt.command.argv.some((value) => typeof value !== "string" || value.length === 0)) {
    errors.push("invalid_command_argv");
  } else {
    if (commandUsesShellWrapper(receipt.command.argv)) errors.push("shell_wrapper_not_allowed");
    errors.push(...secretBearingArgvErrors(receipt.command.argv));
  }
  if (receipt?.command?.cwd !== ".") errors.push("invalid_command_cwd");
  if (reference) {
    const expectedArgv = reference.expectedCommand?.argv;
    if (!Array.isArray(expectedArgv) || expectedArgv.length === 0 ||
        expectedArgv.some((value) => typeof value !== "string" || value.length === 0) ||
        reference.expectedCommand?.cwd !== "." ||
        !promotableReceiptResultKinds.has(reference.expectedResultKind) ||
        !Array.isArray(reference.evidencePaths) ||
        reference.evidencePaths.some((path) => !repositoryPathIsSafe(path))) {
      errors.push("invalid_reference_binding");
    } else {
      if (JSON.stringify(receipt?.command?.argv) !== JSON.stringify(expectedArgv)) {
        errors.push("command_argv_mismatch");
      }
      if (receipt?.command?.cwd !== reference.expectedCommand.cwd) errors.push("command_cwd_mismatch");
      if (receipt?.result?.kind !== reference.expectedResultKind) errors.push("result_kind_mismatch");
      if (noOpExecutables.has(basename(expectedArgv[0]).toLowerCase())) errors.push("no_op_command_not_promotable");
    }
  }
  if (typeof receipt?.runtime?.nodeVersion !== "string" || receipt.runtime.nodeVersion.length === 0) {
    errors.push("missing_node_version");
  }
  if (typeof receipt?.runtime?.pnpmVersion !== "string" || receipt.runtime.pnpmVersion.length === 0) {
    errors.push("missing_pnpm_version");
  }
  if (typeof receipt?.runtime?.gitVersion !== "string" || receipt.runtime.gitVersion.length === 0) {
    errors.push("missing_git_version");
  }
  const result = receipt?.result;
  if (!result || !Number.isInteger(result.exitCode) || typeof result.kind !== "string" || typeof result.status !== "string") {
    errors.push("invalid_result");
  } else {
    if (!receiptResultKinds.has(result.kind)) errors.push("unknown_result_kind");
    if (reference && !promotableReceiptResultKinds.has(result.kind)) errors.push("non_promotable_result_kind");
    if (result.status === "passed" && result.exitCode !== 0) errors.push("passed_with_nonzero_exit");
    if (result.kind === "generic" && commandLooksTestLike(receipt.command?.argv)) {
      errors.push("test_command_requires_structured_result_kind");
    }
    if (isTestResultKind(result.kind)) {
      if (!result.tests || !Number.isInteger(result.tests.total) || result.tests.total <= 0) {
        errors.push("zero_or_unknown_test_count");
      }
      const countKeys = ["passed", "failed", "skipped", "todo"];
      const validCounts = result.tests && countKeys.every((key) =>
        Number.isInteger(result.tests[key]) && result.tests[key] >= 0
      );
      if (!validCounts) errors.push("invalid_test_counts");
      if (result.status === "passed" && (!Number.isInteger(result.tests.failed) || result.tests.failed !== 0)) {
        errors.push("passed_with_failed_tests");
      }
      if (result.status === "passed" && (!Number.isInteger(result.tests.passed) || result.tests.passed <= 0)) {
        errors.push("passed_without_executed_tests");
      }
      if (validCounts &&
          result.tests.total !== result.tests.passed + result.tests.failed + result.tests.skipped + result.tests.todo) {
        errors.push("inconsistent_test_count");
      }
    }
  }
  const log = receipt?.log;
  if (!log || typeof log.path !== "string" || !log.path.startsWith(`${receiptDirectory}/`) ||
      !log.path.endsWith(".redacted.txt") ||
      !/^[a-f0-9]{64}$/.test(log.sha256 ?? "") || !Number.isSafeInteger(log.bytes) || log.bytes < 0 || log.redacted !== true) {
    errors.push("invalid_redacted_log_metadata");
  } else {
    const logEntry = snapshot.entriesByPath.get(log.path);
    if (!logEntry || logEntry.bytes.length !== log.bytes || logEntry.sha256 !== log.sha256) {
      errors.push("log_fingerprint_mismatch");
    }
  }
  if (!Array.isArray(receipt?.evidence)) {
    errors.push("invalid_evidence_list");
  } else {
    for (const evidence of receipt.evidence) {
      const entry = snapshot.entriesByPath.get(evidence?.path);
      if (!entry || entry.sha256 !== evidence.sha256) errors.push(`evidence_fingerprint_mismatch:${evidence?.path ?? "unknown"}`);
    }
    const expectedEvidencePaths = Array.isArray(reference?.evidencePaths) ? reference.evidencePaths : [];
    for (const expectedPath of expectedEvidencePaths) {
      const expectedEntry = snapshot.entriesByPath.get(expectedPath);
      if (!expectedEntry) {
        errors.push(`expected_evidence_path_missing:${expectedPath}`);
      } else if (!receipt.evidence.some((evidence) => evidence.path === expectedPath && evidence.sha256 === expectedEntry.sha256)) {
        errors.push(`expected_evidence_missing:${expectedPath}`);
      }
    }
  }
  if (result?.status !== "passed") errors.push(`result_not_passed:${result?.status ?? "unknown"}`);

  return {
    valid: errors.length === 0,
    errors: [...new Set(errors)].sort(compareCodePoints)
  };
}

function loadExecutionReceipts(snapshot) {
  const receipts = new Map();
  for (const entry of snapshot.entries) {
    if (!entry.path.startsWith(`${receiptDirectory}/`) || !entry.path.endsWith(".json")) continue;
    let receipt;
    try {
      receipt = JSON.parse(entry.bytes.toString("utf8"));
    } catch {
      fail(`Execution receipt is not valid JSON: ${entry.path}`);
    }
    if (receipts.has(receipt.id)) fail(`Duplicate execution receipt ID: ${receipt.id}`);
    receipts.set(receipt.id, { receipt, path: entry.path });
  }
  return receipts;
}

function repositoryPathIsSafe(path) {
  return typeof path === "string" && path.length > 0 && path.length <= 512 &&
    !path.includes("\\") && !path.includes("\0") && !path.startsWith("/") &&
    !/^[A-Za-z]:/.test(path) &&
    path.split("/").every((segment) => segment !== "" && segment !== "." && segment !== "..");
}

function lineCountForBytes(bytes) {
  if (bytes.length === 0) return 0;
  return bytes.toString("utf8").split("\n").length - (bytes.at(-1) === 10 ? 1 : 0);
}

function rangesCoverLineCount(ranges, lineCount) {
  if (!Array.isArray(ranges)) return false;
  if (lineCount === 0) return ranges.length === 0;
  let nextLine = 1;
  for (const range of ranges) {
    if (!range || !Number.isInteger(range.startLine) || !Number.isInteger(range.endLine) ||
        range.startLine !== nextLine || range.endLine < range.startLine || range.endLine > lineCount) {
      return false;
    }
    nextLine = range.endLine + 1;
  }
  return nextLine === lineCount + 1;
}

export function validateSemanticReviewRecord(record, snapshot, receipts, recordPath) {
  const errors = [];
  if (!record || record.schemaVersion !== 1) errors.push("invalid_schema_version");
  if (typeof record?.id !== "string" || !/^[a-z0-9][a-z0-9._-]{5,127}$/.test(record.id)) {
    errors.push("invalid_review_id");
  }
  if (recordPath !== `${semanticReviewDirectory}/${record?.id}.json`) errors.push("review_path_id_mismatch");
  if (record?.sourceFingerprintSha256 !== snapshot.sourceFingerprintSha256) {
    errors.push("source_fingerprint_mismatch");
  }
  if (!record?.reviewer || !["agent", "human"].includes(record.reviewer.kind) ||
      typeof record.reviewer.id !== "string" || record.reviewer.id.trim().length === 0) {
    errors.push("invalid_reviewer");
  }
  if (typeof record?.method !== "string" || record.method.trim().length === 0) errors.push("invalid_review_method");
  if (!Array.isArray(record?.files) || record.files.length === 0 || record.files.length > 500) {
    errors.push("invalid_review_files");
  } else {
    const seenPaths = new Set();
    const knownFindingIds = new Set([...expectedIds(), ...supplementalFindings.map((finding) => finding.id)]);
    for (const file of record.files) {
      const path = file?.path;
      if (!repositoryPathIsSafe(path)) {
        errors.push(`unsafe_review_path:${String(path)}`);
        continue;
      }
      if (seenPaths.has(path)) errors.push(`duplicate_review_path:${path}`);
      seenPaths.add(path);
      if (generatedOutputPaths.has(path) || path.startsWith(`${receiptDirectory}/`) ||
          path.startsWith(`${semanticReviewDirectory}/`)) {
        errors.push(`forbidden_review_target:${path}`);
      }
      const entry = snapshot.entriesByPath.get(path);
      if (!entry) {
        errors.push(`review_target_missing:${path}`);
        continue;
      }
      if (file.sha256 !== entry.sha256) errors.push(`review_hash_mismatch:${path}`);
      const binary = isBinary(entry.bytes, path);
      const coverage = file.coverage;
      if (!["full_semantic", "binary_metadata", "structural"].includes(coverage)) {
        errors.push(`invalid_review_coverage:${path}`);
      } else if (coverage === "binary_metadata" && !binary) {
        errors.push(`binary_metadata_for_text:${path}`);
      } else if ((coverage === "full_semantic" || coverage === "structural") && binary) {
        errors.push(`text_review_for_binary:${path}`);
      } else if (coverage === "structural" && extname(path).toLowerCase() !== ".svg") {
        errors.push(`structural_review_for_non_svg:${path}`);
      }
      const lineCount = binary ? 0 : lineCountForBytes(entry.bytes);
      if (coverage === "binary_metadata") {
        if (!Array.isArray(file.lineRanges) || file.lineRanges.length !== 0) {
          errors.push(`binary_review_has_line_ranges:${path}`);
        }
      } else if (!rangesCoverLineCount(file.lineRanges, lineCount)) {
        errors.push(`incomplete_review_line_ranges:${path}`);
      }
      if (!Array.isArray(file.findingIds) || file.findingIds.some((id) => !knownFindingIds.has(id))) {
        errors.push(`invalid_review_finding_ids:${path}`);
      }
      if (!Array.isArray(file.receiptIds)) {
        errors.push(`invalid_review_receipt_ids:${path}`);
      } else {
        for (const receiptId of file.receiptIds) {
          const located = receipts.get(receiptId);
          if (!located) {
            errors.push(`review_receipt_missing:${path}:${receiptId}`);
            continue;
          }
          const validation = validateExecutionReceipt(located.receipt, snapshot);
          if (!validation.valid) errors.push(`review_receipt_invalid:${path}:${receiptId}`);
          if (!promotableReceiptResultKinds.has(located.receipt.result?.kind) ||
              noOpExecutables.has(basename(located.receipt.command?.argv?.[0] ?? "").toLowerCase())) {
            errors.push(`review_receipt_non_promotable:${path}:${receiptId}`);
          }
        }
      }
    }
  }
  return { valid: errors.length === 0, errors: [...new Set(errors)].sort(compareCodePoints) };
}

function loadSemanticReviewRecords(snapshot, receipts) {
  const reviewsByPath = new Map();
  const recordIds = new Set();
  for (const entry of snapshot.entries) {
    if (!entry.path.startsWith(`${semanticReviewDirectory}/`)) continue;
    if (!entry.path.endsWith(".json")) fail(`Semantic review record must be JSON: ${entry.path}`);
    let record;
    try {
      record = JSON.parse(entry.bytes.toString("utf8"));
    } catch {
      fail(`Semantic review record is not valid JSON: ${entry.path}`);
    }
    if (recordIds.has(record.id)) fail(`Duplicate semantic review record ID: ${record.id}`);
    recordIds.add(record.id);
    const validation = validateSemanticReviewRecord(record, snapshot, receipts, entry.path);
    if (!validation.valid) fail(`Invalid semantic review record ${entry.path}: ${validation.errors.join(", ")}`);
    for (const file of record.files) {
      if (reviewsByPath.has(file.path)) fail(`Multiple semantic review records cover ${file.path}`);
      reviewsByPath.set(file.path, {
        reviewId: record.id,
        reviewer: record.reviewer,
        method: record.method,
        coverage: file.coverage,
        lineRanges: file.lineRanges,
        findingIds: file.findingIds,
        receiptIds: file.receiptIds,
        sha256: file.sha256
      });
    }
  }
  return reviewsByPath;
}

function executionSupportsClosure(execution) {
  return execution.outcome === "passed" && execution.receiptValidation === "valid" &&
    execution.attestationValidation === "trusted";
}

function resolveExecution(reference, receipts, snapshot) {
  if (reference.kind === "historical_execution_claim") {
    return {
      ...reference,
      outcome: "unrun",
      receiptValidation: "missing_historical_receipt"
    };
  }
  if (reference.kind !== "execution_receipt_reference") {
    return { ...reference, outcome: "invalid", receiptValidation: "unknown_reference_kind" };
  }
  const located = receipts.get(reference.receiptId);
  if (!located) {
    return { ...reference, outcome: "unrun", receiptValidation: "receipt_missing" };
  }
  const validation = validateExecutionReceipt(located.receipt, snapshot, reference);
  return {
    ...reference,
    receiptPath: located.path,
    receiptValidation: validation.valid ? "valid" : "invalid",
    validationErrors: validation.errors,
    outcome: validation.valid ? "passed" : located.receipt.result?.exitCode === 0 ? "invalid" : "failed",
    attestationValidation: "unavailable",
    attestationLimitation: trustedAttestationState.reason,
    command: located.receipt.command,
    runtime: located.receipt.runtime,
    result: located.receipt.result,
    log: located.receipt.log,
    sourceFingerprintSha256: located.receipt.sourceFingerprintSha256
  };
}

function safeAbsolutePath(path) {
  const absolutePath = resolve(repositoryRoot, path);
  if (absolutePath !== repositoryRoot && !absolutePath.startsWith(`${repositoryRoot}${sep}`)) {
    fail(`Inventory path escapes repository root: ${path}`);
  }
  return absolutePath;
}

function pathIsWithin(absolutePath, absoluteRoot) {
  return absolutePath === absoluteRoot || absolutePath.startsWith(`${absoluteRoot}${sep}`);
}

function assertRealDirectory(path, label) {
  const metadata = lstatSync(path);
  if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
    fail(`${label} must be a real directory, not a symlink or non-directory: ${path}`);
  }
}

function ensureSafeParentDirectory(absolutePath, allowedRoot, { createParents = true } = {}) {
  const root = resolve(allowedRoot);
  const target = resolve(absolutePath);
  if (!pathIsWithin(target, root) || target === root) {
    fail(`Write target escapes its allowed root: ${target}`);
  }
  if (!existsSync(root)) fail(`Allowed write root does not exist: ${root}`);
  assertRealDirectory(root, "Allowed write root");
  const canonicalRoot = realpathSync(root);
  const segments = relative(root, dirname(target)).split(sep).filter(Boolean);
  let current = root;
  for (const segment of segments) {
    current = join(current, segment);
    if (!existsSync(current)) {
      if (!createParents) return { target, canonicalRoot, parentMissing: true };
      // One component at a time prevents recursive mkdir from following a substituted ancestor.
      const parent = dirname(current);
      assertRealDirectory(parent, "Write parent");
      mkdirSync(current, { mode: 0o700 });
    }
    assertRealDirectory(current, "Write ancestor");
    const canonicalCurrent = realpathSync(current);
    if (!pathIsWithin(canonicalCurrent, canonicalRoot)) {
      fail(`Canonical write ancestor escapes its allowed root: ${current}`);
    }
  }
  if (existsSync(target)) {
    const metadata = lstatSync(target);
    if (metadata.isSymbolicLink() || !metadata.isFile()) {
      fail(`Write target must be a regular file, not a symlink or special file: ${target}`);
    }
  }
  return { target, canonicalRoot, parentMissing: false };
}

export function atomicWriteFileSafe(path, bytes, { allowedRoot, exclusive = false } = {}) {
  if (!Buffer.isBuffer(bytes)) fail("Atomic write content must be a Buffer");
  const target = assertSafeWriteTarget(path, { allowedRoot, exclusive, createParents: true });
  const temporaryPath = join(
    dirname(target),
    `.${basename(target)}.${process.pid}.${randomBytes(8).toString("hex")}.tmp`
  );
  let temporaryExists = false;
  try {
    const descriptor = openSync(temporaryPath, "wx", 0o600);
    temporaryExists = true;
    try {
      writeFileSync(descriptor, bytes);
      fsyncSync(descriptor);
    } finally {
      closeSync(descriptor);
    }
    if (exclusive) {
      linkSync(temporaryPath, target);
      unlinkSync(temporaryPath);
      temporaryExists = false;
    } else {
      renameSync(temporaryPath, target);
      temporaryExists = false;
    }
  } finally {
    if (temporaryExists && existsSync(temporaryPath)) unlinkSync(temporaryPath);
  }
  return target;
}

export function assertSafeWriteTarget(path, { allowedRoot, exclusive = false, createParents = false } = {}) {
  const { target } = ensureSafeParentDirectory(path, allowedRoot, { createParents });
  if (exclusive && existsSync(target)) fail(`Exclusive write target already exists: ${target}`);
  return target;
}

function gitObjectId(bytes, objectFormat) {
  const header = Buffer.from(`blob ${bytes.length}\0`);
  return createHash(objectFormat).update(header).update(bytes).digest("hex");
}

function isBinary(bytes, path) {
  const binaryExtensions = new Set([
    ".avif", ".gif", ".ico", ".jpeg", ".jpg", ".pdf", ".png", ".webp", ".woff", ".woff2"
  ]);
  if (binaryExtensions.has(extname(path).toLowerCase())) return true;
  return bytes.includes(0);
}

function contentKind(path, mode, binary) {
  if (mode === "120000") return "symlink";
  if (path.startsWith(`${receiptDirectory}/`)) return path.endsWith(".json") ? "execution_receipt" : "execution_log";
  if (path.startsWith(`${semanticReviewDirectory}/`)) return "semantic_review_record";
  if (path === ledgerPath || path === manifestPath || path.includes("/src/generated/")) return "generated";
  if (path === "pnpm-lock.yaml") return "lockfile";
  if (binary) return "binary_asset";
  if (extname(path).toLowerCase() === ".svg") return "structured_asset";
  if (path.includes("/migrations/") && path.endsWith(".down.sql")) return "rollback_migration";
  if (path.includes("/migrations/") && path.endsWith(".sql")) return "forward_migration";
  if (/\.(?:test|spec)\.[cm]?[jt]sx?$/.test(path) || path.includes("/test/")) return "test";
  if (path.startsWith("docs/") || path.endsWith(".md") || path.endsWith(".mdx")) return "documentation";
  if (path.startsWith(".github/")) return "workflow_configuration";
  if (path.startsWith("scripts/") || path.endsWith(".sh")) return "script";
  if (/\.(?:json|ya?ml|toml|env|example)$/.test(path) || path.startsWith(".")) return "configuration";
  return "source_or_project_text";
}

function domainsForPath(path) {
  if (path.startsWith("apps/api/")) return ["api"];
  if (path.startsWith("apps/web/")) return ["web"];
  if (path.startsWith("apps/worker/")) return ["worker"];
  if (path.startsWith("packages/database/")) return ["database"];
  if (path.startsWith("packages/contracts/")) return ["contracts"];
  if (path.startsWith("packages/")) return ["packages"];
  if (path.startsWith("docs/")) return ["documentation"];
  if (path.startsWith("scripts/")) return ["tooling"];
  if (path.startsWith(".github/")) return ["ci"];
  return ["repository"];
}

export function reviewClassification(path, baselineUnchanged, mode, semanticReview = null) {
  if (path === ledgerPath) {
    return {
      status: "generated_validated",
      reviewer: "scripts/generate-audit-evidence.mjs",
      method: "bounded source-register extraction with exact source hash, ID set, and count assertions",
      lineRanges: [],
      closureEligible: true,
      independentlyAttested: false,
      limitations: ["Resolution states remain conservative until final exact-tree evidence is recorded."]
    };
  }
  if (path.startsWith(`${receiptDirectory}/`)) {
    return {
      status: "machine_evidence_input",
      reviewer: "scripts/generate-audit-evidence.mjs",
      method: "receipt/log inventory; referenced receipts receive schema and exact tracked-index validation",
      lineRanges: [],
      closureEligible: true,
      independentlyAttested: false,
      limitations: ["A structurally valid receipt is a declaration until an approved external trust boundary independently attests it."]
    };
  }
  if (path.startsWith(`${semanticReviewDirectory}/`)) {
    return {
      status: "machine_review_input",
      reviewer: "scripts/generate-audit-evidence.mjs",
      method: "semantic-review record schema and exact source-fingerprint validation",
      lineRanges: [],
      closureEligible: true,
      independentlyAttested: false,
      limitations: ["This class validates the declaration record itself; it does not independently attest the declared review."]
    };
  }
  if (semanticReview) {
    const statusByCoverage = {
      full_semantic: "current_full_semantic_review_declaration",
      binary_metadata: "current_binary_metadata_review_declaration",
      structural: "current_structural_review_declaration"
    };
    return {
      status: statusByCoverage[semanticReview.coverage],
      reviewer: `${semanticReview.reviewer.kind}:${semanticReview.reviewer.id}`,
      method: semanticReview.method,
      lineRanges: semanticReview.lineRanges,
      closureEligible: false,
      independentlyAttested: false,
      limitations: [trustedAttestationState.reason]
    };
  }
  if (mode === "120000" && baselineUnchanged) {
    return {
      status: "symlink_accounted",
      reviewer: "scripts/generate-audit-evidence.mjs",
      method: "Git index mode and literal symlink-target blob inspection",
      lineRanges: [],
      closureEligible: false,
      independentlyAttested: false,
      limitations: ["Inventory of an unchanged symlink target is not independently attested semantic review."]
    };
  }
  if (mode === "120000") {
    return {
      status: "pending",
      reviewer: null,
      method: "literal symlink-target inventory only",
      lineRanges: [],
      closureEligible: false,
      independentlyAttested: false,
      limitations: [
        "A changed or new symlink target requires an exact-hash current semantic review; inventory alone does not approve the target."
      ]
    };
  }
  if (baselineUnchanged) {
    return {
      status: "external_attestation_only",
      reviewer: "external audit aggregate",
      method: "unchanged blob identity against audited baseline",
      lineRanges: [],
      closureEligible: false,
      independentlyAttested: false,
      limitations: [
        "The audit reports complete baseline accounting, but its per-path coverage manifest and reviewer evidence were not supplied."
      ]
    };
  }
  return {
    status: "pending",
    reviewer: null,
    method: "inventory and content hashing only",
    lineRanges: [],
    closureEligible: false,
    independentlyAttested: false,
    limitations: [
      "Current modified or new content cannot inherit the baseline semantic-review claim and has no per-file review annotation in this artifact."
    ]
  };
}

export function changedSymlinkCanonicalTarget(path, target) {
  if (typeof target !== "string" || target.length === 0 || target.includes("\0") ||
      target.includes("\\") || isAbsolute(target) || /^[A-Za-z]:/.test(target)) {
    fail(`Changed symlink has an absolute, empty, or ambiguous target: ${path}`);
  }
  const canonicalTarget = normalize(join(dirname(path), target)).split(sep).join("/");
  if (canonicalTarget === ".." || canonicalTarget.startsWith("../") || canonicalTarget.startsWith("/")) {
    fail(`Changed symlink target escapes the repository: ${path} -> ${target}`);
  }
  return canonicalTarget.replace(/^\.\//, "");
}

export function validateChangedSymlinkEvidence(
  path,
  target,
  { inventoriedPaths, semanticReviewPaths, modesByPath = new Map() }
) {
  const canonicalTargetPath = changedSymlinkCanonicalTarget(path, target);
  const targetPaths = [...inventoriedPaths].filter((candidate) =>
    candidate !== path && candidate !== manifestPath &&
    (candidate === canonicalTargetPath || candidate.startsWith(`${canonicalTargetPath}/`))
  );
  if (targetPaths.length === 0) {
    fail(`Changed symlink target is not separately inventoried: ${path} -> ${target}`);
  }
  if (modesByPath.get(canonicalTargetPath) === "120000") {
    fail(`Changed symlink cannot target another symlink: ${path} -> ${target}`);
  }
  if (!targetPaths.every((candidate) => semanticReviewPaths.has(candidate))) {
    fail(`Changed symlink canonical target lacks exact-hash review declarations: ${path} -> ${canonicalTargetPath}`);
  }
  return {
    canonicalTargetPath,
    targetPaths,
    targetInventoriedSeparately: true,
    targetReviewDeclarationsPresent: true
  };
}

function buildCoverageManifest(ledger, issueLedgerBytes, snapshot, originalEvidenceImport, semanticReviews) {
  const baselineEntries = baselineTree();
  const objectFormat = snapshot.objectFormat;
  const inventoryEntries = snapshot.entries.map((entry) =>
    entry.path === ledgerPath
      ? { ...entry, bytes: issueLedgerBytes, sha256: sha256(issueLedgerBytes), objectId: gitObjectId(issueLedgerBytes, objectFormat) }
      : entry
  );
  if (!inventoryEntries.some((entry) => entry.path === ledgerPath)) {
    inventoryEntries.push({
      path: ledgerPath,
      mode: "100644",
      objectId: gitObjectId(issueLedgerBytes, objectFormat),
      bytes: issueLedgerBytes,
      sha256: sha256(issueLedgerBytes),
      fingerprintIncluded: false
    });
  }
  inventoryEntries.sort((left, right) => compareCodePoints(left.path, right.path));
  const inventoriedPaths = new Set(inventoryEntries.map((entry) => entry.path));
  const inventoryEntriesByPath = new Map(inventoryEntries.map((entry) => [entry.path, entry]));
  const files = [];

  for (const entry of inventoryEntries) {
    if (entry.path === manifestPath) continue;
    const bytes = entry.bytes;
    const mode = entry.mode;
    const baselineEntry = baselineEntries.get(entry.path) ?? null;
    const currentObjectId = gitObjectId(bytes, objectFormat);
    const baselineUnchanged = Boolean(
      baselineEntry && currentObjectId && baselineEntry.objectId === currentObjectId && baselineEntry.mode === mode
    );
    const binary = isBinary(bytes, entry.path);
    const kind = contentKind(entry.path, mode, binary);
    const semanticReview = semanticReviews.get(entry.path) ?? null;
    const review = reviewClassification(entry.path, baselineUnchanged, mode, semanticReview);
    const lineCount = !binary && mode !== "120000"
      ? lineCountForBytes(bytes)
      : null;
    const symlinkTarget = mode === "120000" ? bytes.toString("utf8") : null;
    const changedSymlinkEvidence = mode === "120000" && !baselineUnchanged
      ? validateChangedSymlinkEvidence(entry.path, symlinkTarget, {
          inventoriedPaths,
          semanticReviewPaths: new Set(semanticReviews.keys()),
          modesByPath: new Map([...inventoryEntriesByPath].map(([path, value]) => [path, value.mode]))
        })
      : null;
    const symlinkCanonicalTarget = symlinkTarget
      ? changedSymlinkEvidence?.canonicalTargetPath ??
        normalize(join(dirname(entry.path), symlinkTarget)).split(sep).join("/")
      : null;
    const symlinkTargetInventoriedSeparately = changedSymlinkEvidence?.targetInventoriedSeparately ?? (
      symlinkCanonicalTarget
        ? inventoriedPaths.has(symlinkCanonicalTarget) ||
          [...inventoriedPaths].some((path) => path.startsWith(`${symlinkCanonicalTarget}/`))
        : false
    );
    const symlinkTargetReviewDeclarationsPresent = changedSymlinkEvidence?.targetReviewDeclarationsPresent ?? null;

    files.push({
      path: entry.path,
      provenance: entry.path === ledgerPath
        ? "generated_output"
        : entry.path.startsWith(`${receiptDirectory}/`)
          ? "tracked_execution_evidence"
          : "tracked_index",
      sourceFingerprintIncluded: entry.fingerprintIncluded === true,
      changeOrigin: baselineUnchanged
          ? "unchanged_baseline"
          : baselineEntry
            ? "index_delta_origin_not_inferred"
            : "new_index_path_origin_not_inferred",
      sourceState: baselineUnchanged
          ? "unchanged"
          : baselineEntry
            ? "modified"
            : "new",
      git: {
        mode,
        objectFormat,
        currentObjectId,
        indexObjectId: entry.objectId ?? null,
        baselineObjectId: baselineEntry?.objectId ?? null,
        baselineMode: baselineEntry?.mode ?? null
      },
      content: {
        sha256: sha256(bytes),
        bytes: bytes.length,
        lineCount,
        kind,
        binary
      },
      role: kind,
      domains: domainsForPath(entry.path),
      symlink: mode === "120000"
        ? {
            target: symlinkTarget,
            canonicalTargetPath: symlinkCanonicalTarget,
            targetInventoriedSeparately: symlinkTargetInventoriedSeparately,
            targetReviewDeclarationsPresent: symlinkTargetReviewDeclarationsPresent,
            targetIndependentlyAttested: false
          }
        : null,
      baselineAttestation: {
        applicable: baselineUnchanged,
        sourceAuditSha256: baselineUnchanged ? expectedAuditSha256 : null,
        perPathOriginalEvidenceAvailable: originalEvidenceImport.perPathCoverageManifestAvailable === true,
        semanticCoverageImported: originalEvidenceImport.semanticCoverageImported === true
      },
      review: {
        ...review,
        reviewedSha256: review.status !== "pending"
          ? sha256(bytes)
          : null,
        reviewRecordId: semanticReview?.reviewId ?? null,
        findingIds: semanticReview?.findingIds ?? [],
        testEvidence: semanticReview?.receiptIds ?? []
      }
    });
  }

  const pendingCoverage = files.filter((file) => file.review.closureEligible !== true);
  const manifestState = ledger.ledgerState === "final" && pendingCoverage.length === 0 &&
    trustedAttestationState.closureEligible ? "final" : "working";

  return {
    schemaVersion: 2,
    manifestState,
    generator: {
      path: relative(repositoryRoot, scriptPath).split(sep).join("/"),
      version: 2,
      deterministicRules: [
        "Object keys and path arrays use code-point ordering rather than locale-dependent comparison.",
        "Tracked content is read from stage-zero Git index blobs; protected dirty and untracked worktree bytes are never input.",
        "The generated ledger, self manifest, execution-receipt prefix, and semantic-review-record prefix are excluded from the stable source fingerprint.",
        "The ledger is inventoried from the same in-memory generated bytes used for output without entering the source fingerprint.",
        "Local receipts and semantic review records are declarations and remain closure-ineligible without separately provisioned trusted attestation.",
        "Branch, remote, commit SHA, timestamps, and machine-specific absolute paths are omitted; commit association belongs to an external CI/release attestation."
      ]
    },
    repository: {
      baselineSha,
      gitObjectFormat: objectFormat,
      sourceSnapshotKind: snapshot.kind,
      sourceFingerprintSha256: snapshot.sourceFingerprintSha256,
      commitAssociation: "external_ci_or_release_receipt_required"
    },
    trustedClosureAttestation: trustedAttestationState,
    preservationCheckpoint: {
      ...preservationCheckpoint,
      scope: "historical_preserved_workspace_checkpoint_not_current_committed_source"
    },
    auditBasis: {
      sourceName: auditSourceName,
      sourceSha256: expectedAuditSha256,
      inputProvisioning: "explicit_hash_pinned_repo_or_ci_input_required",
      baselineTrackedPathCount: expectedBaselinePathCount,
      originalAggregateClaim: {
        textCodeConfigDocumentationFullSemantic: 1024,
        rasterMetadataOnly: 34,
        svgStructural: 8,
        generatedValidated: 2,
        migrationSymlink: 1
      },
      originalEvidenceImport,
      originalPerPathManifestAvailable: originalEvidenceImport.perPathCoverageManifestAvailable === true,
      originalSemanticCoverageImported: originalEvidenceImport.semanticCoverageImported === true,
      carryForwardRule: "Exact baseline blob identity retains only the unavailable aggregate claim until per-path evidence is imported and independently attested. Changed/current review records are declarations; hashes and reviewer strings never create trusted semantic coverage."
    },
    inventory: {
      trackedIndexPaths: snapshot.entries.length,
      sourceFingerprintIncludedPaths: snapshot.fingerprintRows.length,
      sourceFingerprintExcludedTrackedPaths: snapshot.entries.filter((entry) => !entry.fingerprintIncluded).length,
      accountedFiles: files.length,
      excludedFiles: 1,
      byContentKind: countBy(files, (file) => file.content.kind),
      byReviewStatus: countBy(files, (file) => file.review.status),
      bySourceState: countBy(files, (file) => file.sourceState),
      workspaceObservation: "reported separately; never incorporated into this committed JSON"
    },
    scopeExclusions: [
      {
        path: manifestPath,
        coverageInventory: "self_excluded",
        sourceFingerprint: "excluded",
        reason: "The generated coverage manifest cannot inventory or fingerprint its own bytes."
      },
      {
        path: ledgerPath,
        coverageInventory: "inventoried_from_generated_bytes",
        sourceFingerprint: "excluded",
        reason: "The generated ledger is accounted for but excluded from the source fingerprint to prevent recursive invalidation."
      },
      {
        pathPrefix: `${receiptDirectory}/`,
        coverageInventory: "inventoried_and_validated",
        sourceFingerprint: "excluded",
        reason: "Receipts bind to the source fingerprint and therefore cannot be inputs to that same fingerprint."
      },
      {
        pathPrefix: `${semanticReviewDirectory}/`,
        coverageInventory: "inventoried_and_validated",
        sourceFingerprint: "excluded",
        reason: "Exact-hash semantic review records bind to the source fingerprint and therefore cannot be inputs to that same fingerprint."
      }
    ],
    unresolvedCoverage: pendingCoverage
      .map((file) => ({ path: file.path, sha256: file.content.sha256, reason: file.review.limitations[0] })),
    files
  };
}

function validateLedgerForOutput(ledger) {
  if (ledger.issues.length !== 159) fail(`Ledger contains ${ledger.issues.length} issues instead of 159`);
  if (new Set(ledger.issues.map((issue) => issue.id)).size !== 159) fail("Ledger issue IDs are not unique");
  const expected = new Set(expectedIds());
  const registered = new Set(issueDispositionRegistry.keys());
  const missingRegistryIds = [...expected].filter((id) => !registered.has(id));
  const unexpectedRegistryIds = [...registered].filter((id) => !expected.has(id));
  if (missingRegistryIds.length > 0 || unexpectedRegistryIds.length > 0) {
    fail(`Disposition registry mismatch; missing=${missingRegistryIds.join(",") || "none"}; unexpected=${unexpectedRegistryIds.join(",") || "none"}`);
  }
  const supplementalIds = ledger.supplementalFindings.map((finding) => finding.id);
  if (new Set(supplementalIds).size !== supplementalIds.length || supplementalIds.some((id) => !/^PR134-\d{3}$/.test(id))) {
    fail("Supplemental finding IDs must be unique PR134-NNN values");
  }
  for (const finding of ledger.supplementalFindings) {
    if (finding.relatedBaselineIds.length === 0 || finding.relatedBaselineIds.some((id) => !expected.has(id))) {
      fail(`${finding.id} must link only to known baseline IDs`);
    }
  }
  if (ledger.summary.baseline.recordCount !== 159 ||
      ledger.summary.supplemental.recordCount !== ledger.supplementalFindings.length) {
    fail("Baseline and supplemental summary counts are inconsistent");
  }
  const allRecords = [...ledger.issues, ...ledger.supplementalFindings];
  const hasUnresolved = allRecords.some((issue) => issue.finalDisposition === "unresolved");
  const expectedLedgerState = hasUnresolved ? "working" : "final";
  if (ledger.ledgerState !== expectedLedgerState) {
    fail(`Ledger state mismatch: expected ${expectedLedgerState}, received ${ledger.ledgerState}`);
  }
  if (ledger.ledgerState === "final" && hasUnresolved) {
    fail("A final ledger cannot contain unresolved dispositions");
  }
  for (const issue of allRecords) {
    if (issue.finalDisposition === "blocked_external") {
      if (issue.externalPrerequisites.length === 0) fail(`${issue.id} is blocked_external without a named prerequisite`);
      for (const prerequisite of issue.externalPrerequisites) {
        for (const field of ["owner", "prerequisite", "proofCommand", "failClosedState"]) {
          if (typeof prerequisite[field] !== "string" || prerequisite[field].trim().length === 0) {
            fail(`${issue.id} is blocked_external without ${field}`);
          }
        }
      }
    }
    if (issue.finalDisposition === "fixed") {
      if (!issue.verification.finalTreeEvidenceRecorded) fail(`${issue.id} is fixed without final-tree verification evidence`);
      if (issue.affectedPaths.length === 0) fail(`${issue.id} is fixed without affected paths`);
      if (issue.verification.executions.length === 0) fail(`${issue.id} is fixed without an executed check`);
      if (issue.verification.executions.some((execution) =>
        !executionSupportsClosure(execution)
      )) {
        fail(`${issue.id} is fixed without valid independently attested execution receipts`);
      }
    }
    if (issue.finalDisposition === "deferred_scope") {
      const decision = issue.resolution.scopeDecision;
      if (!decision || typeof decision.authority !== "string" || typeof decision.acceptedBehavior !== "string") {
        fail(`${issue.id} is deferred_scope without a cited scope decision`);
      }
    }
    if (issue.finalDisposition === "superseded" && (
      issue.verification.executions.length === 0 ||
      issue.verification.executions.some((execution) => !executionSupportsClosure(execution))
    )) {
      fail(`${issue.id} is superseded without valid independently attested replacement/withdrawal evidence`);
    }
  }
}

function validateCoverageManifestForOutput(manifest, ledger) {
  const pendingCoverage = manifest.unresolvedCoverage.length;
  const attestationReady = manifest.trustedClosureAttestation?.closureEligible === true;
  const expectedState = ledger.ledgerState === "final" && pendingCoverage === 0 && attestationReady
    ? "final"
    : "working";
  if (manifest.manifestState !== expectedState) {
    fail(`Coverage manifest state mismatch: expected ${expectedState}, received ${manifest.manifestState}`);
  }
  if (manifest.manifestState === "final" &&
      (ledger.ledgerState !== "final" || pendingCoverage > 0 || !attestationReady)) {
    fail("A final coverage manifest requires a final ledger, no pending coverage, and trusted closure attestation");
  }
}

export function finalEvidenceStateErrors(ledger, manifest) {
  const errors = [];
  const unresolved = [...ledger.issues, ...ledger.supplementalFindings]
    .filter((record) => record.finalDisposition === "unresolved");
  if (ledger.ledgerState !== "final") errors.push(`ledger_not_final:${ledger.ledgerState}`);
  if (unresolved.length > 0) errors.push(`unresolved_findings:${unresolved.length}`);
  if (manifest.manifestState !== "final") errors.push(`manifest_not_final:${manifest.manifestState}`);
  if (manifest.unresolvedCoverage.length > 0) errors.push(`pending_coverage:${manifest.unresolvedCoverage.length}`);
  if (manifest.trustedClosureAttestation?.closureEligible !== true) {
    errors.push("trusted_closure_attestation:unavailable");
  }
  return errors;
}

function writeOrCheck(path, expectedBytes, check, stalePaths) {
  const absolutePath = safeAbsolutePath(path);
  ensureSafeParentDirectory(absolutePath, repositoryRoot, { createParents: !check });
  if (check) {
    if (!existsSync(absolutePath) || !readFileSync(absolutePath).equals(expectedBytes)) stalePaths.push(path);
    return;
  }
  atomicWriteFileSafe(absolutePath, expectedBytes, { allowedRoot: repositoryRoot });
}

function workspaceReportRoot(path) {
  const absolutePath = resolve(path);
  const temporaryRoot = resolve(tmpdir());
  if (pathIsWithin(absolutePath, temporaryRoot)) return temporaryRoot;
  fail(`Workspace report must stay below the OS temporary directory: ${absolutePath}`);
}

function main() {
  const { auditPath, check, workspaceReportPath, printSourceFingerprint } = parseArguments(process.argv.slice(2));
  if (!printSourceFingerprint && !auditPath) {
    fail("--audit PATH is required for generation and closure checks; CI must provision the hash-pinned audit input explicitly");
  }
  assertNoProhibitedStagedPaths();
  const snapshot = buildIndexSnapshot();
  const workspaceObservation = observeWorkspace();
  if (workspaceReportPath) {
    atomicWriteFileSafe(workspaceReportPath, Buffer.from(stableJson(workspaceObservation)), {
      allowedRoot: workspaceReportRoot(workspaceReportPath)
    });
  }
  if (printSourceFingerprint) {
    process.stdout.write(`${snapshot.sourceFingerprintSha256}\n`);
    return;
  }
  const parsedAudit = parseAudit(auditPath);
  const receipts = loadExecutionReceipts(snapshot);
  const semanticReviews = loadSemanticReviewRecords(snapshot, receipts);
  const originalEvidenceImport = loadOriginalEvidenceImport(snapshot);
  const ledger = buildIssueLedger(parsedAudit, { snapshot, receipts, originalEvidenceImport });
  validateLedgerForOutput(ledger);
  const ledgerBytes = Buffer.from(stableJson(ledger));
  const manifest = buildCoverageManifest(ledger, ledgerBytes, snapshot, originalEvidenceImport, semanticReviews);
  validateCoverageManifestForOutput(manifest, ledger);
  const manifestBytes = Buffer.from(stableJson(manifest));
  const stalePaths = [];

  writeOrCheck(ledgerPath, ledgerBytes, check, stalePaths);
  writeOrCheck(manifestPath, manifestBytes, check, stalePaths);
  const workspaceSummary =
    `Workspace observation (excluded from committed evidence): ${workspaceObservation.trackedIndexCount} tracked index, ` +
    `${workspaceObservation.protectedDirty.length} protected dirty, ` +
    `${workspaceObservation.otherDirty.length} other dirty, ${workspaceObservation.untracked.length} untracked.\n`;

  const closureErrors = finalEvidenceStateErrors(ledger, manifest);
  if (check && (stalePaths.length > 0 || closureErrors.length > 0)) {
    if (stalePaths.length > 0) process.stderr.write(`Audit evidence is stale: ${stalePaths.join(", ")}\n`);
    if (closureErrors.length > 0) {
      process.stderr.write(`Audit evidence is current-model but not closure-ready: ${closureErrors.join(", ")}\n`);
    }
    process.stdout.write(workspaceSummary);
    process.exitCode = 1;
    return;
  }

  process.stdout.write(
    check
      ? `Audit evidence is current (${ledger.issues.length} baseline + ${ledger.supplementalFindings.length} supplemental findings, ${manifest.inventory.accountedFiles} accounted files).\n`
      : `Generated audit evidence (${ledger.issues.length} baseline + ${ledger.supplementalFindings.length} supplemental findings, ${manifest.inventory.accountedFiles} accounted files).\n`
  );
  process.stdout.write(workspaceSummary);
}

if (process.argv[1] && resolve(process.argv[1]) === scriptPath) main();
