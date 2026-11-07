WEVID AUDIT EVIDENCE — 71ceabc

Read WeVid_Full_Audit_71ceabc.txt first, then use the separate Codex instruction.
Source: https://github.com/mariospeterman/VEEL-v2 @ 71ceabcfaa8a5258e1b935a391ff4e6e7330c682.
The user's Mac uncommitted changes were unavailable. No source fix or production action occurred.

Contents:
- WeVid_Coverage_71ceabc.json: every tracked path with bytes/hash/review classification.
- *coverage.json: reviewer-level reading records; aggregate closes scoped/partial reviews.
- finding-index.json: 159 numbered observations, including a withdrawn ROOT-02 hypothesis.
- *audit.md: detailed domain source evidence, conditions and repair directions.
- validation-summary.json, logs, structured default test results and full dependency advisory JSON.
- *proof*.json / *repro*.json: bounded reproduction outputs and explicit engine/mock limitations.
- Runnable source/SQL reproduction scripts. These are audit probes, not a replacement test suite.

Reproduction environment:
Baseline Node22.16.0 / pnpm10.0.0; frozen repository install.
SQL probes used @electric-sql/pglite0.5.15, pgcrypto, and explicit auth.uid/auth.jwt stubs.
Some probes use compiled actual repository modules, a reduced schema or dependency stubs and absolute workspace paths. Read each script first; relocate checkout/runtime paths and install its listed dependencies in a disposable scratch environment before running. There is deliberately no node_modules or whole repository copy in this archive. PGlite/fixture results do not prove hosted Supabase Auth/Storage/Realtime or live provider behavior.
The original rollback failure and the runtime-only follow-up correction are distinct records; no SQL source was patched. Intentionally irreversible retention recovery boundaries are not labeled accidental rollback defects.

Actual results: 619 default tests passed,10 skipped,0 failed; lint/typecheck/build/generation/static checks passed. Current dependency audit failed. Browser download failed, so no browser acceptance was claimed. All118 forwards executed in embedded PostgreSQL; three populated upgrades,0039 rollback and0117 expiry downgrade have failures. See individual proofs.
Independent verification extends the register to 159 records (AUTH-22, AUTH-23, PAY-17) and expands existing affected paths; read verification-additions-audit.md plus the individual verification reports. Original semantic coverage attestations and baseline results are retained, not recast as a second complete reread. New source/runtime/SQL probes identify their fixture limits and host Node24 runtime separately.
All values in probes are disposable/synthetic fixtures; no live provider secrets are included.
