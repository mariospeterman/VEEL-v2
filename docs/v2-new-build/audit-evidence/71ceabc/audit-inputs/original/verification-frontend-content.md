# Independent frontend/content verification — 4 November 2026

Source: `mariospeterman/VEEL-v2` at `71ceabcfaa8a5258e1b935a391ff4e6e7330c682`. No application source, remote service, provider account or database was changed. Read-only comparison used `wevid-complete`; compiled repository reproduction used the matching `wevid-audit` build at the same SHA.

This is an independent validation of the prior full audit, not a new assertion that this reviewer reread all 1,069 paths. The existing aggregate coverage manifest remains the source for the original review. This pass reread 29 complete runtime files listed below, both frontend/content reports, and the complete 175-line Codex instruction. Browser/provider E2E was not executed.

## Findings confirmed

- FE-01/02: `message-composer.tsx` has an origin-global plaintext offline queue, no actor identity, automatic conversation-only replay and destructive handling of any replay failure while `navigator.onLine` stays true. Logout clears a cookie, not that queue. A sender and recipient sharing a browser can expose and resubmit the sender's queued body as the recipient.
- FE-03/04/05: both server page and workspace substitute the first conversation, defeating mobile Back; composer/reply/read-operation state is reused across conversations. These are independent failures within the same interaction path.
- FE-06: confirmation destination accepts `/\\host`; resolution is external and the failure branch preserves that external origin. Notification navigation uses the same weak leading-slash rule, supporting the instruction's shared destination contract.
- FE-07/08: Moment children are not keyed when content identity changes; comments, polls and carousel state initialize once. Global arrows intercept textarea movement. The instruction includes both state ownership and shortcut repair.
- FE-09: saved composition cannot hydrate its media assets/session identities, and TUS uses the first previous upload without actor/draft/asset scoping. The instruction correctly requires server-owned resumable composition state.
- FE-10/11/21/25: mainnet defaults to devnet RPC; direct purchase bridge is external-wallet-only and becomes nonretryable for the same intent after rejection; Follow resets to original props when pending ends; confirmed checkout has no entitlement/media refresh callback. The instruction explicitly covers these failures.
- FE-12: Realtime invalidates notifications, but the notification list owns only initial local state and has no query observer. Query invalidation alone cannot update that list.
- CONTENT-01/02/03/19: upload-owned lookup excludes ready media; normal video initialization ignores durable idempotency; Bunny receipt/event writes are separate; image-object storage has no authorized URL projection consumed by image rendering. None is cured by adding keys.
- CONTENT-04/05/13: replayed toggle receipts still feed mutation; discovery has a competing raw playback mapper and does not invoke canonical signing; paid-event chat accepts an active membership without checking members-included policy. The instruction addresses each authority divergence.

The reduced PGlite script `content-runtime-proof.mjs` was rerun successfully. It demonstrates PostgreSQL INSERT/UPDATE CTE snapshot behavior, A/B/A toggle reversal, missing Mutuals column, invalid timestamp-to-UUID cast, and lookahead pagination omission. These are reduced query-mechanics proofs, not full production repositories or provider E2E.

## Additional affected behavior: CONTENT-01 carousel upload lifecycle

`content-media-repository.ts:774–790` permits only `draft`/`processing` through `findOwnedContentForUpload`. Provider synchronization at `:903–910` sets the entire content ready when one asset becomes playable. The browser uploads assets sequentially and syncs each video before starting the next (`image-composer.tsx:200–249`). Consequently a first playable video can prevent the second carousel asset from receiving upload authorization; adding an asset to an already-ready unpublished composition is also rejected. The existing report describes the publication failure but should include this affected composition path.

Executed proof: `verification-frontend-content-proof.mjs` invokes the actual compiled repository lookup against a reduced PGlite schema. It finds the processing carousel, then returns null for the same owned carousel after changing its state to ready. The state transition is supplied by the fixture and traced to production sync code; this is not the full sync/upload route.

Suggested repair-instruction addition: “Authorize draft composition mutation by canonical publish/ownership/revision state, separately from provider processing state. Preserve upload/resume/add/remove behavior after any existing asset becomes ready. Test a mixed carousel and two videos where asset one is ready before asset two is provisioned, plus adding to a ready unpublished composition.”

