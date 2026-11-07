# WeVid payments / subscriptions / referrals audit

Audit date: 2026-11-04. Exact source: `mariospeterman/VEEL-v2`, `71ceabcfaa8a5258e1b935a391ff4e6e7330c682`.

Scope: full text of payment, subscription, referral modules, Solana token boundary, assigned worker money jobs, specific unit tests. Exact coverage is in `payments-coverage.json`; whole shared worker test file and cross-domain files were read only in the listed ranges. No repository fixes performed. This is an evidence-backed issue list, not a claim of exhaustive or penetration-test completeness. Local Mac uncommitted changes are unavailable.

Important positive boundaries: integer-safe one-time split calculations use BigInt intermediate arithmetic; one-time settlements are verified server-side; primary payment intent/consent/settlement writes are transactional; creator/referral economics preserve creator share; native SOL recurring is explicitly rejected; subscription sales are intentionally fail-closed pending external evidence. Do not remove those gates to make a demo pass.

## Confirmed issues

### PAY-01 — P1 — One transfer can satisfy two split legs, accepting an underpayment

Evidence: `apps/api/src/modules/payment/solana-payment.ts:189`, `:199`, `:231`, `:249` independently use `instructions.some`. There is no consumed-instruction multiset or aggregated recipient requirement. Expected gross10000, creator4500, enterprise4500, platform1000, with creator and enterprise sharing one address: actual transfer4500 to shared recipient +1000 platform is accepted as confirmed. Organization/creator wallet equality is permitted by schema (`0090` organization settlement wallet definition and `0099` resolver; database audit independently checked no distinct-recipient constraint).

Executed proof: `payment-audit-proof.mjs` evaluates the actual source verifier with a mocked RPC and native-only dependency stubs. `payment-audit-proof-results.json` records expectedConfirmed=false, actualConfirmed=true, actual transferred5500 versus gross10000. This is not an on-chain integration proof, but reproduces the verifier logic exactly.

Fix: canonicalize expected transfers by program/mint/source/destination, aggregate amounts or consume a validated multiset, and ensure one evidence leg cannot pay multiple obligations. Test shared creator/enterprise/referral/platform addresses, equal-sized legs, repeated/split instructions, SOL and USDC. Keep quote exactness and signature-global uniqueness.

### PAY-02 — P1 — First subscription collection uses a changing period/idempotency key

Evidence: `subscription-authorization-verification-repository.ts:258` clears period dates and schedules immediately. `apps/worker/src/subscription-collections.ts:563` derives first period from `input.now`, `:623` builds period idempotency from it, `:707` marks renewal_pending without persisting that initial period. Another tick/worker derives another timestamp and collection row while the first is processing, or after a timeout/failure. Its attempt count resets to1, so reconciliation, lease, backoff, and attempt ceiling are bypassed for first payment.

Fix: persist a stable initial billing anchor and immutable period collection before provider work; enforce one in-flight collection per subscription/period; retain that row across first-charge retries. Test two worker processes, delayed provider, crash after send, failure/backoff, and retry across on-chain period reset. Validate exact source and chain outcome before retrying debit.

Additional executed proof: database auditor ran the actual repository's tagged SQL against all118 migrated schemas in PGlite. Two lease calls at t0/t0+1s returned two different processing rows with attempt_count1 while the first lease was still valid. See `subscription-initial-period-proof.json` and `db-proof-runtime/subscription-proof.mjs`. This proves SQL behavior in embedded PostgreSQL; it is not shared cloud Supabase/provider proof.

### PAY-03 — P1 — Every subscription uses nonce0 and collides with the same user's other memberships

Evidence: `packages/database/migrations/0098_recurring_membership_authority.sql:9` defaults subscription delegation_nonce to0. `subscription-authorization-intent-repository.ts` never sets or advances it. `subscription-authorization-transaction.ts:78` derives PDA from authority/delegator/delegatee/nonce; `:119` creates recurring delegation with that nonce. Same wallet/mint/collector yields same PDA across platform plans and all creator subscriptions. Second concurrent membership attempts to create an existing account.

Fix: allocate and persist a unique per-subscription nonce safely, preserve on retry, enforce namespace uniqueness, derive with official SDK. Test one wallet joining two creators plus a platform plan, independent cancellation/revocation, and setup retries.

