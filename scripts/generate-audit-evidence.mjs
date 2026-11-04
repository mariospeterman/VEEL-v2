#!/usr/bin/env node

import { createHash } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readlinkSync,
  statSync,
  writeFileSync
} from "node:fs";
import { dirname, extname, join, normalize, relative, resolve, sep } from "node:path";
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

function registerDisposition(ids, definition) {
  for (const id of ids) {
    if (issueDispositionRegistry.has(id)) fail(`Duplicate disposition registry entry: ${id}`);
    issueDispositionRegistry.set(id, Object.freeze({ ...definition }));
  }
}

function passed(command, evidencePaths, environment = "local Node.js 22.23.4 worktree") {
  return Object.freeze({
    kind: "executed_check",
    command,
    environment,
    outcome: "passed",
    evidencePaths
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
  executions: [passed("pnpm deps:check && pnpm audit:prod", ["scripts/audit-production-dependencies.test.mjs", "docs/v2-new-build/dependency-security-status.md"])]
});

superseded(["ROOT-02"], {
  summary: "The generalized wallet-profile failure was withdrawn by the audit; the remaining redundant lookup was also removed and covered against canonical users.id.",
  affectedPaths: ["apps/api/src/modules/profile/profile-creator-repository.ts"],
  executions: [passed("pnpm --filter @veel/api exec vitest run test/profile-creator-repository.test.ts", ["apps/api/test/profile-creator-repository.test.ts"])]
});

fixed(["ROOT-03", "ROOT-04"], {
  summary: "Creator earnings are grouped by asset and public memberships use the canonical active-plan mapper instead of a duplicate hardcoded presenter.",
  affectedPaths: ["apps/api/src/modules/profile/profile-dashboard-repository.ts", "apps/api/src/modules/profile/profile-user-mappers.ts", "apps/web/app/app/profile/earnings/page.tsx"],
  executions: [passed("pnpm --filter @veel/api exec vitest run test/profile-dashboard-mappers.test.ts test/profile-user-mappers.test.ts test/profile-creator-repository.test.ts", ["apps/api/test/profile-dashboard-mappers.test.ts", "apps/api/test/profile-user-mappers.test.ts"])]
});

fixed(["ROOT-05"], {
  summary: "Staging migration convergence now classifies only a verified pending suffix and rejects history holes, unknown remote versions, and changed applied SQL.",
  affectedPaths: ["scripts/check-supabase-migration-history.mjs", "scripts/migration-history-classifier.mjs"],
  executions: [passed("node --test scripts/migration-history-classifier.test.mjs", ["scripts/migration-history-classifier.test.mjs"])]
});

fixed(["ROOT-06"], {
  summary: "Staging journeys are derived from exact-release evidence and required proof outcomes; missing, stale, blocked, or failed evidence cannot become PASS.",
  affectedPaths: ["scripts/staging-acceptance-status.mjs", "scripts/staging-acceptance.mjs", "docs/v2-new-build/operator/staging-acceptance.json"],
  executions: [passed("pnpm exec vitest run scripts/staging-gates.test.mjs", ["scripts/staging-gates.test.mjs"])]
});

fixed(["ROOT-07"], {
  summary: "SOLANA_CLUSTER is canonical, all compatibility projections reject contradictions, and staging compares private RPC genesis to the official cluster endpoint.",
  affectedPaths: ["packages/config/src/public.ts", "packages/config/src/index.ts", "apps/web/src/public-env.ts", "scripts/verify-solana-rpc-network.mjs"],
  executions: [passed("pnpm --filter @veel/config test && pnpm --filter @veel/web test -- src/public-env.test.ts && node --test scripts/verify-solana-rpc-network.test.mjs scripts/staging-gates.test.mjs", ["packages/config/src/index.test.ts", "apps/web/src/public-env.test.ts", "scripts/verify-solana-rpc-network.test.mjs"])]
});

superseded(["ROOT-08"], {
  summary: "The legacy generic assistant execution surface was retired: capabilities expose no executable tools and session/tool-call writes return provider_unavailable instead of canned success.",
  affectedPaths: ["apps/api/src/modules/ai/ai-route-policy.ts", "apps/api/src/modules/ai/ai-routes.ts", "docs/v2-new-build/safety-admin-ai.md"],
  executions: [passed("pnpm --filter @veel/api exec vitest run test/app.test.ts test/mcp.test.ts", ["apps/api/test/app.test.ts", "apps/api/test/mcp.test.ts"])]
});

fixed(["ROOT-09", "INT-01", "INT-02"], {
  summary: "One guarded wildcard integration command discovers the Didit lifecycle suite, CI calls that command, and the suite uses the shared non-production database-target guard.",
  affectedPaths: ["apps/api/package.json", ".github/workflows/ci.yml", "apps/api/test/didit-verification.integration.test.ts", "apps/api/test/integration-database.ts"],
  executions: [passed("node --test scripts/api-integration-suite.test.mjs", ["scripts/api-integration-suite.test.mjs"]), passed("pnpm --filter @veel/api test:integration", ["apps/api/test/didit-verification.integration.test.ts"], "disposable PostgreSQL; provider HTTP fixtures")]
});

fixed(["AUTH-01", "AUTH-02", "AUTH-03", "AUTH-04", "AUTH-05", "AUTH-06", "AUTH-16", "AUTH-22", "AUTH-23"], {
  summary: "Verification now reserves durable handoff state, separates launch TTL from decision validity, maps provider subjects correctly, applies monotonic decisions, reconciles early callbacks, preserves distinct Sumsub events, and uses a real hosted launch contract.",
  affectedPaths: ["apps/api/src/modules/verification/verification-repository.ts", "apps/api/src/modules/verification/verification-provider-adapters.ts", "apps/api/src/modules/age/age-repository.ts", "packages/database/migrations/0122_verification_lifecycle_hardening.sql"],
  executions: [passed("pnpm --filter @veel/api exec vitest run test/app.test.ts test/didit-verification.integration.test.ts", ["apps/api/test/app.test.ts", "apps/api/test/didit-verification.integration.test.ts"]), passed("pnpm --filter @veel/api test:integration -- didit-verification.integration.test.ts", ["packages/database/migrations/0122_verification_lifecycle_hardening.sql"], "disposable PostgreSQL; signed provider fixtures")]
});

fixed(["AUTH-07"], {
  summary: "Recovery exchange is bound to the genuine provider session/authentication time and a per-user revocation epoch, including logout-all races.",
  affectedPaths: ["apps/api/src/modules/session/supabase-auth.ts", "packages/database/migrations/0119_recovery_session_revocation_boundary.sql"],
  executions: [passed("pnpm --filter @veel/api exec vitest run test/supabase-auth.test.ts test/recovery-session-revocation.integration.test.ts", ["apps/api/test/supabase-auth.test.ts", "apps/api/test/recovery-session-revocation.integration.test.ts"])]
});

fixed(["AUTH-08"], {
  summary: "OAuth authorization-code consumption and token insertion now share one transaction and one code can mint at most one token under concurrency.",
  affectedPaths: ["apps/api/src/modules/mcp/mcp-repository.ts", "packages/database/migrations/0125_mcp_oauth_atomic_redemption.sql"],
  executions: [passed("pnpm --filter @veel/api exec vitest run test/mcp-oauth-redemption.integration.test.ts test/mcp.test.ts", ["apps/api/test/mcp-oauth-redemption.integration.test.ts"])]
});

fixed(["AUTH-11", "AUTH-18"], {
  summary: "Admin lists use endpoint-scoped compound keysets from the last returned row, including priority boundaries; live SQL columns are qualified and parsed by PostgreSQL.",
  affectedPaths: ["apps/api/src/modules/admin/admin-repository-mapper-utils.ts", "apps/api/src/modules/admin/admin-repository-event-ops.ts"],
  executions: [passed("pnpm --filter @veel/api exec vitest run src/modules/admin/admin-repository-mapper-utils.test.ts test/admin-pagination.integration.test.ts test/admin-staff.integration.test.ts", ["apps/api/src/modules/admin/admin-repository-mapper-utils.test.ts", "apps/api/test/admin-pagination.integration.test.ts"])]
});

fixed(["AUTH-12", "AUTH-13", "AUTH-19", "AUTH-21"], {
  summary: "Admin operations now use canonical open-report, exact feature-flag, verification-record, and minimized MCP tool projections.",
  affectedPaths: ["apps/api/src/modules/admin/admin-repository-access.ts", "apps/api/src/modules/admin/admin-repository-feature-flag.ts", "apps/api/src/modules/admin/admin-repository-event-ops.ts", "packages/database/migrations/0127_admin_operations_projection_authority.sql"],
  executions: [passed("pnpm --filter @veel/api exec vitest run test/admin-authority-projections.integration.test.ts", ["apps/api/test/admin-authority-projections.integration.test.ts"], "disposable PostgreSQL")]
});

fixed(["AUTH-14"], {
  summary: "MCP tool quotas use the distributed limiter boundary keyed by connection and tool-risk bucket, with bounded expiry and two-replica coverage.",
  affectedPaths: ["apps/api/src/modules/mcp/mcp-routes.ts"],
  executions: [passed("pnpm --filter @veel/api exec vitest run test/mcp.test.ts", ["apps/api/test/mcp.test.ts"])]
});

fixed(["AUTH-17"], {
  summary: "A concurrent consumed wallet-proof loser maps to the documented invalid-proof response instead of the global 500 path.",
  affectedPaths: ["apps/api/src/modules/auth/wallet-auth-routes.ts"],
  executions: [passed("pnpm --filter @veel/api exec vitest run test/app.test.ts", ["apps/api/test/app.test.ts"])]
});

fixed(["AUTH-20"], {
  summary: "Organization owner-set changes serialize on one organization-scoped lock and recheck the last-owner invariant transactionally.",
  affectedPaths: ["apps/api/src/modules/admin/admin-repository-organization.ts"],
  executions: [passed("pnpm --filter @veel/api exec vitest run test/admin-staff.integration.test.ts", ["apps/api/test/admin-staff.integration.test.ts"], "disposable PostgreSQL")]
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
  executions: [passed("pnpm --filter @veel/api exec vitest run test/content-media-repository.test.ts test/app.test.ts", ["apps/api/test/content-media-repository.test.ts"])]
});

fixed(["CONTENT-02", "CONTENT-03"], {
  summary: "Video creation is durably reserved before provider side effects and Bunny receipt plus replay work is recoverable and idempotent after interruption.",
  affectedPaths: ["apps/api/src/modules/content/content-media-repository.ts", "apps/api/src/modules/content/media-upload-adapter.ts", "packages/database/migrations/0123_media_upload_operation_hardening.sql"],
  executions: [passed("pnpm --filter @veel/api exec vitest run test/content-media-durability.integration.test.ts test/media-upload-adapter.test.ts", ["apps/api/test/content-media-durability.integration.test.ts", "apps/api/test/media-upload-adapter.test.ts"])]
});

fixed(["CONTENT-04"], {
  summary: "Like/save/comment-like commands reserve durable actor/action/target/key receipts so delayed A/B/A replays cannot toggle state again.",
  affectedPaths: ["apps/api/src/modules/engagement/engagement-content-actions-repository.ts", "apps/api/src/modules/engagement/engagement-comment-repository.ts"],
  executions: [passed("pnpm --filter @veel/api test:integration", ["apps/api/test/authenticated-happy-path.integration.test.ts"], "disposable PostgreSQL")]
});

fixed(["CONTENT-05", "CONTENT-06"], {
  summary: "Discover reuses canonical eligibility and signed media projections, while mixed search carries typed per-group compound cursors and rejects legacy cross-type values.",
  affectedPaths: ["apps/api/src/modules/discover/discover-content-queries.ts", "apps/api/src/modules/discover/discover-cursor.ts", "apps/api/src/modules/discover/discover-routes.ts"],
  executions: [passed("pnpm --filter @veel/api exec vitest run test/discover-cursor.test.ts test/discover-authority.integration.test.ts test/app.test.ts", ["apps/api/test/discover-cursor.test.ts", "apps/api/test/discover-authority.integration.test.ts"])]
});

fixed(["CONTENT-09"], {
  summary: "Mutuals presentation media kind is derived from migrated content/media fields rather than the nonexistent content_items.media_kind column.",
  affectedPaths: ["apps/api/src/modules/mutuals/mutuals-repository.ts", "apps/api/src/modules/mutuals/mutuals-repository-mappers.ts"],
  executions: [passed("pnpm --filter @veel/api exec vitest run test/mutuals-repository-mappers.test.ts", ["apps/api/test/mutuals-repository-mappers.test.ts"])]
});

fixed(["CONTENT-12"], {
  summary: "Creator-request acceptance is bound to an exact monotonic terms revision; only creator counteroffers can change the price or delivery/cancellation terms.",
  affectedPaths: ["apps/api/src/modules/message/message-commercial-repository.ts", "packages/database/migrations/0124_structured_creator_request_terms_revision.sql"],
  executions: [passed("pnpm --filter @veel/api exec vitest run test/app.test.ts", ["apps/api/test/app.test.ts", "packages/database/test/migrations.test.ts"])]
});

fixed(["CONTENT-13"], {
  summary: "Paid-event chat now grants membership access only when the room explicitly includes profile members; otherwise an Event Access/live pass is required.",
  affectedPaths: ["apps/api/src/modules/live/live-chat-repository.ts"],
  executions: [passed("pnpm --filter @veel/api exec vitest run test/app.test.ts", ["apps/api/test/app.test.ts"])]
});

fixed(["CONTENT-15"], {
  summary: "Managed-creator reporting includes historical allocations only when the exact referenced agreement granted analytics permission.",
  affectedPaths: ["apps/api/src/modules/managed-creator/managed-creator-repository.ts"],
  executions: [passed("pnpm --filter @veel/api exec vitest run test/managed-creator-reporting.integration.test.ts", ["apps/api/test/managed-creator-reporting.integration.test.ts"], "disposable PostgreSQL")]
});

fixed(["CONTENT-19"], {
  summary: "Private image objects are projected through short-lived authorized canonical delivery capabilities, including bounded width variants and revoked-access denial.",
  affectedPaths: ["apps/api/src/modules/content/content-route-shared.ts", "apps/web/app/content/content-renderer.tsx"],
  executions: [passed("pnpm --filter @veel/api exec vitest run test/content-image-delivery.test.ts", ["apps/api/test/content-image-delivery.test.ts"])]
});

fixed(["CONTENT-20"], {
  summary: "Purpose-bound performer verification persists threshold_age and result_over_threshold so approved adult evidence reaches canonical performer release readiness.",
  affectedPaths: ["apps/api/src/modules/verification/verification-repository.ts"],
  executions: [passed("pnpm --filter @veel/api exec vitest run test/didit-verification.integration.test.ts", ["apps/api/test/didit-verification.integration.test.ts"], "disposable PostgreSQL; signed provider fixtures")]
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
  executions: [passed("pnpm --filter @veel/api exec vitest run test/payment-solana.test.ts", ["apps/api/test/payment-solana.test.ts"])]
});

fixed(["PAY-06"], {
  summary: "Solana receipt and normalized replay event writes share one transaction, and authenticated redelivery repairs a historical receipt-only orphan.",
  affectedPaths: ["apps/api/src/modules/payment/payment-evidence-repository.ts"],
  executions: [passed("pnpm --filter @veel/api exec vitest run test/payment-evidence-repository.test.ts", ["apps/api/test/payment-evidence-repository.test.ts"])]
});

fixed(["PAY-07", "PAY-08"], {
  summary: "Confirmation-email leasing filters deliverable recipients before the limit, retries classified transient failures, fences stale leases, and dead-letters permanent/exhausted work.",
  affectedPaths: ["apps/worker/src/payment-confirmation-email.ts"],
  executions: [passed("pnpm --filter @veel/api exec vitest run test/payment-confirmation-email.integration.test.ts && pnpm --filter @veel/worker test", ["apps/api/test/payment-confirmation-email.integration.test.ts", "apps/worker/test/index.test.ts"])]
});

fixed(["PAY-09"], {
  summary: "Receipt email formats stored atomic token amounts with exact asset decimals instead of printing raw integers as whole SOL/USDC.",
  affectedPaths: ["apps/worker/src/payment-confirmation-email.ts", "apps/web/src/format-asset-amount.ts"],
  executions: [passed("pnpm --filter @veel/worker test && pnpm --filter @veel/web exec vitest run test/format-asset-amount.test.ts", ["apps/worker/test/index.test.ts", "apps/web/test/format-asset-amount.test.ts"])]
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
  executions: [passed("pnpm --filter @veel/api exec vitest run test/notification-push-delivery.integration.test.ts test/app.test.ts && pnpm --filter @veel/worker test", ["apps/api/test/notification-push-delivery.integration.test.ts", "apps/worker/test/index.test.ts"])]
});

fixed(["WA-05", "WA-06"], {
  summary: "Suppressed analytics points hide sample size and platform queries require the canonical analytics-read permission with bounded audit purpose.",
  affectedPaths: ["apps/api/src/modules/analytics/analytics-service.ts", "apps/api/src/modules/analytics/analytics-routes.ts", "apps/api/src/modules/admin/admin-route-auth.ts"],
  executions: [passed("pnpm --filter @veel/api exec vitest run test/analytics.test.ts test/analytics-core.integration.test.ts test/admin-permissions.test.ts", ["apps/api/test/analytics.test.ts", "apps/api/test/analytics-core.integration.test.ts"])]
});

fixed(["WA-07", "WA-08", "WA-09", "WA-10", "WA-11", "WA-12"], {
  summary: "Analytics projections snapshot one media asset, scope replay identity correctly, enqueue minute work, enforce raw retention, compare per-source reconciliation, and dead-letter exhausted recovered leases.",
  affectedPaths: ["apps/worker/src/analytics-projections.ts", "packages/database/migrations/0126_analytics_projection_retention_hardening.sql"],
  executions: [passed("pnpm --filter @veel/worker test && pnpm --filter @veel/api exec vitest run test/analytics-core.integration.test.ts", ["apps/worker/test/index.test.ts", "apps/api/test/analytics-core.integration.test.ts"], "unit plus disposable PostgreSQL")]
});

fixed(["FE-01", "FE-02"], {
  summary: "Private message retry work is actor/session/conversation scoped, cleared on logout/account switch, retains transient failures, and preserves logical-send idempotency.",
  affectedPaths: ["apps/web/app/messages/message-composer.tsx", "apps/web/src/messages/offline-message-queue.ts"],
  executions: [passed("pnpm --filter @veel/web exec vitest run src/messages/offline-message-queue.test.ts src/session/clear-user-scoped-browser-state.test.ts", ["apps/web/src/messages/offline-message-queue.test.ts", "apps/web/src/session/clear-user-scoped-browser-state.test.ts"])]
});

fixed(["FE-06"], {
  summary: "All affected continuation paths use one exact-origin parser that rejects network paths, backslashes, encoded separators, credentials, and control characters.",
  affectedPaths: ["apps/web/src/navigation/safe-same-origin-path.ts", "apps/web/app/auth/confirm/route.ts"],
  executions: [passed("pnpm --filter @veel/web exec vitest run src/navigation/safe-same-origin-path.test.ts app/auth/confirm/route.test.ts", ["apps/web/src/navigation/safe-same-origin-path.test.ts", "apps/web/app/auth/confirm/route.test.ts"])]
});

fixed(["FE-17"], {
  summary: "Recent searches are actor-scoped, session-bounded, expiring, clearable, and removed with other private browser state on logout or account switch.",
  affectedPaths: ["apps/web/src/search/recent-searches.ts", "apps/web/app/app/search/search-experience.tsx"],
  executions: [passed("pnpm --filter @veel/web exec vitest run src/search/recent-searches.test.ts src/session/clear-user-scoped-browser-state.test.ts", ["apps/web/src/search/recent-searches.test.ts"])]
});

fixed(["FE-20"], {
  summary: "Subscription cents and token atomic integers use separate exact bigint-safe parsers/formatters; consumer forms no longer ask for raw atomic values.",
  affectedPaths: ["apps/web/src/format-asset-amount.ts", "apps/web/src/commercial-amount-input.ts", "apps/web/src/subscription-price-input.ts"],
  executions: [passed("pnpm --filter @veel/web exec vitest run test/format-asset-amount.test.ts test/money-input-boundaries.test.ts", ["apps/web/test/format-asset-amount.test.ts", "apps/web/test/money-input-boundaries.test.ts"])]
});

fixed(["FE-25"], {
  summary: "Backend-confirmed access payments trigger bounded canonical projection refresh while the UI remains awaiting_projection until the owning domain grants access.",
  affectedPaths: ["apps/web/src/payment-confirmation-projection.ts", "apps/web/src/payment-handoff-panel.tsx"],
  executions: [passed("pnpm --filter @veel/web exec vitest run src/payment-confirmation-projection.test.ts", ["apps/web/src/payment-confirmation-projection.test.ts"])]
});

fixed(["DB-01", "DB-02", "DB-07"], {
  summary: "Migration 0120 removes effective browser-role grants/policies from named server-owned identity, finance, content, counter, comment, media, and organization authorities while preserving backend access.",
  affectedPaths: ["packages/database/migrations/0120_data_api_server_authority.sql"],
  executions: [passed("pnpm --filter @veel/api exec vitest run test/data-api-authority.integration.test.ts", ["apps/api/test/data-api-authority.integration.test.ts"], "disposable PostgreSQL with anon/authenticated/backend roles")]
});

fixed(["DB-03"], {
  summary: "OpenAPI 3.1 nullable shapes use JSON Schema unions and representative null/non-null resources validate under Draft 2020-12.",
  affectedPaths: ["packages/contracts/openapi.yaml"],
  executions: [passed("pnpm --filter @veel/contracts test", ["packages/contracts/src/openapi-schema.test.ts"])]
});

fixed(["DB-05"], {
  summary: "Migration 0039 rollback uses catalog-guarded supported ALTER PUBLICATION syntax and executes through down/reapply proof.",
  affectedPaths: ["packages/database/migrations/0039_realtime_projection_publication.down.sql"],
  executions: [passed("pnpm --filter @veel/database exec vitest run test/rollbacks.integration.test.ts", ["packages/database/test/rollbacks.integration.test.ts"], "disposable PostgreSQL")]
});

fixed(["RES-01", "RES-02"], {
  summary: "Unexpected errors return a stable sanitized resource/request ID, and refund requests are validated through the canonical runtime contract before repository access.",
  affectedPaths: ["apps/api/src/app.ts", "apps/api/src/modules/refund/refund-routes.ts"],
  executions: [passed("pnpm --filter @veel/api exec vitest run test/app.test.ts", ["apps/api/test/app.test.ts"])]
});

fixed(["RES-03"], {
  summary: "Ordinary termination drains the API, runs close hooks once, bounds stuck shutdown, and exits nonzero on close failure.",
  affectedPaths: ["apps/api/src/api-shutdown.ts", "apps/api/src/server.ts"],
  executions: [passed("pnpm --filter @veel/api exec vitest run test/api-shutdown.test.ts", ["apps/api/test/api-shutdown.test.ts"])]
});

fixed(["RES-04"], {
  summary: "Activity and refund histories use stable compound keysets from the last visible row, including equal timestamps and legacy cursor compatibility.",
  affectedPaths: ["apps/api/src/shared/keyset-pagination.ts", "apps/api/src/modules/activity/activity-ledger-repository.ts", "apps/api/src/modules/refund/refund-repository.ts"],
  executions: [passed("pnpm --filter @veel/api exec vitest run test/keyset-pagination.test.ts test/activity-refund-resilience.integration.test.ts", ["apps/api/test/keyset-pagination.test.ts", "apps/api/test/activity-refund-resilience.integration.test.ts"])]
});

fixed(["RES-05"], {
  summary: "Same-key refund requests serialize on a scoped advisory lock, replay the original result, and conflict on changed input.",
  affectedPaths: ["apps/api/src/modules/refund/refund-repository.ts"],
  executions: [passed("pnpm --filter @veel/api exec vitest run test/activity-refund-resilience.integration.test.ts", ["apps/api/test/activity-refund-resilience.integration.test.ts"], "disposable PostgreSQL")]
});

fixed(["CONTRACT-01"], {
  summary: "Age webhooks are provider-specific literal routes whose schemas accept the documented Sumsub/Yoti payloads and describe the authentication/acknowledgement runtime actually uses.",
  affectedPaths: ["packages/contracts/openapi.yaml", "apps/api/src/modules/age/age-routes.ts"],
  executions: [passed("pnpm --filter @veel/contracts test && pnpm --filter @veel/api exec vitest run test/app.test.ts", ["packages/contracts/src/openapi-schema.test.ts", "apps/api/test/app.test.ts"])]
});

fixed(["CONTRACT-02", "CONTRACT-03"], {
  summary: "Playback capabilities are response-only and public/admin payment state vocabularies include every reachable state, including cancelled.",
  affectedPaths: ["packages/contracts/openapi.yaml"],
  executions: [passed("pnpm --filter @veel/contracts test", ["packages/contracts/src/openapi-schema.test.ts"])]
});

fixed(["ROLLBACK-01"], {
  summary: "Migration 0117 down refuses before destructive DDL when retained Moment/expiry evidence exists, while empty rollback/reapply remains executable.",
  affectedPaths: ["packages/database/migrations/0117_moments_and_scheduled_publication.down.sql"],
  executions: [passed("pnpm --filter @veel/database exec vitest run test/rollbacks.integration.test.ts", ["packages/database/test/rollbacks.integration.test.ts"], "disposable PostgreSQL with populated and empty fixtures")]
});

fixed(["TEST-01"], {
  summary: "The live-room fixture now distinguishes omitted fields from explicit null, so reserved-room tests no longer receive fabricated provider IDs or host secrets.",
  affectedPaths: ["apps/api/test/app.test.ts"],
  executions: [passed("pnpm --filter @veel/api exec vitest run test/app.test.ts", ["apps/api/test/app.test.ts"])]
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
  executions: [passed("pnpm --filter @veel/api exec vitest run test/data-api-authority.integration.test.ts", ["apps/api/test/data-api-authority.integration.test.ts"], "disposable PostgreSQL with direct roles")]
});

superseded(["MIGTEST-GAP-03"], {
  summary: "Per-file substring assertions are not the accepted completeness model; the canonical gate applies the ordered forward chain and tests final-schema invariants instead.",
  affectedPaths: ["packages/database/scripts/check-migrations.mjs", "packages/database/test/migrations.test.ts"],
  executions: [passed("pnpm database:check", ["packages/database/scripts/check-migrations.mjs", "packages/database/test/migrations.test.ts"])]
});

fixed(["MIGTEST-GAP-04"], {
  summary: "The canonical guarded API integration suite now includes final-schema repository SQL for verification, media, Data API, discovery, admin, analytics, reporting, push, OAuth, refunds, and recovery.",
  affectedPaths: ["apps/api/test", "scripts/api-integration-suite.test.mjs"],
  executions: [passed("node --test scripts/api-integration-suite.test.mjs", ["scripts/api-integration-suite.test.mjs"]), passed("pnpm --filter @veel/api test:integration", ["apps/api/test"], "disposable PostgreSQL")]
});

fixed(["D-02", "D-03", "D-04", "D-05", "D-06"], {
  summary: "Canonical docs now distinguish opaque app sessions from recovery/Realtime, lock one onboarding flow, separate capability-specific KYC/KYB/age decisions, align runtime config ownership, and distinguish storage readiness from release eligibility.",
  affectedPaths: ["docs/v2-new-build/auth-supabase-realtime.md", "docs/v2-new-build/providers/identity-provider-wiring.md", "docs/v2-new-build/deployment-topology.md", "docs/v2-new-build/media-live-providers.md"],
  executions: [passed("pnpm docs:check", ["scripts/check-docs.mjs"])]
});

fixed(["D-07", "DM-01"], {
  summary: "Active ranking docs exclude purchase, unlock, subscription, revenue, wallet, referral, and other money facts, and a repository policy check rejects their reintroduction.",
  affectedPaths: ["docs/v2-new-build/recommendation-discovery.md", "docs/v2-new-build/profile-activity-ranking.md", "docs/v2-new-build/engagement-strategy.md", "scripts/check-ranking-policy.mjs"],
  executions: [passed("pnpm ranking:policy", ["scripts/check-ranking-policy.test.mjs"])]
});

fixed(["D-10"], {
  summary: "Canonical MCP docs identify 2026-07-28 as final/latest while explicitly naming the tested 2025-11-25 initialize-based compatibility target and upgrade gate.",
  affectedPaths: ["docs/v2-new-build/adr/0002-provider-decisions-2026.md", "docs/v2-new-build/mcp-staging-proof.md", "docs/v2-new-build/product/mcp-profile-bridge.md"],
  executions: [passed("pnpm docs:check", ["scripts/check-docs.mjs"])]
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
  executions: [passed("pnpm docs:check && pnpm --filter @veel/api exec vitest run test/mcp.test.ts test/app.test.ts", ["scripts/check-docs.mjs", "apps/api/test/mcp.test.ts"])]
});

fixed(["DM-02", "DM-03", "DM-04", "DM-05", "DM-07", "DM-12"], {
  summary: "Active money/social docs now use opaque app-session authority, exact current record names, paid-live-event access, non-preferential membership benefits, policy-driven creator KYC, and mark manual renewal recovery unsupported.",
  affectedPaths: ["docs/v2-new-build/profile-activity-ranking.md", "docs/v2-new-build/engagement-strategy.md", "docs/v2-new-build/business-monetisation.md", "docs/v2-new-build/compliance/dac7-dac8-vat-system.md"],
  executions: [passed("pnpm docs:check && pnpm ranking:policy", ["scripts/check-docs.mjs", "scripts/check-ranking-policy.test.mjs"])]
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
    passed("executed focused real-PostgreSQL AUTH-10 integration selection (4/4 across eight mutation paths)", ["apps/api/test/mutation-command-idempotency.integration.test.ts"], "disposable migrated PostgreSQL"),
    passed("executed migration 0128 down/up proof and canonical migration suite (101/101)", ["packages/database/migrations/0128_mutation_command_receipts.sql", "packages/database/migrations/0128_mutation_command_receipts.down.sql", "packages/database/test/migrations.test.ts"], "disposable migrated PostgreSQL"),
    passed("executed focused AUTH-10 route conflict selection (2/2)", ["apps/api/test/app.test.ts"])
  ],
  residualWork: ["Obtain authorized final evidence review for disposition promotion; no implementation or release-gate bypass is implied by the focused passes."]
});

