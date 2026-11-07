# Supplemental money-code review

Reviewed 4 November 2026 against `mariospeterman/VEEL-v2@71ceabcfaa8a5258e1b935a391ff4e6e7330c682` in `wevid-complete`. Application source was not modified. This is an independent complete-text review of the specific files listed below, not a second whole-repository coverage claim. No tests, live provider calls, blockchain transactions or production mutations were executed by this reviewer.

## Result

The existing payment audit and repair instruction are materially supported by the assigned code. No additional independently confirmed critical defect was found in this bounded secondary scope.

- **PAY-06 remains valid.** The webhook route relies on `recordSolanaProviderEvent` returning true before it processes the event; dedicated evidence-repository tests exercise match-query shape and provider aliases, not atomic receipt/event persistence or fault recovery. Thus passing these tests does not refute the crash window identified by the main reviewer.
- **PAY-10 remains valid.** One-time `payment-durable-confirmation.ts` explicitly writes receipts, receipt lines, compliance settlement entries, notifications and in-app/email delivery records. This supports using those established financial authorities for recurring outcomes instead of another competing ledger. This reviewer did not independently inspect every recurring SQL trigger, so the absence-of-trigger result remains the database reviewer's evidence.
- **PAY-13 remains valid at the contract boundary.** `RecordPaymentSubmissionInput` has signature and settlement facts but no command idempotency key/hash. `payment-submission.test.ts` proves one optimistic write-guard branch through a mocked transaction and does not prove stable command replay after a completed operation.
- **PAY-16 remains valid.** `payment-content-unlock-routes.ts` passes offer currency but no `tokenMint` or `tokenDecimals` to `createOrReuseIntent`, so merely removing a SOL-only upstream selector would leave incomplete USDC intent facts. The content selector itself is outside this review's source scope.
- **Money test limits are real.** `payment-solana.test.ts` covers distinct-recipient split examples, exact amounts, expiry, reference/memo, USDC transfer construction and safe integer limits. It has no shared-recipient multiset case, which explains why PAY-01 can survive. `subscription-verifier.test.ts` only tests local configuration/fact rejection; it never proves the positive RPC/account-decoding path. `subscription-authorization-transaction.test.ts` proves one mocked-RPC build with nonce zero but not multiple memberships, transaction refresh, old-setup recovery or exact on-chain outcomes.
- **Thin domain orchestration is still necessary.** Settlement helpers intentionally bind accepted creator requests/media offers to conversation and content safety and put ineligible paid results into remediation. Keep those policies when repairing provider integrations; deleting them in the name of provider-first would remove product authorization.

## Narrowing / correction

Receipt URLs `/activity` and `/wallet` are **not currently broken merely because canonical pages live under `/app`**. Complete `apps/web/next.config.ts` review confirms explicit redirects from `/activity` to `/app/activity` and `/wallet` to `/app/wallet`. The existing PAY-09 wording appropriately asks implementers to verify redirects; preserve this narrowing. Updating generated links to canonical destinations is consistency cleanup, not evidence of a failed user journey. The atomic-unit display defect is unaffected.

The hardcoded USD and inferred seller-of-record facts in one-time durable confirmation are already captured by **DM-09**. Do not double-count them as a new payment finding. Likewise, this review does not promote potentially obsolete `event_ticket` compatibility paths into a live defect without demonstrating a surviving supported row.

## Complete text files read

All source paths below are relative to the exact checkout. Imports, helpers and error branches were included. Terminal outputs used bounded complete reads and were not truncated.

1. `apps/api/src/modules/payment/payment-commercial-policy.ts`
2. `apps/api/src/modules/payment/payment-commercial-policy-repository.ts`
3. `apps/api/src/modules/payment/payment-creator-commercial-settlement.ts`
4. `apps/api/src/modules/payment/payment-durable-confirmation.ts`
5. `apps/api/src/modules/payment/payment-entitlement-settlement.ts`
6. `apps/api/src/modules/payment/payment-event-access-pass-settlement.ts`
7. `apps/api/src/modules/payment/payment-paid-message-settlement.ts`
8. `apps/api/src/modules/payment/payment-intent-mapper.ts`
9. `apps/api/src/modules/payment/payment-settlement-ledger.ts`
10. `apps/api/src/modules/payment/payment-settlement-records.ts`
11. `apps/api/src/modules/payment/payment-content-unlock-routes.ts`
12. `apps/api/src/modules/payment/payment-webhook-routes.ts`
13. `apps/api/src/modules/payment/solana-pay-codec.ts`
14. `apps/api/src/modules/payment/types.ts`
15. `apps/api/test/payment-commercial-policy.test.ts`
16. `apps/api/test/payment-creator-commercial-settlement.test.ts`
17. `apps/api/test/payment-evidence-repository.test.ts`
18. `apps/api/test/payment-submission.test.ts`
19. `apps/api/test/solana-pay-codec.test.ts`
20. `apps/api/test/subscription-authorization-transaction.test.ts`
21. `apps/api/test/subscription-verifier.test.ts`
22. `apps/api/test/payment-solana.test.ts`
23. `apps/web/next.config.ts`

Additional references read: complete prior `payments-audit.md`; targeted existing documentation-money findings DM-09/DM-13/DM-15; targeted wallet migration primary-key/index search. Those targeted migration/document reads are not claimed as complete file rereads.