### PAY-04 — P1 — In-flight first collection can reactivate a cancelled subscription and charge after cancellation

Evidence: `subscription-cancellation-repository.ts:135` cancels only collections in due/failed. Initial-period cancellation sets subscription state cancelled, but processing collection survives. `apps/worker/src/subscription-collections.ts:791` sets state active after success without checking subscription cancellation/current lease/domain version. Provider call can also happen after cancellation because the leased object is not reauthorized immediately before spend.

Fix: define cancellation-versus-collection arbitration transactionally, prohibit new debit once cancellation wins, reconcile already-broadcast transactions without restoring an explicitly cancelled lifecycle, and record remedy when an unavoidable in-flight charge succeeds. Test cancellation before send, after send, and before outcome persistence.

### PAY-05 — P1 — Transient transaction expiry is misclassified as delegation revocation

Evidence: `apps/worker/src/subscription-collections.ts:301` treats any error message matching expired, closed, not found, invalid account data as revoked. A transaction blockhash expiration/RPC response can contain expired even though authorization is valid. Outcome handling permanently sets subscription revoked and stops billing.

Fix: classify typed transport/transaction failures, reconcile uncertain signatures, query/decode canonical delegation state for actual revocation/expiry. A blockhash expiry should remain recoverable. Test TransactionExpiredBlockheightExceededError, dropped/timeout transactions, missing RPC history versus actually closed delegation.

### PAY-06 — P1 — Solana webhook receipt and replay event are not inserted atomically

Evidence: `payment-evidence-repository.ts:30` inserts receipt, then `:53` separately inserts normalized provider_event with a second committed SQL call. Crash between commits leaves a receipt only. Redelivery detects receipt conflict and returns false; route skips it; replay worker has no event to recover.

Fix: shared Postgres transaction for receipt+normalized event, or durable orphan recovery with safe retry semantics. Fault-inject between inserts and verify redelivery and replay recover exactly once. Do not rely on operator manual settlement to cover lost durable inbox writes.

### PAY-07 — P1 — Email failures never re-enter the retry queue

Evidence: `apps/worker/src/payment-confirmation-email.ts:200` candidates are queued (+provider_not_configured), while `:308` stores provider failure as failed and next_attempt_at. failed is absent from leasing predicate; backoff never runs again. Existing tests mock repository and do not test SQL retry selection.

Fix: include retryable failed rows due by next_attempt_at, distinguish permanent failures, preserve lease token/attempt cap, use real-Postgres retry/dead-letter tests.

### PAY-08 — P1/P2 — Earliest wallet-only/no-email users can starve the email queue

Evidence: email job subquery limits earliest due delivery IDs before joining users/auth.users and requiring non-null email (`payment-confirmation-email.ts:231` through `:246`). If earliest50 rows have no usable email, outer UPDATE returns zero; those rows remain due forever, blocking valid email recipients behind them. Wallet-first onboarding makes absent recovery email an expected state.

Fix: select eligible recipients before limit/lock or record explicit waiting_for_contact state with an indexed recovery path. Test50 missing-email rows followed by valid recipients. Do not force consumer email setup solely to work around queue design.

### PAY-09 — P2 — Receipts email prints atomic units as whole SOL/USDC

Evidence: `payment-confirmation-email.ts:332` and `:353` interpolate raw amountMinor with currency. Executed proof renders Amount:1000000000 SOL for1 SOL. Same problem affects USDC atomic integers.

Fix: store asset/mint/decimals evidence and format display units with exact integer decimal conversion in shared money presentation. Preserve raw atomic amounts internally. Add1 SOL,0.025 SOL,1 USDC, maximum supported safe amount, and locale tests. Email activity links use /activity while canonical UI is /app/activity; verify redirects rather than silently assuming aliases.

### PAY-10 — P1 before enabling recurring — Confirmed subscription collections omit durable financial artifacts

Evidence: `apps/worker/src/subscription-collections.ts:762` confirmed branch only marks collection, subscription period, and event. No receipt, receipt line, wallet transaction, compliance-ledger entry, durable confirmation, or accounting export event is produced. Database audit confirmed no subscription_collections trigger creates these artifacts across118 forward migrations. One-time payment confirmation (`payment-durable-confirmation.ts`) does create them, so recurring revenue bypasses canonical reporting and user receipt flow.