unresolved(["CONTENT-07"], {
  summary: "The remaining comments, notifications, Event Access passes, organization dashboards, Mutuals feed, and Mutuals list projections now use endpoint-scoped compound keysets over every ORDER BY field, derive the next cursor from the last visible row, and use lookahead only for has-more detection.",
  affectedPaths: ["apps/api/src/shared/keyset-pagination.ts", "apps/api/src/modules/engagement/engagement-comment-repository.ts", "apps/api/src/modules/notification/notification-repository.ts", "apps/api/src/modules/event/event-access-pass-methods.ts", "apps/api/src/modules/organization/organization-repository.ts", "apps/api/src/modules/mutuals/mutuals-repository.ts"],
  executions: [passed("executed focused CONTENT-07 pagination selection (5/5 unit; 1/1 real PostgreSQL)", ["apps/api/test/pagination-authorities.test.ts", "apps/api/test/pagination-authorities.integration.test.ts"], "local Node.js 22.23.4 plus disposable migrated PostgreSQL")],
  residualWork: ["Obtain authorized final evidence review for disposition promotion; retain the existing release gates."]
});

unresolved(["CONTENT-08"], {
  summary: "Event create/update, feed-preference update, and live reserve/attach/create now project fresh RETURNING data without rereading the statement-start base-table snapshot, so the first persisted write returns its canonical projection.",
  affectedPaths: ["apps/api/src/modules/event/event-core-repository.ts", "apps/api/src/modules/live/live-room-repository.ts", "apps/api/src/modules/engagement/engagement-preferences-repository.ts"],
  executions: [passed("executed focused first-call DML projection integration selection (1/1)", ["apps/api/test/repository-dml-projections.integration.test.ts"], "disposable fully migrated PostgreSQL")],
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
  executions: [passed("executed focused organization membership lifecycle selection", ["apps/api/test/organization-membership-lifecycle.test.ts"])],
  residualWork: ["Obtain authorized final evidence review for disposition promotion; retain the existing release gates."]
});

