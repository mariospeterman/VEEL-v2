# Payment, subscription, referral and receipt audit revalidation

Date: 4 November 2026. Source: `mariospeterman/VEEL-v2@71ceabcfaa8a5258e1b935a391ff4e6e7330c682` in `wevid-complete`. Read-only application review; no application source, chain, provider or production state changed.

## Result

The existing high-impact payment findings remain valid. Re-execution confirmed PAY-01's native split-underpayment bug (5,500 transferred against a 10,000 quote accepted) and PAY-02's unstable first-period key (two unexpired processing collections for one subscription, attempt 1 each). PAY-09's email formatting proof still prints `1000000000 SOL` for 1 SOL. Independent static review confirms the nonce collision, cancellation arbitration, error classification, webhook atomicity, email retry/starvation, recurring financial artifacts, accepted-plan mutability, pagination, submission replay, missing failure projection and bounded listing issues. No existing payment finding was withdrawn by this pass.

One additional recurring setup recovery defect is confirmed below. Keep all recurring defects qualified as requirements before enabling the currently fail-closed integration; this is not evidence of an exploited live billing feature.

## PAY-17 — P2 before enabling recurring — Refreshing an authorization transaction invalidates an earlier valid signed setup

**Sources:**

- `apps/api/src/modules/subscription/subscription-authorization-transaction.ts:82` derives `delegationExpiresAt` from a fresh `Date.now()` on every build, including a rebuild for the same logical authorization intent.
- `apps/api/src/modules/subscription/subscription-routes.ts:397–407` builds and writes the returned terms on every GET `/v1/subscriptions/authorizations/:authorizationIntentId/transaction`.
- `apps/api/src/modules/subscription/subscription-authorization-verification-repository.ts:105–120` unconditionally overwrites the same intent's expiry while state is created/submitted.
- `apps/api/src/modules/subscription/subscription-verifier.ts:91–96` rejects a valid delegation if its on-chain expiry differs from the overwritten expected expiry by more than 1 second, returning non-retryable `expired`.

**Trigger and effect:** Two tabs, a lost-response retry or a later transaction fetch can rebuild setup after the first transaction has already been signed/broadcast. A second fetch 5 seconds later changes the saved expected expiry by 5 seconds. The first valid transaction can land and establish a real authorization, yet its submission then fails verification as expired. The user can be left with active on-chain spending authorization while the application remains unactivated. Transaction blockhash refresh should not silently change accepted setup terms.

**Executed proof:** `verification-subscription-expiry-proof.mjs` loads the actual unmodified builder and verifier source with `stripTypeScriptTypes` in a VM, using SDK/RPC and clock fixtures. First build expiry: `2027-11-05T14:00:00.000Z`; second build: `2027-11-05T14:00:05.000Z`. Chain fixture retains first signed expiry. Verification against second saved expiry returns `{verified:false,failureCode:"expired",retryable:false}`. The control using the first expected expiry returns `verified:true`. See `verification-subscription-expiry-proof.json`. Route and SQL overwrite path is a static trace, not an executed full API/database/chain journey.

**Fix:** Atomically persist immutable setup terms (including nonce, expiry, amount, period, authority and recipients) once for the logical authorization. Refresh transaction blockhash without changing accepted terms. If terms must change, use an explicit versioned supersession/cancellation policy bound to the exact signed setup and reconcile any previously broadcast transaction before asking for another authorization. Do not mark a still-live authorization as genuinely expired because local expected facts drifted.

**Regression:** Build the same intent twice more than a second apart, submit the first signed transaction, and prove stable verifiability or an explicitly safe supersession outcome. Cover concurrent requests/tabs, lost GET response, fetch retry, transaction expiry refresh, signature broadcast before refresh, and submit after refresh. Prove no orphan authorization, duplicate delegation, hidden debit or accidental activation.

## Required instruction addition

Add to the recurring setup work package:

> Keep authorization setup terms immutable across transaction refreshes. Repeated GET/retry/two-tab transaction generation must reuse the persisted nonce, expiry, amount and period; refresh only transient blockhash metadata. An earlier valid signed or broadcast setup must remain reconcilable against its accepted version. Fix PAY-17 and prove original-transaction submission after a later fetch, lost responses and concurrent requests without leaving an orphan live authorization.

Receipt URL narrowing: next.config.ts explicitly redirects /activity to /app/activity and /wallet to /app/wallet. Canonical-link changes are consistency cleanup, not a broken-link defect; the PAY-09 atomic display issue remains.

The rest of section C is appropriately provider-first and preserves separate payment, entitlement, reporting and bookkeeping authorities. Its no-mainnet/no-custody boundaries and disabling of recurring until exact release-bound proof should remain.

## Independent review coverage and execution limits

`verification-payments-coverage.json` records 61 complete files with full line ranges, reviewer and SHA-256: all 60 originally assigned full-read files plus next.config.ts. AGENTS.md was fully available in inherited context; this reviewer reread the other 37 primary files and `verify_payments/money_secondary` reread 22 settlement-helper/test files plus next.config.ts. Its completed report is `verification-money-secondary.md`. This pass does not upgrade the original cross-domain partial ranges to full reread. The aggregate initial audit already records their owners.

Commands executed during this validation:

- `node payment-audit-proof.mjs`: reproduced PAY-01 and PAY-09. Separate result: `verification-payment-rerun.json`.
- `node db-proof-runtime/subscription-proof.mjs`: all 118 original migrations run in PGlite with auth stubs, followed by the actual extracted repository SQL; two first-period processing rows reproduce PAY-02. Separate result: `verification-subscription-rerun.json`.
- `node verification-subscription-expiry-proof.mjs`: PAY-17 counterexample and passing control.
- SHA-256 equality checked for the existing proof checkout versus exact review checkout's `solana-payment.ts` and `subscription-collections.ts`.

Proof reruns used host Node `v24.22.1`, not the repository baseline Node 22.16.0; these are targeted source/SQL probes and do not replace the recorded baseline suite. The payment and expiry proofs mock SDK/RPC/serialization/clock boundaries; the collection proof uses embedded PostgreSQL WASM and auth stubs, not hosted Supabase, native Postgres or a Solana cluster. Original proof outputs were restored byte-for-byte from the pre-existing evidence ZIP after rerunning; new outputs are separate. No live chain transaction, provider email, signing or external database operation occurred. No claim is made that provider credentials, approval, genuine wallet behavior or staging E2E are proven.

## Current official provider checks

Primary sources were rechecked with web retrieval on 4 November 2026:

- Solana verification tools: https://solana.com/docs/payments/accept-payments/verification-tools — server-side verification, mint/program validation, commitment and duplicate-signature protection.
- Solana Pay transfer requests: https://solana.com/docs/tools/solana-pay/quickstart/transfer-requests — exact amount/recipient checks and unique references.
- Recurring delegation: https://solana.com/docs/payments/subscriptions/recurring-delegation — nonce-derived PDA, base-unit amounts, on-chain period limits, expiry and delegatee-signed receiver transfers.
- Maintained provider source: https://github.com/solana-foundation/subscriptions/blob/main/docs/001-program-architecture.md and https://github.com/solana-foundation/subscriptions — current init-ID, start-on-landing, delegation scope and event guidance.

The recurring primitive permits the approved delegatee to select the receiver account within the spending bound. The existing audit correctly requires accurate signer blast-radius disclosure and explicit acceptance before calling this equivalent to receiver-bound billing. A new custom program is not justified by these bugs.