Fix: add atomic recurring settlement domain outcome using existing receipt/reporting authorities; collection ID/signature provides durable uniqueness. Do not create a second competing ledger or fake a user-to-platform custody path. Prove first payment/renewal/crash/replay emit exactly one complete financial artifact set and appear in Activity/tax/accounting analytics.

### PAY-11 — P1/P2 before enabling recurring — Editing creator offer disables existing billing and overwrites the referenced price

Evidence: `creator-membership-offer-repository.ts:129` updates one deterministic plan ID in place, resets provider_state staging_required and state disabled (`:146`). Worker requires plan active+launch_approved and reads split amounts/mint from mutable current plan while gross subscription amount is snapshotted. Any metadata edit disables all renewals until reapproval; price increase can trigger split mismatch after reapproval; price decrease excludes old subscriptions via oldamount<=newamount guard. Old approval does not authorize new terms.

Fix: separate offer presentation from immutable accepted billing terms/plan versions. Pause new sales/reauthorize changed terms without silently breaking paid existing periods. Test label-only edit, increase/decrease, wallet/mint change, disable sales, and subscriber opt-in.

### PAY-12 — P2 — Referral activity pagination loses rows and is unstable across commissions

Evidence: `referral-repository.ts:140` cursor uses created_at strict <, `:161` returns timestamp of fetched extra row instead of last returned row. That extra row is skipped permanently. One referral token joins multiple commission rows with identical token timestamp, so a page boundary can also drop many commissions; no deterministic tie-breaker exists.

Fix: choose stable row identity (commission or token aggregate), explicit API model, bounded compound keyset cursor from last returned row; validate cursor. Test21 rows, equal timestamps, multiple commissions per token, adjacent concurrent inserts, and exhaustive pagination without gaps/duplicates.

### PAY-13 — P2 — Submission idempotency headers are required but not implemented

Evidence: `payment-intent-routes.ts:452` requires Idempotency-Key but never forwards/persists it at `:505`; recordSubmission input has no key/hash. Changed signature under same key is accepted and each replay appends settlement attempt. Subscription submit receives a key but `subscription-authorization-verification-repository.ts` ignores it; successful first submission makes a retry404 because context selects only created/submitted intents, not verified. This violates canonical documented exact-replay/changed-input-conflict behavior and produces confusing recovery after lost HTTP response.

Fix: actor/action/key/request hash receipts and stable response replay across completed logical operation. Keep legitimate new signature attempts explicit when an old signature definitively failed. Test lost response retry, changed signature samekey, concurrent requests, confirmed/verified replay.

### PAY-14 — P2 — Subscription/provider failure detail is always discarded on reads

Evidence: `subscription-repository-mappers.ts:71` hardcodes failureReason:null; subscription queries do not select failure_reason, despite worker/API writing it. Consumer cannot distinguish insufficient funds, revoked authorization, provider outage, or setup mismatch and remediation remains vague.

Fix: project sanitized registered failure reason and actionable status through existing contract/UI, never raw provider messages/keys/PDA forms. Test worker failure then list/detail projection and retry/reconnect actions.

### PAY-15 — P2 scalability — Subscription plan and subscription listing are unbounded

Evidence: `subscription-repository.ts` listPlans returns every active creator+platform plan with no pagination or creator filter, listSubscriptions returns user's entire history with no cap/cursor. Creator ecosystem growth makes a single plans request proportional to all creators and sends irrelevant offers.

Fix: platform-plan endpoint/query and creator-specific current offer selector, bounded cursor history/active lists with matching contracts and indexes. Do not invent a second plan authority; extend canonical query shape. Load-test realistic creator/subscription counts.

### PAY-16 — P2 scope gap — General content unlock remains SOL-only despite reusable one-time USDC path

Evidence: actual `content-read-repository.ts:211` filters currency SOL, so USDC-priced access rules yield no payable offer. In addition, `payment-content-unlock-routes.ts:76` does not pass tokenMint/tokenDecimals, unlike Support and commercial-message offer paths. Therefore removing the SOL filter alone still produces unbuildable USDC intent. This is a feature/integration gap, not a proven currently reachable underpayment or statement that all USDC payments fail. Paid live/Event Access are explicitly composed SOL-only today.