unresolved(["CONTENT-17"], {
  summary: "Some organization, management, performer, metadata, publish, and event commands still omit target identity/version from durable idempotency fingerprints.",
  affectedPaths: ["apps/api/src/modules/organization", "apps/api/src/modules/managed-creator", "apps/api/src/modules/performer"],
  executions: [],
  residualWork: ["Bind target/action/version and prove same-key same-body different-target conflicts across every affected command."]
});

unresolved(["CONTENT-18"], {
  summary: "Feed ranking now creates bounded 30-minute, at-most-512-candidate ranking sessions, carries a versioned stable cursor, uses the canonical eligible_content authority again at delivery, and excludes money signals; local PostgreSQL proof remains smaller than production scale.",
  affectedPaths: ["apps/api/src/modules/content/content-feed-cursor.ts", "apps/api/src/modules/content/content-feed-repository.ts", "packages/database/migrations/0129_bounded_feed_ranking_sessions.sql", "scripts/check-ranking-policy.mjs"],
  executions: [
    passed("executed focused CONTENT-18 unit/migration selection (113/113)", ["packages/database/test/migrations.test.ts", "apps/api/test/content-feed-cursor.test.ts", "apps/api/test/content-feed-query-policy.test.ts", "apps/api/test/app.test.ts"]),
    passed("executed focused ranking-policy Vitest selection (6/6)", ["scripts/check-ranking-policy.test.mjs"]),
    passed("pnpm ranking:policy", ["scripts/check-ranking-policy.test.mjs"]),
    passed("executed focused bounded-session application selection (1/1)", ["apps/api/test/app.test.ts"]),
    passed("executed real-PostgreSQL ranking-session selection (1/1; 2.59s test, 7.85s total)", ["apps/api/test/content-feed-ranking-session.integration.test.ts"], "disposable migrated PostgreSQL"),
    passed("executed EXPLAIN fixture: candidate Limit 512 over 520 fixtures in 1.249ms; eligible_content 549 rows loops=1; full aggregate 67.051ms; rollback confirmed", ["apps/api/test/content-feed-ranking-session.integration.test.ts"], "disposable migrated PostgreSQL")
  ],
  residualWork: ["Run staging EXPLAIN/load proof at 100k+ eligible rows and monitor ranking-session creation/expiry/churn before claiming production-scale behavior.", "Obtain authorized final evidence review for disposition promotion; retain the existing release gates."]
});