## Additional queue defect: distinct identical offline messages collapse

`message-composer.tsx:106` chooses a key from only the serialized request. Both offline branches at `:114–119` and `:134–139` queue and clear the composer without resetting `messageAttempt`. `clearComposer` at `:149–154` also does not reset it. `idempotencyKeyForRequest` at `:226–238` therefore reuses the first key when the user deliberately enters and sends the same message again. `enqueue` at `:271–275` deduplicates by key, retaining one durable entry despite two optimistic messages. Replay success also does not clear the current messageAttempt, so a later intentional identical send can reuse the old operation identity.

Executed proof: the exact TypeScript helper functions were transpiled and run in an isolated VM with fake localStorage. Two intentional identical compositions generated one key and persisted one queue entry. React/browser behavior was traced statically. This is a separate logical-operation identity issue, suitably an FE-02 extension or FE-26; it must not be represented as a confirmed live-browser test.

Suggested repair-instruction addition: “Keep one stable idempotency key per logical send attempt and all its retries, then retire that composer attempt once its message is durably queued or confirmed. A later deliberate identical message must receive a new key. Include actor/conversation in attempt identity, avoid optimistic ID collisions, and prove two identical offline sends both arrive exactly once.”

## Instruction assessment

The existing Codex instruction is concrete and covers the high-impact reviewed failures, provider-first boundaries, current-state preservation, single-domain authorities, honest gates and substantive tests. It appropriately avoids promising decentralized custody or legal exemption from managed storage and distinguishes wallet approval from settled access. No broad rewrite, new wallet SDK, custom media pipeline or new commerce engine is warranted by this review. Incorporate the two explicit regressions above so a narrow “publish ready lookup” or “retain failed queue item” fix cannot leave the adjacent path broken.

## Complete runtime files reread in this pass

Paths are relative to `wevid-complete`:

1. `apps/web/src/realtime-provider.tsx`
2. `apps/web/src/query-provider.tsx`
3. `apps/web/app/app/app-providers.tsx`
4. `apps/web/app/messages/messages-workspace.tsx`
5. `apps/web/app/messages/message-composer.tsx`
6. `apps/web/app/messages/conversation-state-actions.tsx`
7. `apps/web/app/app/messages/page.tsx`
8. `apps/web/app/app/profile/profile-logout-button.tsx`
9. `apps/web/app/auth/logout/route.ts`
10. `apps/web/app/app/moments/moment-viewer.tsx`
11. `apps/web/app/content/content-renderer.tsx`
12. `apps/web/app/content/[contentId]/content-engagement-panel.tsx`
13. `apps/web/app/create/image-composer.tsx`
14. `apps/web/src/payment-handoff-panel.tsx`
15. `apps/web/app/follow-button.tsx`
16. `apps/web/app/profile/[handle]/profile-follow-panel.tsx`
17. `apps/web/src/wallet/embedded-wallet-providers.tsx`
18. `apps/web/src/payment-wallet-bridge.tsx`
19. `apps/web/app/auth/confirm/route.ts`
20. `apps/web/app/app/notifications/notification-list.tsx`
21. `apps/api/src/modules/content/content-publish-repository.ts`
22. `apps/api/src/modules/content/content-repository-mappers.ts`
23. `apps/api/src/modules/content/media-upload-adapter.ts`
24. `apps/api/src/modules/content/content-media-repository.ts`
25. `apps/api/src/modules/content/content-route-shared.ts`
26. `apps/api/src/modules/discover/discover-repository-mappers.ts`
27. `apps/api/src/modules/discover/discover-routes.ts`
28. `apps/api/src/modules/engagement/engagement-content-actions-repository.ts`
29. `apps/api/src/modules/live/live-chat-repository.ts`

Partial supporting read: `apps/api/src/modules/content/content-upload-routes.ts:1–390`; it is not counted as a complete reread. Complete report/instruction and proof-source reads are separate from runtime coverage. Other original findings were not all independently revalidated in this pass.