Fix: either state SOL-only per product accurately or finish USDC consistently end-to-end using canonical mint registry/price precision, quote, transaction, verifier, receipts and UI. User requested SOL/USDC-capable commerce, so include in closure scope if product accepts it. Test real stored offer -> intent -> wallet tx -> exact settlement -> entitlement for each advertised asset.

## Hardening gaps before provider approval (do not mislabel currently disabled sales as a live exploit)

- Subscription first-checkout terms/waiver evidence is missing: business-monetisation.md:345 requires versioned pre-access consent and durable confirmation, while subscription authorization request/context/repository and transaction routes carry no equivalent terms/acknowledgement evidence. One-time payment consent is a separate path and does not cover memberships/platform subscriptions. Fix with the existing legal-policy/receipt authorities, per-product counsel-approved classification, and exact version/request hash; do not assume wallet approval is legal consent. Keep subscription sales disabled until implemented and proven.

- Subscription authorization verifies current account owner/mint and delegation fields but `decodeTokenAccount` exposes only mint/owner, never token delegate/allowance; delegation start/authority init binding/funding state are not checked (`subscription-verifier.ts:79` onward). First access waits for collection, so this is an incomplete readiness proof/recovery gap, not free access from authorization alone.
- Collection reconciliation (`subscription-collections.ts:362`) checks only any program invocation + collection memo + collector fee payer. It does not decode expected transfer instruction amounts, recipients, mint, authority or emitted events. Latest25 signature scan is not durable absence proof under traffic/history truncation. Persist signed transaction signature/message/expiry before send, reconcile that exact signature and exact money facts, and fail closed when history is uncertain. Dedicated staging proof only verifies generic program invocation, split arithmetic in DB, and state; it does not independently prove on-chain recipient splits or renewal/revoke/rotation/failure journeys.
- Recurring delegation authorizes collector spending within a period budget; it is not a merchant-receiver-bound guarantee. Explain user revocation and collector signer blast radius honestly; never claim the server cannot redirect delegated funds merely because wallet keys stay user-owned. Prefer official bounded primitive appropriate to accepted terms; avoid a custom program.
- Runtime support creation validates amount/product but not currency enum, UUID target, or referral token bounds before SQL; malformed authenticated inputs can become500 SQL errors. Reuse real runtime contract schemas and consistent400 response, rather than parallel handwritten validators.
- Email fetch has no explicit timeout or per-delivery catch; transient thrown network error aborts the current batch and leaves leases to expire. Ensure bounded provider calls and independent outcome persistence; do not conceal failures as sent.
- Referral token creation read-existing/insert CTE has no ON CONFLICT recovery; concurrent samekey requests can hit uniqueness failure instead of replay. Cover with realDB concurrency rather than mock-only unit proof. Exact effect depends on the schema's unique key; confirm while implementing.
- Shared profile/age/wallet readiness checks are duplicated across payment/referral/subscription route utilities. Converge on existing canonical access capability policy; do not create a second age/auth source.

## Primary provider guidance verified during review

- Solana payment verification: https://solana.com/docs/payments/accept-payments/verification-tools — server-side RPC, confirmed/finalized commitment, exact mint/program, signature deduplication; search citation `turn12search0`.
- Solana RPC production guidance: https://solana.com/docs/payments/interacting-with-solana — private production RPC, fresh blockhash, status/history queries; `turn12search1`.
- Subscriptions overview: https://solana.com/docs/payments/subscriptions/overview — canonical program ID, authority/delegation models, emitted transfer events; `turn12search4`.
- Recurring delegation: https://solana.com/docs/payments/subscriptions/recurring-delegation — delegatee signs transfers, nonce-based PDA, fixed budget/period/expiry, user revoke; `turn12search5`.
- Official source: https://github.com/solana-foundation/subscriptions; `turn12search7`.
- Token2022 transfer-fee behavior: https://solana.com/docs/tokens/extensions/transfer-fees — credited amount can differ from nominal transfer, so do not advertise arbitrary supported mints without extension-aware exact recipient proof; `turn12search6`.

Current upstream guidance is evidence for the next implementation pass, not proof deployed credentials/provider contracts are approved. Recurring production remains intentionally disabled; maintain that state until fixes and exact release-bound devnet/provider proof pass.