unresolved(["PAY-12"], {
  summary: "Referral activity now pages stable individual share/commission events by an event-kind/event-id compound keyset from the last visible row, preserving equal-timestamp and multi-commission records across adjacent inserts.",
  affectedPaths: ["apps/api/src/modules/referral/referral-repository.ts", "apps/api/src/modules/referral/referral-routes.ts", "apps/api/src/modules/referral/types.ts", "packages/contracts/openapi.yaml"],
  executions: [passed("executed focused PAY-12..15 API repository/unit selection (8/8)", ["apps/api/test/referral-pagination.test.ts", "apps/api/test/payment-submission-idempotency.test.ts", "apps/api/test/subscription-submission-idempotency.test.ts", "apps/api/test/subscription-list-pagination.test.ts"]), passed("executed focused PAY-12..15 route selection (3/3)", ["apps/api/test/app.test.ts"]), passed("executed OpenAPI schema selection (7/7); regeneration hash c6e104e1a92bf67871417706923f2f242901a6af5c87175ad0aa47495c3c5349", ["packages/contracts/src/openapi-schema.test.ts", "packages/contracts/src/generated/openapi.ts"])],
  residualWork: ["Obtain authorized final evidence review for disposition promotion; retain all payment release gates."]
});

unresolved(["PAY-13"], {
  summary: "Payment and subscription authorization submissions now bind durable actor/action/target/request receipts to the idempotency key, replay completed responses, reject changed signatures, and serialize concurrent retries without duplicate attempts.",
  affectedPaths: ["apps/api/src/modules/payment/payment-submission.ts", "apps/api/src/modules/payment/payment-intent-routes.ts", "apps/api/src/modules/subscription/subscription-authorization-verification-repository.ts", "apps/api/src/modules/subscription/subscription-routes.ts", "apps/api/src/shared/mutation-command-receipt.ts"],
  executions: [passed("executed focused PAY-12..15 API repository/unit selection (8/8)", ["apps/api/test/payment-submission-idempotency.test.ts", "apps/api/test/subscription-submission-idempotency.test.ts"]), passed("executed focused PAY-12..15 route selection (3/3)", ["apps/api/test/app.test.ts"]), passed("executed OpenAPI schema selection (7/7)", ["packages/contracts/src/openapi-schema.test.ts"])],
  residualWork: ["Obtain authorized final evidence review for disposition promotion; recurring financial migrations and provider proof remain separately approval-gated."]
});

unresolved(["PAY-14"], {
  summary: "Subscription reads now project only a closed set of UI-safe failure categories, preserving actionable insufficient-funds, revoked-authorization, provider-unavailable, or setup-mismatch remediation without exposing raw provider details.",
  affectedPaths: ["apps/api/src/modules/subscription/subscription-repository.ts", "apps/api/src/modules/subscription/subscription-repository-mappers.ts", "apps/api/src/modules/subscription/types.ts", "packages/contracts/openapi.yaml"],
  executions: [passed("executed focused PAY-12..15 API repository/unit selection (8/8)", ["apps/api/test/subscription-list-pagination.test.ts"]), passed("executed OpenAPI schema selection (7/7)", ["packages/contracts/src/openapi-schema.test.ts"])],
  residualWork: ["Obtain authorized final evidence review for disposition promotion; retain all recurring-payment release gates."]
});

unresolved(["PAY-15"], {
  summary: "Plan listing is restricted to the bounded platform catalog, creator checkout uses the canonical creator-offer selector, and user subscriptions use bounded active/history and scope-filtered compound-keyset pages; the audit-requested ideal composite/partial indexes were intentionally not added without migration approval.",
  affectedPaths: ["apps/api/src/modules/subscription/subscription-repository.ts", "apps/api/src/modules/subscription/subscription-pagination.ts", "apps/api/src/modules/subscription/subscription-routes.ts", "apps/api/src/modules/subscription/types.ts", "packages/contracts/openapi.yaml"],
  executions: [passed("executed focused PAY-12..15 API repository/unit selection (8/8)", ["apps/api/test/subscription-list-pagination.test.ts"]), passed("executed focused PAY-12..15 route selection (3/3)", ["apps/api/test/app.test.ts"]), passed("executed OpenAPI schema selection (7/7)", ["packages/contracts/src/openapi-schema.test.ts"])],
  residualWork: ["Obtain explicit migration approval, add the measured composite/partial indexes for the final bounded query shapes, and prove realistic-volume plans before promoting the disposition."]
});

