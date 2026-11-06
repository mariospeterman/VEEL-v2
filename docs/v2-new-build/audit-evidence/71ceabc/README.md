# Audit Closure Evidence For 71ceabc

Status: draft
Evidence state: working; not a product, architecture, contract, schema, migration, or production-status authority

Scope: deterministic accounting for the 4 November 2026 audit of baseline
`71ceabcfaa8a5258e1b935a391ff4e6e7330c682`, the PR #134 follow-up findings, and captured
verification receipts for the settled repair source.

Product behavior remains owned by the canonical domain docs, OpenAPI, migrations, provider
adapters, and executable tests. `production-status.json` remains the merged-baseline authority and is
not advanced by this working evidence.

## Deterministic Model

`scripts/generate-audit-evidence.mjs` reads tracked content from stage-zero Git index blobs. It never
uses protected dirty or untracked worktree bytes as committed-source evidence. Its stable source
fingerprint is the SHA-256 of code-point-sorted `path`, Git mode, and content-SHA-256 rows.

The fingerprint explicitly excludes:

- `issue-ledger.json` and `file-coverage.json`, because generated outputs cannot fingerprint
  themselves;
- `execution-receipts/`, because receipts bind to the source fingerprint and cannot also be inputs
  to it;
- `semantic-reviews/`, because exact-hash review records bind to the same fingerprint and would
  otherwise create another recursive input.

The coverage manifest still inventories the generated ledger, tracked receipt/log files, and tracked
semantic-review records. Only the coverage manifest itself is absent from its own file inventory.
Branch names, remote URLs, commit SHAs, timestamps, and absolute machine paths are omitted from
deterministic artifacts.

There is currently no approved external trust anchor or independently verified CI attestation input.
Local receipts and semantic-review records are supporting declarations only. They cannot clear a
finding or semantic-coverage gate, regardless of the reviewer string they contain. The manifest and
`--check` therefore remain `working` until a separately provisioned trusted attestation mechanism is
approved and implemented; this tool does not invent signature, OIDC, or CI trust.

Local workspace state is reported separately. The protected
`docs/v2-new-build/current-implementation-status.md` worktree change and all other dirty/untracked
paths are never copied into these JSON artifacts.

## Findings

- `issue-ledger.json` retains all 159 exact baseline audit IDs, source hash, source lines, and
  conditions.
- PR #134 follow-up findings use a separate `PR134-NNN` namespace and separate counts. Each links to
  one or more canonical baseline IDs. A supplemental finding may reopen a baseline disposition, but
  never replaces or silently renumbers it.
- Historical command prose is explicitly unverified. It cannot support `fixed` or `superseded`.
  Those dispositions require exact-bound structured receipt declarations plus independently
  provisioned trusted CI/release attestation.
- Missing, failed, invalid, stale-source, log-mismatched, and zero-test receipts remain visibly
  `unrun`, `failed`, or `invalid`; they are not converted to passes.

## Execution Receipts

Declare every intended `receiptReference(...)` in the generator registry before freezing the
source fingerprint. Each reference binds the exact argv array, repository-relative cwd, structured
result kind, receipt ID, and expected evidence paths. Adding or changing a reference after capture
changes fingerprint-included source and invalidates the earlier receipt. Unknown result kinds,
`generic` success, shell wrappers, and no-op executables such as `true` cannot promote findings.

Capture refuses any dirty tracked or untracked path both before and after command execution. It also
rebuilds and compares the complete stage-zero snapshot after the command and version probes, before
writing anything. A test that changes the index, tracked source, or creates a nonignored untracked
path gets no receipt. The protected local status-document change and unapproved `0130` drafts mean
capture must run in a clean detached worktree of the settled source. Ignored dependency/build
directories do not affect this check.

Capture a direct argv command without `sh`, `bash`, `zsh`, PowerShell, or another shell wrapper.
Secret-bearing argv is rejected before execution and before command metadata is persisted. For
example, the worker package has no
package-local `test` script, so target worker tests through the root Vitest runner:

```sh
env PATH=/Users/maki/.nvm/versions/node/v22.23.4/bin:/usr/local/bin:/usr/bin:/bin \
  node scripts/capture-audit-execution.mjs \
  --id worker-payment-email \
  --kind vitest \
  --log docs/v2-new-build/audit-evidence/71ceabc/execution-receipts/worker-payment-email.redacted.txt \
  --evidence apps/worker/test/index.test.ts \
  --evidence apps/worker/src/payment-confirmation-email.ts \
  -- pnpm exec vitest run apps/worker/test/index.test.ts
```

The capture tool records exact argv, Node/pnpm/Git versions, exit code, signal, structured test
counts, exact evidence hashes, and a redacted log fingerprint. Child processes receive an explicit
minimal environment allowlist; provider keys, cookies, sessions, and tokens are not inherited.
Provider-prefixed names such as `SUPABASE_SERVICE_ROLE_KEY`, `GH_TOKEN`,
`AWS_SECRET_ACCESS_KEY`, and `HELIUS_API_KEY` are rejected/redacted. Final receipt and log bytes are
scanned again before exclusive atomic writes. Existing targets, symlink targets, and symlink
ancestors are rejected. A test command that exits zero but collects zero tests or executes no
non-skipped test is invalid, not passed. Logs must use the stageable `.redacted.txt` suffix; ignored
`.log` files are rejected.

After inspecting a receipt and redacted log for missed sensitive output, stage both files before
capturing another receipt. Receipt and review-record prefixes do not change the source fingerprint,
but they must be tracked stage-zero index inputs before generation can validate them.

## Exact-Hash Semantic Review Records