unresolved(["FE-03"], {
  summary: "Phone Messages now preserves a real inbox state: the server no longer substitutes the first conversation, and Back clears selection instead of immediately reopening that thread.",
  affectedPaths: ["apps/web/app/app/messages/page.tsx", "apps/web/app/messages/messages-workspace.tsx", "apps/web/src/messages/conversation-selection.ts"],
  executions: [passed("executed targeted frontend unit selection (25/25)", ["apps/web/src/messages/conversation-selection.test.ts"]), passed("node node_modules/typescript/bin/tsc --noEmit -p apps/web/tsconfig.json", ["apps/web/tsconfig.json"])],
  residualWork: ["Execute the existing phone browser journey at the final tree and obtain authorized final evidence review for disposition promotion."]
});

unresolved(["FE-04"], {
  summary: "Reply state is conversation-scoped and the composer/commercial panel remount by selected conversation, so draft, attachment, retry, and reply state no longer silently crosses thread identity at the source boundary.",
  affectedPaths: ["apps/web/app/messages/messages-workspace.tsx", "apps/web/app/messages/message-composer.tsx", "apps/web/src/messages/conversation-selection.ts"],
  executions: [passed("executed targeted frontend unit selection (25/25)", ["apps/web/src/messages/conversation-selection.test.ts"]), passed("node node_modules/typescript/bin/tsc --noEmit -p apps/web/tsconfig.json", ["apps/web/tsconfig.json"])],
  residualWork: ["Add and execute a browser case for draft/attachment switching plus fast navigation during send before promoting the disposition."]
});

unresolved(["FE-05"], {
  summary: "Read attempts are keyed by conversation and visible unread range, so a successful first mark-read no longer suppresses later conversations or newly arrived messages at the source boundary.",
  affectedPaths: ["apps/web/app/messages/conversation-state-actions.tsx", "apps/web/src/messages/conversation-selection.ts"],
  executions: [passed("executed targeted frontend unit selection (25/25)", ["apps/web/src/messages/conversation-selection.test.ts"]), passed("node node_modules/typescript/bin/tsc --noEmit -p apps/web/tsconfig.json", ["apps/web/tsconfig.json"])],
  residualWork: ["Add and execute a browser case spanning multiple successfully read threads and a new arrival in the open thread before promoting the disposition."]
});

unresolved(["FE-07"], {
  summary: "Moment content and engagement children are keyed by content identity, resetting carousel, poll, and engagement-local state when the active Moment changes.",
  affectedPaths: ["apps/web/app/app/moments/moment-viewer.tsx"],
  executions: [passed("node node_modules/typescript/bin/tsc --noEmit -p apps/web/tsconfig.json", ["apps/web/tsconfig.json"])],
  residualWork: ["Add and execute a two-Moment browser regression for carousel/poll/engagement state carryover before promoting the disposition."]
});

unresolved(["FE-08"], {
  summary: "Moment arrow shortcuts now ignore editable and interactive targets, IME composition, modified events, and already-prevented events.",
  affectedPaths: ["apps/web/app/app/moments/moment-viewer.tsx", "apps/web/src/navigation/global-shortcut-policy.ts"],
  executions: [passed("executed targeted frontend unit selection (25/25)", ["apps/web/src/navigation/global-shortcut-policy.test.ts"]), passed("node node_modules/typescript/bin/tsc --noEmit -p apps/web/tsconfig.json", ["apps/web/tsconfig.json"])],
  residualWork: ["Add and execute a real textarea-in-Moment browser assertion before promoting the disposition."]
});

unresolved(["FE-09"], {
  summary: "Composer restore no longer overwrites the saved snapshot before hydration and resumable upload identity is deterministic and asset-scoped, but the restored ContentItem still does not hydrate the ordered uploaded asset/status/session composition without file reselection.",
  affectedPaths: ["apps/web/app/create/image-composer.tsx", "apps/web/src/media/resumable-upload-key.ts"],
  executions: [passed("executed targeted frontend unit selection (25/25)", ["apps/web/src/media/resumable-upload-key.test.ts"]), passed("node node_modules/typescript/bin/tsc --noEmit -p apps/web/tsconfig.json", ["apps/web/tsconfig.json"])],
  residualWork: ["Hydrate server-owned ordered asset/status/session state and browser-prove restore before response, mid-transfer, after transfer, and after provider-ready without requiring file reselection."]
});

unresolved(["FE-10"], {
  summary: "Public/server config now rejects mainnet that inherits a devnet RPC, and the embedded provider chooses only a chain-matching official fallback endpoint.",
  affectedPaths: ["packages/config/src/public.ts", "packages/config/src/index.ts", "apps/web/src/public-env.ts", "apps/web/src/wallet/embedded-wallet-providers.tsx"],
  executions: [passed("executed focused config and public-environment selection (52/52)", ["packages/config/src/index.test.ts", "apps/web/src/public-env.test.ts"]), passed("node node_modules/typescript/bin/tsc --noEmit -p apps/web/tsconfig.json", ["apps/web/tsconfig.json"])],
  residualWork: ["Obtain authorized final evidence review for disposition promotion; production network/provider proof remains a separate release gate."]
});

unresolved(["FE-11"], {
  summary: "Checkout now mounts both wallet runtimes and provides external Wallet Adapter selection/retry, but the payment bridge still lacks an embedded-provider transaction-signing path for a freshly loaded login wallet.",
  affectedPaths: ["apps/web/src/payment-wallet-bridge.tsx", "apps/web/src/payment-wallet-runtime.tsx"],
  executions: [passed("node node_modules/typescript/bin/tsc --noEmit -p apps/web/tsconfig.json", ["apps/web/tsconfig.json"])],
  residualWork: ["Add the noncustodial embedded-wallet transaction path through the approved provider SDK and browser-prove fresh-login checkout, rejection, retry, and backend-confirmed settlement."]
});

unresolved(["FE-12"], {
  summary: "The notification list now owns an actor-keyed active TanStack query, so the existing Realtime prefix invalidation has a live consumer instead of invalidating unobserved state.",
  affectedPaths: ["apps/web/app/app/notifications/notification-list.tsx", "apps/web/src/realtime-provider.tsx"],
  executions: [passed("node node_modules/vitest/vitest.mjs run apps/web (28 files, 136 tests)", ["apps/web/app/app/notifications/notification-list.tsx", "apps/web/src/realtime-provider.tsx"]), passed("node node_modules/typescript/bin/tsc --noEmit -p apps/web/tsconfig.json", ["apps/web/tsconfig.json"])],
  residualWork: ["Browser-prove realtime arrival, reconnect gap recovery, and account switch before promoting the disposition."]
});

unresolved(["FE-13"], {
  summary: "The app shell now exposes labelled Search, Notifications, and Wallet quick actions at phone and tablet breakpoints.",
  affectedPaths: ["apps/web/app/app-shell.tsx", "apps/web/app/styles/responsive.css"],
  executions: [passed("node node_modules/typescript/bin/tsc --noEmit -p apps/web/tsconfig.json", ["apps/web/tsconfig.json"])],
  residualWork: ["Execute the existing phone quick-action browser journey at the final tree before promoting the disposition."]
});

unresolved(["FE-14"], {
  summary: "Own Profile uses canonical public stats, creator-local media tabs, and cursor-backed load-more through the existing content authority instead of a first-page-only local view.",
  affectedPaths: ["apps/web/app/app/profile/page.tsx", "apps/web/app/app/profile/profile-media-grid.tsx", "apps/web/src/api-client-read.ts"],
  executions: [passed("node node_modules/vitest/vitest.mjs run apps/web (28 files, 136 tests)", ["apps/web/app/app/profile/profile-media-grid.tsx"]), passed("node node_modules/typescript/bin/tsc --noEmit -p apps/web/tsconfig.json", ["apps/web/tsconfig.json"])],
  residualWork: ["Add and execute browser coverage for canonical counts, tab filters, and load-more exhaustion before promoting the disposition."]
});

unresolved(["FE-15"], {
  summary: "The feed evicts off-window cards behind measured spacers and bounds the rendered card window to 60 instead of retaining an unbounded component/DOM tree.",
  affectedPaths: ["apps/web/app/app/feed-experience.tsx", "apps/web/src/feed/bounded-feed-window.ts"],
  executions: [passed("executed targeted frontend unit selection (25/25)", ["apps/web/src/feed/bounded-feed-window.test.ts"]), passed("node node_modules/typescript/bin/tsc --noEmit -p apps/web/tsconfig.json", ["apps/web/tsconfig.json"])],
  residualWork: ["Run a long-session constrained-device browser/performance proof before promoting the disposition or claiming production-scale UX."]
});

unresolved(["FE-16"], {
  summary: "Both themes now provide contrast-safe strong-accent/on-solid tokens and audited solid-accent controls use them instead of low-contrast foreground combinations.",
  affectedPaths: ["apps/web/app/styles/tokens-base.css", "apps/web/src/theme-contrast.test.ts", "apps/web/app/app/settings/content-preference-control.tsx"],
  executions: [passed("executed targeted frontend unit selection (25/25)", ["apps/web/src/theme-contrast.test.ts"]), passed("node node_modules/typescript/bin/tsc --noEmit -p apps/web/tsconfig.json", ["apps/web/tsconfig.json"])],
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
  executions: [passed("node node_modules/typescript/bin/tsc --noEmit -p apps/web/tsconfig.json", ["apps/web/tsconfig.json"])],
  residualWork: ["Execute authenticated 360x640 and desktop keyboard-scroll browser proof before promoting the disposition."]
});

unresolved(["FE-21"], {
  summary: "The Follow control no longer resynchronizes stale initial props when pending ends, so a successful local follow/unfollow mutation survives completion.",
  affectedPaths: ["apps/web/app/follow-button.tsx"],
  executions: [passed("node node_modules/typescript/bin/tsc --noEmit -p apps/web/tsconfig.json", ["apps/web/tsconfig.json"])],
  residualWork: ["Execute the existing follow-to-unfollow browser flow at the final tree, including public Profile, before promoting the disposition."]
});

unresolved(["FE-22"], {
  summary: "Settings now provides validated profile/avatar editing through the existing mutations, and the Mutuals destination is truthfully labelled as viewing connections rather than a nonexistent privacy-management workflow.",
  affectedPaths: ["apps/web/app/app/settings/profile-editor.tsx", "apps/web/app/app/settings/page.tsx", "apps/web/app/app/settings/privacy-controls.tsx"],
  executions: [passed("node node_modules/vitest/vitest.mjs run apps/web (28 files, 136 tests)", ["apps/web/app/app/settings/profile-editor.tsx", "apps/web/app/app/settings/privacy-controls.tsx"]), passed("node node_modules/typescript/bin/tsc --noEmit -p apps/web/tsconfig.json", ["apps/web/tsconfig.json"])],
  residualWork: ["Browser-prove profile save/avatar failure handling and the corrected Mutuals destination copy before promoting the disposition."]
});

unresolved(["FE-23"], {
  summary: "Frontend authorities now route provider/state/route ownership to frontend-architecture and the route map, while mockups and narrow design/copy/motion documents are explicitly non-competing references.",
  affectedPaths: ["docs/v2-new-build/frontend-architecture.md", "docs/v2-new-build/frontend/component-map.md", "docs/v2-new-build/frontend/copy-system.md", "docs/v2-new-build/frontend/design-system.md", "docs/v2-new-build/frontend/motion-system.md", "docs/v2-new-build/frontend/ui-kit-lock.md", "docs/v2-new-build/native-ui-ux-screens.md", "apps/web/public/mockup/design.md", "apps/web/README.md"],
  executions: [passed("node scripts/check-docs.mjs", ["scripts/check-docs.mjs"])],
  residualWork: ["Obtain authorized final evidence review for disposition promotion; no runtime or release claim follows from documentation consistency alone."]
});

unresolved(["FE-24"], {
  summary: "Creator Membership checkout now lazy-loads a runtime that mounts WalletRuntimeProviders around the authorization panel, removing the named missing-provider-context failure.",
  affectedPaths: ["apps/web/app/profile/[handle]/creator-membership-checkout.tsx", "apps/web/app/profile/[handle]/creator-membership-runtime.tsx", "apps/web/app/profile/[handle]/page.tsx"],
  executions: [passed("node node_modules/typescript/bin/tsc --noEmit -p apps/web/tsconfig.json", ["apps/web/tsconfig.json"])],
  residualWork: ["Add and execute a fresh-browser creator Membership provider-context journey before promoting the disposition; embedded payment signing remains the separate FE-11 residual."]
});

unresolved(["DB-04"], {
  summary: "The ordered immutable migration chain is now the only routed database-shape authority; the conceptual schema blueprint is retained and conspicuously labelled non-authoritative historical planning material.",
  affectedPaths: ["packages/database/schema-blueprint.sql", "docs/v2-new-build/INDEX.md", "docs/v2-new-build/contracts-and-schema.md"],
  executions: [passed("node scripts/check-docs.mjs", ["scripts/check-docs.mjs", "packages/database/README.md"])],
  residualWork: ["Obtain authorized final evidence review for disposition promotion; exact database shape continues to require the migration and real-PostgreSQL gates."]
});

unresolved(["DB-06"], {
  summary: "A guarded pre-upgrade bridge now classifies and repairs only the three exact legacy CHECK-constraint shapes before immutable migration 0046/0056/0077 runs; a populated 0045-prefix database reached 0128 with final rejected/both/access_pass_granted values and constraints that reject the legacy vocabulary.",
  affectedPaths: ["scripts/legacy-migration-bridge.mjs", "scripts/apply-legacy-migration-bridge.mjs", "scripts/legacy-migration-bridge.test.mjs", "packages/database/pre-upgrade/legacy-check-constraint-bridge.sql", "packages/database/README.md"],
  executions: [
    passed("executed manual populated legacy-upgrade proof: immutable 0001-0045 prefix, exact 0046/0056/0077 classification, guarded bridge apply, then immutable 0046-0128 forward chain and final legacy-value refusal", ["packages/database/pre-upgrade/legacy-check-constraint-bridge.sql", "packages/database/README.md"], "disposable local PostgreSQL 14 database wevid_db06_prefix on 127.0.0.1:55438"),
    passed("executed legacy migration bridge test selection (3/3)", ["scripts/legacy-migration-bridge.test.mjs"])
  ],
  residualWork: ["Obtain authorized final evidence review for disposition promotion; production/staging upgrade remains operator-controlled and must use the guarded check/apply workflow."]
});

unresolved(["SUP-01"], {
  summary: "The enterprise script is now explicitly a projection smoke and never emits provider approval; exact-release staging acceptance requires separately registered, current, subject/environment-bound enterprise evidence.",
  affectedPaths: ["apps/api/scripts/prove-enterprise-managed-creators.mjs", "scripts/staging-proof-plan.mjs", "scripts/staging-acceptance-status.mjs"],
  executions: [passed("executed enterprise projection proof selection (3/3)", ["scripts/enterprise-projection-proof.test.mjs"])],
  residualWork: ["Obtain authorized final evidence review for disposition promotion; real Enterprise/KYB provider evidence remains an external release prerequisite."]
});

unresolved(["INT-03"], {
  summary: "The long integration journey now allocates per-run identities/tokens/wallet fixtures and uses an advisory journey lock; the global recipient-policy test has its own advisory lock and guarded database target, teardown follows FK order, and two independent full-suite processes completed against one migrated database.",
  affectedPaths: ["apps/api/test/authenticated-happy-path.integration.test.ts", "apps/api/test/policy-content-eligibility.integration.test.ts", "apps/api/test/integration-database.ts"],
  executions: [
    passed("executed full authenticated integration suite after isolation/teardown corrections (4/4; 26.73s)", ["apps/api/test/authenticated-happy-path.integration.test.ts"], "disposable fully migrated PostgreSQL"),
    passed("executed two independent full-suite processes concurrently against one migrated database (process A 4/4 in 36.08s; process B 4/4 in 42.61s; advisory lock serialized exhaustive journeys and teardown completed)", ["apps/api/test/authenticated-happy-path.integration.test.ts", "apps/api/test/policy-content-eligibility.integration.test.ts"], "shared disposable fully migrated PostgreSQL"),
    passed("executed authenticated happy path and recipient-policy suite concurrently against one migrated database (happy path 4/4 in 26.62s; policy 1/1 in 3.34s)", ["apps/api/test/authenticated-happy-path.integration.test.ts", "apps/api/test/policy-content-eligibility.integration.test.ts"], "shared disposable fully migrated PostgreSQL"),
    passed("executed static integration-suite policy selection (3/3)", ["scripts/api-integration-suite.test.mjs"])
  ],
  residualWork: ["Obtain authorized final evidence review for disposition promotion; no release gate is weakened by local concurrency proof."]
});

unresolved(["D-01"], {
  summary: "The docs index now routes current architecture to one system map plus ADRs and narrow domain authorities; queue, analytics, and OpenAPI generation direction match the implemented runtime, while broad blueprints and diagrams are explicitly orientation-only.",
  affectedPaths: ["docs/v2-new-build/INDEX.md", "docs/v2-new-build/app-architecture.md", "docs/v2-new-build/backend-fastify-architecture.md", "docs/v2-new-build/infra-decisions.md", "docs/v2-new-build/full-platform-blueprint.md", "docs/v2-new-build/diagrams.md"],
  executions: [passed("node scripts/check-docs.mjs", ["scripts/check-docs.mjs"])],
  residualWork: ["Obtain authorized final evidence review for disposition promotion; implementation and provider authorities remain narrower than architecture prose."]
});

unresolved(["D-08"], {
  summary: "Every active router now defers exact database shape to the immutable migration chain and labels schema-blueprint.sql as historical non-authoritative planning material.",
  affectedPaths: ["docs/v2-new-build/INDEX.md", "docs/v2-new-build/contracts-and-schema.md", "packages/database/schema-blueprint.sql", "packages/database/README.md"],
  executions: [passed("node scripts/check-docs.mjs", ["scripts/check-docs.mjs"])],
  residualWork: ["Obtain authorized final evidence review for disposition promotion; schema claims still require executable migration/catalog proof."]
});

unresolved(["D-09"], {
  summary: "The route map now separates page-entry requirements from protected-data policy, records anonymous Safe profile/content entry and remediation routes, includes canonical content detail, and labels phase as grouping rather than readiness evidence.",
  affectedPaths: ["docs/v2-new-build/route-map.md"],
  executions: [passed("node scripts/check-docs.mjs", ["scripts/check-docs.mjs"])],
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
  executions: [passed("node scripts/check-docs.mjs", ["scripts/check-docs.mjs"])],
  residualWork: ["Obtain authorized final evidence review for disposition promotion; D-13's protected-status conflicts remain separately open."]
});