Changed and new source cannot inherit baseline semantic coverage. One tracked JSON record below
`semantic-reviews/` may cover each current file. Records are excluded from the source fingerprint,
inventoried as machine review inputs, and validated against the exact fingerprint and file hashes.
Duplicate coverage, partial full-text ranges, unsafe paths, stale hashes, nonexistent findings, and
invalid receipt links fail generation.

```json
{
  "schemaVersion": 1,
  "id": "api-pagination-review",
  "sourceFingerprintSha256": "<settled-source-fingerprint>",
  "reviewer": { "kind": "agent", "id": "reviewer-name" },
  "method": "complete line-by-line semantic read with affected consumer tracing",
  "files": [
    {
      "path": "apps/api/src/shared/keyset-pagination.ts",
      "sha256": "<exact-stage-zero-blob-sha256>",
      "coverage": "full_semantic",
      "lineRanges": [{ "startLine": 1, "endLine": 240 }],
      "findingIds": ["AUTH-11"],
      "receiptIds": ["api-pagination-native"]
    }
  ]
}
```

`coverage` is `full_semantic` for text, `structural` for SVG, or `binary_metadata` for binary assets.
Full/structural ranges must contiguously cover the entire exact file. Binary records use an empty
range list. A reviewer ID is attribution, not authentication: the record is a declaration of the
inspection and remains closure-ineligible without independent trusted attestation. Linked receipts
are likewise exact-bound execution declarations, not standalone trust proof.

Changed symlinks may not be absolute, ambiguous across platforms, or escape the repository. Their
canonical target must be separately inventoried, must not be another symlink, and every target file
must have an exact-hash review declaration. Those declarations still remain pending trusted
attestation.

## Original Audit Archive

The supplied original audit text and evidence package are tracked below `audit-inputs/`. Generation
and checking still require an explicit `--audit PATH`; there is no machine-local Downloads default.
Use the tracked `audit-inputs/WeVid_Full_Audit_71ceabc.txt`, whose SHA-256 is independently pinned by
the generator.

`audit-inputs/original-evidence-index.json` binds the exact original ZIP and all 148 extracted
members below `audit-inputs/original/` by byte length and SHA-256. The validated import includes
`finding-index.json` and `WeVid_Coverage_71ceabc.json`. Import validation rejects
absolute/traversal paths, duplicate normalized members, unsupported counts/sizes, archive hash
mismatch, member hash mismatch, and unindexed tracked members. A valid archive import proves byte
identity and self-contained availability only: it does not promote semantic coverage until the
supplied manifest schema is parsed and reconciled against every baseline blob, and it does not
create a trusted closure attestation.

Coverage classes remain distinct:

- imported baseline full-text attestation;
- baseline binary metadata or SVG structural inspection;
- generated validation;
- current exact-hash full semantic, full SVG structural, or binary-metadata review declaration;
- pending current review.

Matching hashes prove identity, not understanding. A partial read is never upgraded to full semantic
review because a path exists or a hash matches.

## Generate And Check

First stage every intended source, test, documentation, migration, disposition registry entry,
review record, receipt, and audit-input file. Leave the protected status-document worktree change
unstaged. Generation rejects that path if staged. Then generate:

```sh
env PATH=/Users/maki/.nvm/versions/node/v22.23.4/bin:/usr/local/bin:/usr/bin:/bin \
  node scripts/generate-audit-evidence.mjs \
  --audit docs/v2-new-build/audit-evidence/71ceabc/audit-inputs/WeVid_Full_Audit_71ceabc.txt \
  --workspace-report "${TMPDIR:?}/wevid-audit-workspace.json"
```

Verify without writing and require actual closure:

```sh
env PATH=/Users/maki/.nvm/versions/node/v22.23.4/bin:/usr/local/bin:/usr/bin:/bin \
  node scripts/generate-audit-evidence.mjs \
  --audit docs/v2-new-build/audit-evidence/71ceabc/audit-inputs/WeVid_Full_Audit_71ceabc.txt \
  --check
```

`--check` fails when bytes are stale, any baseline or supplemental finding remains unresolved, any
file lacks closure-eligible semantic coverage, or trusted closure attestation is unavailable. The
last condition is intentionally true in the current model. A generated working ledger is not a
closure pass. `--workspace-report` is optional, restricted to the OS temporary directory, and uses a
symlink-safe atomic write.

Exact-head CI may record these three association values after committing generated outputs:

```sh
git rev-parse HEAD
node scripts/generate-audit-evidence.mjs --print-source-fingerprint
shasum -a 256 \
  docs/v2-new-build/audit-evidence/71ceabc/issue-ledger.json \
  docs/v2-new-build/audit-evidence/71ceabc/file-coverage.json
```

The commit association stays external. Putting the final commit SHA back into either recursive JSON
artifact would make the next commit invalidate it again. These values are useful association inputs,
but they are not a trusted attestation by themselves and the current `--check` must not turn green
from them. A future approved CI/release trust boundary must independently provision and verify the
attestation before the evidence can become final.

The two `node:test` evidence suites run through the normal root surface: `pnpm test` runs Vitest and
then `pnpm test:evidence`. Vitest continues to exclude those files so they are not mis-collected as
empty Vitest suites.

## Historical Preservation Checkpoint

- Checkpoint ID: `wevid-checkpoint-71ceabc-s1m154`
- Tracked patch SHA-256: `befae1c8bddbc72fcf31659b046a1e898a4912110f73a92c9b80475069797617`
- Relevant untracked archive SHA-256: `723a3cd8200c7a41113fee1cf72d15900cf0e8ffde822bf3ac645ab662899978`

These values describe the earlier preserved workspace checkpoint only. They are not the current
tracked-source fingerprint, semantic review proof, or final commit association.