unresolved(["DM-10"], {
  summary: "Event Access routes now defer to the route map/OpenAPI, implemented and deferred surfaces are explicit, and pass types alone own price, currency, capacity, limits, and sale windows.",
  affectedPaths: ["docs/v2-new-build/product/event-access.md", "docs/v2-new-build/route-map.md", "packages/contracts/openapi.yaml"],
  executions: [passed("node scripts/check-docs.mjs", ["scripts/check-docs.mjs"])],
  residualWork: ["Obtain authorized final evidence review for disposition promotion; deferred reissue/offline/admin capabilities remain non-advertised until implemented."]
});

unresolved(["DM-11"], {
  summary: "Payments documentation now states that current code resolves one supplied active referral token and labels Partner-over-Invite-over-Share precedence, Invite entities, campaign caps, and broader product eligibility as planned rather than implemented.",
  affectedPaths: ["docs/v2-new-build/payments-and-monetisation.md", "docs/v2-new-build/business-monetisation.md"],
  executions: [passed("node scripts/check-docs.mjs", ["scripts/check-docs.mjs"])],
  residualWork: ["Obtain authorized final evidence review for disposition promotion; advanced referral policy remains out of current runtime scope."]
});

unresolved(["DM-13"], {
  summary: "The payments authority now publishes an exact per-product SOL/configured-SPL capability matrix and states that a new asset requires stored mint/decimals, composition, verification, receipt, UI, and failure-path evidence rather than a dropdown.",
  affectedPaths: ["docs/v2-new-build/payments-and-monetisation.md"],
  executions: [passed("node scripts/check-docs.mjs", ["scripts/check-docs.mjs"])],
  residualWork: ["Obtain authorized final evidence review for disposition promotion; unsupported asset/product combinations remain explicitly unsupported."]
});

unresolved(["DM-14"], {
  summary: "Referral language is now bounded to the platform-fee quote basis known at purchase time and explicitly says future refunds or later tax corrections are not automatically clawed back or netted by the noncustodial split.",
  affectedPaths: ["docs/v2-new-build/payments-and-monetisation.md", "docs/v2-new-build/business-monetisation.md"],
  executions: [passed("node scripts/check-docs.mjs", ["scripts/check-docs.mjs"])],
  residualWork: ["Obtain authorized final evidence review for disposition promotion; any append-only refund/tax remedy still requires approved legal and accounting policy."]
});

unresolved(["DM-15"], {
  summary: "The payments document now separates code/automated evidence from final-commit real-PostgreSQL, browser, provider, legal, and operations proof, and records recurring and tax boundaries as disabled or foundations-only instead of blanket launch claims.",
  affectedPaths: ["docs/v2-new-build/payments-and-monetisation.md", "docs/v2-new-build/current-implementation-status.md"],
  executions: [passed("node scripts/check-docs.mjs", ["scripts/check-docs.mjs"])],
  residualWork: ["Obtain authorized final evidence review for disposition promotion; D-13's stale protected-status statements and all provider/legal/operations gates remain separately open."]
});

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

function runGit(args, options = {}) {
  return execFileSync("git", args, {
    cwd: repositoryRoot,
    encoding: options.buffer ? "buffer" : "utf8",
    maxBuffer: 64 * 1024 * 1024
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
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, sortedObject(entry)])
    );
  }
  return value;
}

function stableJson(value) {
  return `${JSON.stringify(sortedObject(value), null, 2)}\n`;
}

function parseArguments(argv) {
  let auditPath = process.env.WEVID_AUDIT_SOURCE ?? `/Users/maki/Downloads/${auditSourceName}`;
  let check = false;

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--audit") {
      auditPath = argv[index + 1];
      if (!auditPath) fail("--audit requires a path");
      index += 1;
    } else if (argument === "--check") {
      check = true;
    } else if (argument === "--help") {
      process.stdout.write(
        `Usage: node scripts/generate-audit-evidence.mjs [--audit PATH] [--check]\n`
      );
      process.exit(0);
    } else {
      fail(`Unknown argument: ${argument}`);
    }
  }

  return { auditPath: resolve(auditPath), check };
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

function buildIssueLedger(parsedAudit) {
  const groupMembers = new Map();
  for (const [id, group] of Object.entries(rootCauseGroupById)) {
    const members = groupMembers.get(group) ?? [];
    members.push(id);
    groupMembers.set(group, members);
  }

  const issues = parsedAudit.records.map((record, index) => {
    const prefix = issuePrefix(record.id);
    const status = statusForIssue(record.id);
    const rootCauseGroup = rootCauseGroupById[record.id] ?? null;
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
      affectedPaths: status.affectedPaths,
      baselineEvidence: {
        originalEvidenceArchiveAvailable: false,
        limitation: "The companion finding-index and evidence archive named by the audit were not supplied; source line anchors are retained without inventing missing artifacts."
      },
      workflowState: status.workflowState,
      finalDisposition: status.finalDisposition,
      resolution: {
        completeness: status.completeness,
        summary: status.summary,
        commit: null,
        residualWork: status.residualWork,
        scopeDecision: status.scopeDecision
      },
      verification: {
        executions: status.executions,
        finalTreeEvidenceRecorded: status.finalTreeEvidenceRecorded,
        rule: "A focused or skipped check is not final closure evidence; fixed requires the issue-specific required levels on the exact final tree."
      },
      externalPrerequisites: status.externalPrerequisites,
      documentation: [],
      owner: prefix.toLowerCase(),
      history: []
    };
  });

  const unresolvedCount = issues.filter((issue) => issue.finalDisposition === "unresolved").length;

  return {
    schemaVersion: 1,
    ledgerState: unresolvedCount === 0 ? "final" : "working",
    audit: {
      id: "wevid-full-audit-2026-11-04-71ceabc",
      sourceName: auditSourceName,
      sourceSha256: expectedAuditSha256,
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
      remote: runGit(["remote", "get-url", "origin"]).trim(),
      branch: runGit(["branch", "--show-current"]).trim(),
      headSha: runGit(["rev-parse", "HEAD"]).trim(),
      baselineSha,
      coverageManifestPath: manifestPath
    },
    preservationCheckpoint,
    statusModel: {
      workflowStates: ["untriaged", "confirmed", "in_progress", "implemented", "verified", "closed"],
      finalDispositions: ["unresolved", "fixed", "superseded", "deferred_scope", "blocked_external"],
      finalLedgerRule: "ledgerState=final is invalid while any issue has finalDisposition=unresolved",
      blockedExternalRule: "blocked_external requires a named owner, prerequisite, proof command, and fail-closed release or capability state; it cannot conceal unfinished routine local work",
      deferredScopeRule: "deferred_scope requires a cited accepted scope authority and an explicit non-advertised behavior",
      fixedRule: "fixed requires issue-specific affected paths plus at least one passed execution record on the repaired boundary"
    },
    summary: {
      byDomain: countBy(issues, (issue) => issue.domain),
      byFinalDisposition: countBy(issues, (issue) => issue.finalDisposition),
      byWorkflowState: countBy(issues, (issue) => issue.workflowState),
      priorityMentions: {
        P1: issues.filter((issue) => issue.priorities.includes("P1")).length,
        P2: issues.filter((issue) => issue.priorities.includes("P2")).length,
        P3: issues.filter((issue) => issue.priorities.includes("P3")).length,
        noneExplicit: issues.filter((issue) => issue.priorities.length === 0).length,
        note: "Priority mention counts overlap when a record is labelled with more than one priority."
      }
    },
    issues
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

function currentInventory() {
  const entries = new Map();
  const trackedRecords = parseNullSeparated(runGit(["ls-files", "-s", "-z"], { buffer: true }));
  for (const record of trackedRecords) {
    const tab = record.indexOf("\t");
    if (tab === -1) fail(`Malformed git ls-files record: ${record}`);
    const [mode, objectId, stage] = record.slice(0, tab).split(" ");
    const path = record.slice(tab + 1);
    if (stage !== "0") fail(`Unmerged index entry is not supported in audit evidence: ${path}`);
    entries.set(path, { path, provenance: "tracked", mode, indexObjectId: objectId });
  }

  const untrackedPaths = parseNullSeparated(
    runGit(["ls-files", "--others", "--exclude-standard", "-z"], { buffer: true })
  );
  for (const path of untrackedPaths) {
    if (!entries.has(path)) entries.set(path, { path, provenance: "untracked_relevant", mode: null, indexObjectId: null });
  }

  for (const generatedPath of [ledgerPath, manifestPath]) {
    if (!entries.has(generatedPath)) {
      entries.set(generatedPath, {
        path: generatedPath,
        provenance: "untracked_relevant",
        mode: "100644",
        indexObjectId: null
      });
    }
  }
  return entries;
}

function safeAbsolutePath(path) {
  const absolutePath = resolve(repositoryRoot, path);
  if (absolutePath !== repositoryRoot && !absolutePath.startsWith(`${repositoryRoot}${sep}`)) {
    fail(`Inventory path escapes repository root: ${path}`);
  }
  return absolutePath;
}

function contentBuffer(path, overrideBytes) {
  if (overrideBytes) return { bytes: overrideBytes, symlinkTarget: null, missing: false };
  const absolutePath = safeAbsolutePath(path);
  if (!existsSync(absolutePath)) return { bytes: null, symlinkTarget: null, missing: true };
  const metadata = lstatSync(absolutePath);
  if (metadata.isSymbolicLink()) {
    const target = readlinkSync(absolutePath);
    return { bytes: Buffer.from(target), symlinkTarget: target, missing: false };
  }
  if (!metadata.isFile()) fail(`Inventory path is not a regular file or symlink: ${path}`);
  return { bytes: readFileSync(absolutePath), symlinkTarget: null, missing: false };
}

function gitObjectId(bytes, objectFormat) {
  const header = Buffer.from(`blob ${bytes.length}\0`);
  return createHash(objectFormat).update(header).update(bytes).digest("hex");
}

function inferredMode(entry, path) {
  if (entry.mode) return entry.mode;
  const absolutePath = safeAbsolutePath(path);
  if (!existsSync(absolutePath)) return "100644";
  const metadata = lstatSync(absolutePath);
  if (metadata.isSymbolicLink()) return "120000";
  return (statSync(absolutePath).mode & 0o111) !== 0 ? "100755" : "100644";
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

function reviewClassification(path, baselineUnchanged, mode) {
  if (mode === "120000") {
    return {
      status: "symlink_accounted",
      reviewer: "scripts/generate-audit-evidence.mjs",
      method: "lstat and literal target inspection",
      lineRanges: [],
      limitations: ["The canonical target is inventoried separately and is not double-counted through the alias."]
    };
  }
  if (path === ledgerPath) {
    return {
      status: "generated_validated",
      reviewer: "scripts/generate-audit-evidence.mjs",
      method: "bounded source-register extraction with exact source hash, ID set, and count assertions",
      lineRanges: [],
      limitations: ["Resolution states remain conservative until final exact-tree evidence is recorded."]
    };
  }
  if (baselineUnchanged) {
    return {
      status: "external_attestation_only",
      reviewer: "external audit aggregate",
      method: "unchanged blob identity against audited baseline",
      lineRanges: [],
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
    limitations: [
      "Current modified or new content cannot inherit the baseline semantic-review claim and has no per-file review annotation in this artifact."
    ]
  };
}

function buildCoverageManifest(issueLedgerBytes) {
  const baselineEntries = baselineTree();
  const currentEntries = currentInventory();
  const objectFormat = runGit(["rev-parse", "--show-object-format"]).trim();
  if (objectFormat !== "sha1" && objectFormat !== "sha256") fail(`Unsupported Git object format: ${objectFormat}`);
  const overrides = new Map([[ledgerPath, issueLedgerBytes]]);
  const files = [];

  for (const entry of [...currentEntries.values()].sort((left, right) => left.path.localeCompare(right.path))) {
    if (entry.path === manifestPath) continue;
    const currentContent = contentBuffer(entry.path, overrides.get(entry.path));
    const mode = inferredMode(entry, entry.path);
    const baselineEntry = baselineEntries.get(entry.path) ?? null;
    const currentObjectId = currentContent.bytes ? gitObjectId(currentContent.bytes, objectFormat) : null;
    const baselineUnchanged = Boolean(
      baselineEntry && currentObjectId && baselineEntry.objectId === currentObjectId && baselineEntry.mode === mode
    );
    const binary = currentContent.bytes ? isBinary(currentContent.bytes, entry.path) : false;
    const kind = contentKind(entry.path, mode, binary);
    const review = reviewClassification(entry.path, baselineUnchanged, mode);
    const lineCount = currentContent.bytes && !binary && mode !== "120000"
      ? currentContent.bytes.toString("utf8").split("\n").length - (currentContent.bytes.at(-1) === 10 ? 1 : 0)
      : null;
    const symlinkCanonicalTarget = currentContent.symlinkTarget
      ? normalize(join(dirname(entry.path), currentContent.symlinkTarget)).split(sep).join("/")
      : null;
    const symlinkTargetInventoriedSeparately = symlinkCanonicalTarget
      ? currentEntries.has(symlinkCanonicalTarget) ||
        [...currentEntries.keys()].some((path) => path.startsWith(`${symlinkCanonicalTarget}/`))
      : false;

    files.push({
      path: entry.path,
      provenance: entry.provenance,
      changeOrigin: currentContent.missing
        ? "deleted_current_tree"
        : baselineUnchanged
          ? "unchanged_baseline"
          : baselineEntry
            ? "current_delta_origin_not_inferred"
            : "new_current_tree_origin_not_inferred",
      worktreeState: currentContent.missing
        ? "deleted"
        : baselineUnchanged
          ? "unchanged"
          : baselineEntry
            ? "modified"
            : "new",
      git: {
        mode,
        objectFormat,
        currentObjectId,
        indexObjectId: entry.indexObjectId,
        baselineObjectId: baselineEntry?.objectId ?? null,
        baselineMode: baselineEntry?.mode ?? null
      },
      content: {
        sha256: currentContent.bytes ? sha256(currentContent.bytes) : null,
        bytes: currentContent.bytes?.length ?? null,
        lineCount,
        kind,
        binary
      },
      role: kind,
      domains: domainsForPath(entry.path),
      symlink: mode === "120000"
        ? {
            target: currentContent.symlinkTarget,
            canonicalTargetPath: symlinkCanonicalTarget,
            targetInventoriedSeparately: symlinkTargetInventoriedSeparately
          }
        : null,
      baselineAttestation: {
        applicable: baselineUnchanged,
        sourceAuditSha256: baselineUnchanged ? expectedAuditSha256 : null,
        perPathOriginalEvidenceAvailable: false
      },
      review: {
        ...review,
        reviewedSha256: review.status === "external_attestation_only" || review.status === "symlink_accounted" || review.status === "generated_validated"
          ? currentContent.bytes ? sha256(currentContent.bytes) : null
          : null,
        findingIds: [],
        testEvidence: []
      }
    });
  }

  const digestRows = files.map((file) => ({
    path: file.path,
    mode: file.git.mode,
    provenance: file.provenance,
    sha256: file.content.sha256
  }));
  const discoveredEntries = [...currentEntries.values()];

  return {
    schemaVersion: 1,
    manifestState: "working",
    generator: {
      path: relative(repositoryRoot, scriptPath).split(sep).join("/"),
      version: 1,
      deterministicRules: [
        "Object keys are lexicographically sorted and arrays have explicit stable ordering.",
        "Timestamps and machine-specific absolute paths are omitted.",
        "The issue ledger is hashed from the same in-memory generated bytes used for output.",
        "Review annotations are bound to the exact current SHA-256."
      ]
    },
    repository: {
      remote: runGit(["remote", "get-url", "origin"]).trim(),
      branch: runGit(["branch", "--show-current"]).trim(),
      headSha: runGit(["rev-parse", "HEAD"]).trim(),
      baselineSha,
      gitObjectFormat: objectFormat,
      worktreeFingerprintSha256: sha256(Buffer.from(stableJson(digestRows)))
    },
    preservationCheckpoint,
    auditBasis: {
      sourceName: auditSourceName,
      sourceSha256: expectedAuditSha256,
      baselineTrackedPathCount: expectedBaselinePathCount,
      originalAggregateClaim: {
        textCodeConfigDocumentationFullSemantic: 1024,
        rasterMetadataOnly: 34,
        svgStructural: 8,
        generatedValidated: 2,
        migrationSymlink: 1
      },
      originalPerPathManifestAvailable: false,
      carryForwardRule: "Only exact baseline blob identity receives external_attestation_only; it is not promoted to current-agent semantic review."
    },
    inventory: {
      discoveredIncludingSelfManifest: discoveredEntries.length,
      tracked: discoveredEntries.filter((entry) => entry.provenance === "tracked").length,
      relevantUntracked: discoveredEntries.filter((entry) => entry.provenance === "untracked_relevant").length,
      accountedFiles: files.length,
      excludedFiles: 1,
      byContentKind: countBy(files, (file) => file.content.kind),
      byReviewStatus: countBy(files, (file) => file.review.status),
      byWorktreeState: countBy(files, (file) => file.worktreeState)
    },
    scopeExclusions: [
      {
        path: manifestPath,
        reason: "The generated coverage manifest self-excludes to avoid recursive content hashing.",
        onlySelfExclusion: true
      }
    ],
    unresolvedCoverage: files
      .filter((file) => file.review.status === "pending")
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
  if (ledger.ledgerState === "final" && ledger.issues.some((issue) => issue.finalDisposition === "unresolved")) {
    fail("A final ledger cannot contain unresolved dispositions");
  }
  for (const issue of ledger.issues) {
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
      if (issue.verification.executions.some((execution) => execution.outcome !== "passed")) {
        fail(`${issue.id} is fixed with a non-passing execution record`);
      }
    }
    if (issue.finalDisposition === "deferred_scope") {
      const decision = issue.resolution.scopeDecision;
      if (!decision || typeof decision.authority !== "string" || typeof decision.acceptedBehavior !== "string") {
        fail(`${issue.id} is deferred_scope without a cited scope decision`);
      }
    }
    if (issue.finalDisposition === "superseded" && issue.verification.executions.length === 0) {
      fail(`${issue.id} is superseded without replacement/withdrawal evidence`);
    }
  }
}

function writeOrCheck(path, expectedBytes, check, stalePaths) {
  const absolutePath = safeAbsolutePath(path);
  if (check) {
    if (!existsSync(absolutePath) || !readFileSync(absolutePath).equals(expectedBytes)) stalePaths.push(path);
    return;
  }
  mkdirSync(dirname(absolutePath), { recursive: true });
  writeFileSync(absolutePath, expectedBytes);
}

function main() {
  const { auditPath, check } = parseArguments(process.argv.slice(2));
  const parsedAudit = parseAudit(auditPath);
  const ledger = buildIssueLedger(parsedAudit);
  validateLedgerForOutput(ledger);
  const ledgerBytes = Buffer.from(stableJson(ledger));
  const manifest = buildCoverageManifest(ledgerBytes);
  const manifestBytes = Buffer.from(stableJson(manifest));
  const stalePaths = [];

  writeOrCheck(ledgerPath, ledgerBytes, check, stalePaths);
  writeOrCheck(manifestPath, manifestBytes, check, stalePaths);

  if (check && stalePaths.length > 0) {
    process.stderr.write(`Audit evidence is stale: ${stalePaths.join(", ")}\n`);
    process.exitCode = 1;
    return;
  }

  process.stdout.write(
    check
      ? `Audit evidence is current (${ledger.issues.length} findings, ${manifest.inventory.accountedFiles} accounted files).\n`
      : `Generated audit evidence (${ledger.issues.length} findings, ${manifest.inventory.accountedFiles} accounted files).\n`
  );
}

main();
