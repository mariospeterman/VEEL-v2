# WeVid frontend audit — 71ceabc

Read-only review of `mariospeterman/VEEL-v2` at `71ceabcfaa8a5258e1b935a391ff4e6e7330c682`. Scope: `apps/web`, `packages/ui`, `tests/smoke`, `tests/staging`. Runtime source is at `/workspace/scratch/0635fbdaf32f/wevid-audit`. This report does not assert that the local Mac worktree's uncommitted changes were inspected. Coverage is recorded separately; unreviewed files and binary visual assets must not be represented as fully audited. Static findings below are distinguished from provider/live-browser validation still required. Parent is running the test/build baseline.

## Confirmed defects

### FE-01 — P1: Offline private messages survive logout and can send as another account

Evidence: `apps/web/app/messages/message-composer.tsx:30` defines one origin-wide `wevid:message-offline-queue:v1` localStorage key. Queued entries contain conversation/request/idempotency information but no canonical actor. Lines 47–83 hydrate and automatically flush by conversation ID alone; line 53 submits using the current actor's API session. Lines 258–278 read/write plaintext durable storage. `apps/web/app/app/profile/profile-logout-button.tsx:63` clears the E2E cookie only, not this queue.

Reproduction: account A queues a message while offline, logs out, and account B signs in on the same browser. If B opens a conversation also accessible to B (for example the other participant of A's conversation), A's private queued body appears and can be auto-submitted as B. All queued plaintext also remains available to later same-origin sessions until removed. Server authorization of B's conversation access cannot detect the wrong draft author.

Fix: remove the durable offline queue until its privacy and retention contract is explicit, or scope every entry to canonical actor + session + conversation, enforce actor before display/send, clear account-private storage on logout/switch, and present explicit failed/queued message status. Add an A→logout→B offline replay regression test.

### FE-02 — P2: Online transient failure silently deletes queued messages

Evidence: `message-composer.tsx:61–67` catches any replay failure; if `navigator.onLine` remains true, it removes the durable queued entry and optimistic message. `navigator.onLine` does not distinguish an API timeout, 429, 503 or server connectivity failure. The flush path gives no durable failure/retry UI.

Reproduction: queue offline; restore browser connectivity while message POST returns 503. Message is removed without confirmation. Fix: retain retryable failures with bounded backoff and visible retry/cancel controls; remove only after confirmed success or explicit cancellation/permanent failure handling. Keep the idempotency key across retries.

### FE-03 — P2: Mobile Messages Back cannot reach the inbox

Evidence: `apps/web/app/messages/messages-workspace.tsx:32–34` falls back to the first conversation whenever the URL has no selected ID. Line 69 hides the conversation list below `lg` whenever `selected` exists. Line 99's Back button calls `selectConversation(null)`, removing the URL selection but immediately selecting the first conversation again. `app/app/messages/page.tsx` also substitutes the first conversation server-side, so both defaults need a coordinated fix.

Result: any nonempty mobile inbox opens the first thread and never exposes the list or another conversation. Fix: represent unselected explicitly on mobile; a missing selection should show the list. If desired, choose a default only in the desktop split view. Test opening inbox, Back, and selecting a second thread at phone sizes.

### FE-04 — P2: Conversation changes retain draft, attachment and reply state

Evidence: `messages-workspace.tsx:26` owns `replyTo` independent of conversation; line 118 reuses `MessageComposer` without a conversation key/reset. `message-composer.tsx:35–44` owns body, attachment IDs, shared content and retry state initialized once.

Result: switching threads after composing/replying carries a prior recipient's draft into another conversation; a later Send targets the new conversation. A previous reply ID can also be submitted with the wrong conversation. Fix: scope draft and reply state by conversation ID, key stateful children or explicitly reset the entire state machine, and ensure pending async completion cannot clear or overwrite another conversation's draft. Verify desktop thread switching, request acceptance, and fast navigation during send.

### FE-05 — P2: Read receipts stop after the first successful mark-read

Evidence: `apps/web/app/messages/conversation-state-actions.tsx:24` creates `readStarted` once. The effect at 32–37 sets it true and resets it only on rejection. Reusing the component for another conversation/new unread messages leaves it true forever.

Fix: track canonical conversation and last-visible/read message identity, or let a query mutation/state machine represent each read operation; reset when a new unread range is visible. Test multiple threads and new messages arriving in an already open thread.

### FE-06 — P2 security: Authentication confirmation allows an external redirect

Evidence: `apps/web/app/auth/confirm/route.ts:21–22` feeds `safeNextPath` into `new URL(next, requestUrl.origin)`. Its validator at 58–59 accepts any leading `/` excluding only `//`. The standard URL parser normalizes backslashes: `next = '/\\evil.example'` passes this validator, while `new URL(next, 'https://wevid.example').href` is `https://evil.example/`. The no-code failure branch preserves the external URL origin while replacing pathname/search, so a valid auth code is not needed to exercise the redirect.

Reproduction: request `/auth/confirm?next=%2F%5Cevil.example`. Native Node URL behavior was checked directly. Related prefix-only helpers exist in landing continuation, Supabase recovery redirect, notifications and service worker navigation; review all through one shared destination contract.

Fix: resolve against a trusted origin and assert exact resulting origin, reject backslash/control characters and credentials, allow only intended internal routes, and construct auth error destinations from the trusted origin. Add encoded slash/backslash and mixed-form tests. Coordinate with the auth audit to avoid duplicate reporting.

### FE-07 — P2: Moving between Moments carries state from a different content item

Evidence: `apps/web/app/app/moments/moment-viewer.tsx:93,99` renders `ContentRenderer` and `ContentEngagementPanel` without a key while `item.id` changes. `apps/web/app/content/[contentId]/content-engagement-panel.tsx:50–61` initializes likes, comments, comment draft, reply, report, hidden/blocked state once and never resets on content ID. `content-renderer.tsx:54` similarly retains carousel index; lines 167–169 retain the previous poll state.

Reproduction: open comments on moment A, enter a draft, then move to B. A's comments/draft/likes remain under B while actions use B's content ID. Two polls similarly display old options/state and a carousel can retain an out-of-range slide.

Fix: key all content-specific state by canonical content ID (and revision where appropriate), or move it into actor/content-keyed query state. Ensure pending responses cannot mutate the next item. Cover two moments with distinct likes/comments/polls/carousel lengths.

### FE-08 — P2 accessibility/data-entry: Moment arrow shortcuts intercept text editing

Evidence: `moment-viewer.tsx:53–61` listens on `window`, prevents every ArrowLeft/ArrowRight event and moves content without checking the event target, editable state, modifiers, or whether the viewer owns focus.

Result: using cursor arrows inside a comment textarea switches posts, aggravating FE-07 and making basic editing unreliable. Fix: limit shortcuts to the media viewer/focused controls, ignore input/textarea/select/contenteditable/composition and modified events, and leave native text navigation intact.

### FE-09 — P2: Media draft restoration cannot restore the uploaded composition

Evidence: `apps/web/app/create/image-composer.tsx:56` starts with `assets=[]`; restore at 91–118 loads metadata and draft ID only, then calls `getContentForMutation(...).then(setDraft)` at 115. It never hydrates local asset records, upload sessions or transfer state from returned media assets. Persistence at 123–133 does not save those identities. Reselecting a file creates fresh local IDs and falls through to new upload initiation. TUS resume at 479–480 selects `previousUploads[0]` without actor/draft/media-asset scoping.

Result: reload during/after upload gives a backend draft with no usable asset controls/recovery path. Reselection may create duplicate assets and can pair a new upload session with an old resumable URL. Initial restore/persist effects also rewrite storage before asynchronous draft restoration finishes. The content audit separately confirms normal upload idempotency is not persisted server-side and ready content is excluded from upload/publish lookup; those backend findings make this path fail even more directly.

Fix: implement one backend-owned resumable composition snapshot and stable idempotent upload-attempt identity, hydrate ordered assets/status on load, safely reattach selected local files, scope resumable fingerprints to actor/draft/asset/provider object, expire sensitive provider URLs, and avoid persistence before restoration completes. Test interruption before POST response, mid-transfer, after transfer and after provider-ready webhook.

### FE-10 — P2 configuration: Embedded mainnet RPC silently resolves to devnet

Evidence: `apps/web/src/wallet/embedded-wallet-providers.tsx:15–17` takes the selected chain but defaults the RPC to `https://api.devnet.solana.com`; lines 37–38 register this endpoint under whatever `solanaChain` is. `packages/config/src/public.ts` accepts `solana:mainnet` with no RPC URL and does not enforce a matching endpoint. External Wallet Adapter separately resolves its network.

Reproduction: set `NEXT_PUBLIC_SOLANA_CHAIN=solana:mainnet`, omit optional RPC URL. Embedded wallet operations are configured under mainnet with devnet transport. Fix: one chain-aware provider transport resolver or required explicit matching RPC configuration, and startup validation of selected network/genesis. Verify both wallet families against the same network.

### FE-11 — P2 feature gap: A freshly loaded checkout cannot directly use the login wallet

Evidence: `apps/web/src/payment-wallet-bridge.tsx:24–28` only uses external Wallet Adapter `publicKey` and returns silently if absent; the checkout has no connection chooser. `src/wallet/solana-wallet-provider.tsx:21` sets `autoConnect={false}`. Landing auth uses full navigation and therefore remounts the provider. Embedded Privy signing is used for auth but checkout has no Privy transaction-signing path. Subscription authorization has a separate external connection path.

Impact: normal fresh page sessions fall back to QR/deep link even when the user just authenticated with an embedded wallet; the requested one-click familiar in-app flow is not implemented. QR/deep link remains an available external path, so this is not a claim that every payment fails. `payment-wallet-bridge.tsx:30` also marks an intent started before approval and never clears it on rejection, preventing another direct attempt for that intent.

Fix: reuse official provider transaction hooks behind one capability-aware operation interface for connected external and embedded wallets, expose explicit connect/reconnect/retry states, retain backend quote/consent/verification authority and no custody. Validate actual Privy/external transactions in devnet; static mocks do not establish wallet interoperability.

### FE-12 — P2: Realtime notification invalidation has no consumer

Evidence: `apps/web/src/realtime-provider.tsx:95` and 233 invalidate `['notifications']`. `app/app/notifications/page.tsx:10` fetches on the server and renders `NotificationList(initialItems)`; `notification-list.tsx:11` copies props into local useState. There is no notification query observer, realtime callback to update items, or router refresh.

Result: newly delivered notifications do not appear while the inbox is open, despite successful broadcast. Even refreshed server props can be ignored by the retained local state. Fix: one actor-keyed query owns the list, with server hydration and targeted invalidation; alternatively explicit refresh and synchronization. Test an initially empty inbox receiving a notification, read actions, reconnect and account switch.

### FE-13 — P2: Search is unavailable from the mobile app shell

Evidence: `apps/web/app/styles/responsive.css:38–40` hides `.top-search` at <=1023px. `app/app-shell.tsx:58` provides the sole shell Search link in that element. Shared `packages/ui/src/index.ts` defines only Home/Bits/Create/Messages/Profile as primary navigation; no mobile search alternative appears in the home page or profile menu. At <=640 all `.top-action` links are also hidden (128–130), leaving no direct notification/wallet entry there.

Fix: provide a labelled mobile Search icon/entry and ensure notifications/wallet remain reachable through an intentional account menu or mobile action surface. Check the entire navigation graph at phone/tablet widths instead of only horizontal overflow.

### FE-14 — P2: Profile shows only the first page of posts and misleading counts/tabs

Evidence: `app/app/profile/page.tsx:12,17` fetches one `getMyContent` page and computes post count from only that page; `profile-media-grid.tsx:4–24` renders this page and never consumes `nextCursor`. The profile Bits and Moments tabs at 23–24 link to global feeds, not this creator's content, and followers/following at 64 display em dashes rather than canonical counts.

Result: creators with more than one page cannot see older posts in their profile and counts understate their content. A profile tab unexpectedly switches to other creators' global feed. Fix: canonical total counts plus cursor pagination and creator-scoped media tabs; intentional unavailable fields should not masquerade as implemented social features.

### FE-15 — P2 scalability: Feed grows an unbounded component/DOM tree

Evidence: `apps/web/app/app/feed-experience.tsx:288` maps all accumulated page items; `mergeItems` at 399–401 appends permanently. Every item retains engagement and media component state. Active-media gating helps playback but does not cap the DOM or state.

Result: prolonged browsing keeps growing memory/layout/observers, particularly costly on mobile. Inactive videos without a poster can still fall through to a playback renderer. Fix: bounded window/virtualization with stable scroll restoration and cache ownership, defer offscreen embeds, cap poster prefetch, and test a long session under constrained devices. Coordinate with the content audit's separate cursor/full-corpus ranking problem. Frontend handles any cursor 409 by replacing the entire feed (`:68–72`), which makes frequent backend cursor invalidation visibly jump/reset browsing.

### FE-16 — P2 accessibility: Theme tokens create very low contrast in app controls

Evidence: dark theme `app/styles/tokens-base.css:25–26` uses `--accent-strong:#031f18` with translucent green `--accent-soft` over a nearly black panel. This pair is used for state pills/review messages in `app/app/profile/profile-media-workspace.tsx:150,201,286` and various feed actions. `app/app/settings/content-preference-control.tsx` uses white text on bright `--accent:#14f195`. These foreground/background combinations are visibly and mathematically low-contrast; existing authenticated Axe coverage should be expanded to both themes and selected/error/transient states; its current smoke fixtures do not activate all of these token combinations.

Fix: explicit semantic on-accent/on-accent-soft tokens per theme, apply contrast-safe text across state/action surfaces, and run Axe plus keyboard checks on every authenticated workflow in both themes.

### FE-17 — P2 privacy: Recent searches persist across different accounts

Evidence: `app/app/search/search-experience.tsx` stores query history under a global `wevid:search:recent` localStorage key with no actor identity, retention, user clear control, or logout cleanup. See FE-01 logout path.

Result: another person signing in on the same browser sees previous account searches, sensitive for an adult-content platform. Fix: actor-scope only if retention is intentional, implement clear/expiry/logout behavior, or keep recent searches in memory. Inventory all persisted private client state in one documented policy.

## Confirmed implementation gaps and static concerns requiring browser confirmation

### FE-18 — P2 operational gap: Generic admin pages truncate operational data and omit critical actions

Evidence: `app/admin/[section]/page.tsx:159` permanently displays at most 25 records and line 164 at most six primitive fields per record. There is no cursor pagination, filtering, detail view or typed actions for the generic content/safety/live/provider/privacy sections. Only selected payment policy, feature flags, analytics and staff operations have dedicated mutations. Organization view selects the first organization instead of exposing selection.

Impact: the existing generic renderer is an inspection scaffold, not an end-to-end operations console. Backend moderation/replay/data-request workflows must be mapped to permission-checked controls or explicitly described as operator CLI-only. Fix: typed section workspaces with exact RBAC, audited reason-required actions, cursor paging, details and safe loading/error states; reuse backend contracts instead of parallel admin business logic.

### FE-19 — P2 static concern: Admin content has no apparent vertical scroll owner

Evidence: `app/styles/tokens-base.css:63–68` sets html/body `height:100%;overflow:hidden`. `app/admin/admin-shell.tsx:56–85` uses growing min-height containers without bounded height or vertical overflow. This differs from the app's explicit scroll panes. Long staff/settings/data tables can extend below a clipped viewport.

Status: CSS/structure confirmed; not yet verified in a rendered authenticated admin session. Inspect computed layout and keyboard scroll at 360×640 and desktop before accepting the finding. Fix should establish one accessible vertical scroll owner while preserving sticky navigation and horizontal mobile nav.

### FE-20 — P1 monetary presentation: Subscription cents and atomic amounts are formatted inconsistently

Evidence: `apps/web/app/app/subscriptions/page.tsx:135` passes `plan.amountMinor` to `formatAssetAmount`; line 170 does the same for `tier.monthlyPriceMinor`. Those subscription fields are USDC cents, as confirmed by `apps/api/src/modules/subscription/subscription-routes.ts:149` converting them with `10 ** max(0, PAYMENT_USDC_DECIMALS - 2)` into atomic transaction amounts. `apps/web/src/format-asset-amount.ts:5` divides USDC by 1,000,000. Thus a 500-cent $5 plan displays `0.0005 USDC`, 10,000 times below its actual price. Conversely `app/messages/commercial-interactions-panel.tsx:59,87` prints atomic SOL offer/request amounts directly followed by `SOL`, so a one-SOL offer displays `1000000000 SOL`. Its forms at 132,171,193 ask consumers for atomic amounts rather than human units.

Fix: introduce explicit typed money units at contract boundaries, format subscription cents and token atomic values through distinct functions, and use exact decimal-string parsing for consumer amount input. Reuse the canonical quote review; keep its displayed amounts consistent with browsing/offer/plan prices. Add semantic tests with 500 cents→5 USDC and 1,000,000,000 lamports→1 SOL. Payment audit separately covers email amount formatting.

### FE-21 — P2: Profile Follow button reverts after a successful mutation

Evidence: `app/follow-button.tsx:22–30` runs `setState(initialState)` whenever `pending` becomes false, including after success at 46 and finally at 51. `app/profile/[handle]/profile-follow-panel.tsx:15` always passes the original `initialState` into the button; its onChange only updates the parent's displayed counts.

Result: Follow succeeds server-side and counts update, but the button returns to Follow and `aria-pressed=false`; subsequent clicks repeat the same action instead of allowing Unfollow. Fix: choose one owner for follow state; synchronize only when identity/server revision changes, not when local pending ends, and have the parent pass its current state if controlled. Cover follow then unfollow without reload.

### FE-22 — P2 missing workflows: Profile Edit and Mutuals privacy controls are read-only destinations

Evidence: `app/app/profile/page.tsx` labels a link `Edit profile` but its target `/app/settings#profile` renders `ProfileFacts` (`app/app/settings/page.tsx:154–168`) only. The sole `updateMyProfile` consumer is landing onboarding, despite the existing mutation API. The Privacy link `Manage Mutuals privacy` in `privacy-controls.tsx:87` targets `/mutuals`, which only lists IDs/states with no opt-in/visibility controls or even a conversation link (`app/mutuals/page.tsx:38–55`). No current web settings consumer implements Mutuals preference mutation.

Fix: implement validated accessible profile/avatar editing using existing APIs, and a real canonical Mutuals opt-in/privacy surface with explicit consent, backend eligibility and exit controls. If a feature is not yet available, make the control honestly describe the available view instead of advertising an action it cannot perform.

### FE-23 — P2 docs conflict: Multiple accepted frontend authorities prescribe incompatible implementations

Full-read evidence: `docs/v2-new-build/frontend-architecture.md`, `native-ui-ux-screens.md`, `landing-page.md`, `frontend/{component-map,copy-system,design-system,motion-system,ui-kit-lock}.md`, `product/consumer-social-experience.md`, plus `apps/web/public/mockup/design.md` and app/shared-UI READMEs.

- `mockup/design.md` prescribes a GSAP-style video-frame landing, Start onboarding + Login CTAs, KYC-gated Create and assistant publishing confirmation. The accepted landing/consumer/provider boundaries require semantic poster-first one-Continue landing, SFW posting without earnings KYC, and assistants unable to publish. Its `/app/media/:id` and `/app/event/:id` routes do not match canonical `/content/[id]` and `/event-access/[id]`.
- `frontend/motion-system.md` still says desktop landing moves horizontally between panels; `landing-page.md` forbids scroll-jacking/hidden frames.
- `frontend/copy-system.md` recommends Passkey-first, `Skip for now`, and an approved tier list omitting Ultra; the current wallet-first lifecycle has no skip-wallet path and five tiers including Ultra.
- `frontend/ui-kit-lock.md` says auth is a modal over landing, while the current auth surface is a full page and landing smoke explicitly asserts no dialog. It allows hiding all secondary mobile actions without defining replacements, causing FE-13.
- `frontend/component-map.md` says Bits owns search/discovery, while current search is `/app/search`; it describes old missing route-local panel names. Architecture implementation claims include stable cursors, notification/server projection invalidation and active-only playback that the code review does not substantiate.
- `frontend/design-system.md` specifies a shared `Sheet`/`CheckoutSheet`/Select/Checkbox/SegmentedControl path that is absent. Existing Button/ButtonLink/Input primitives do exist in `packages/ui`, but many routes duplicate native styled controls; `app/ui.tsx` does not reexport Button/ButtonLink despite the documented import path. Reuse the existing useful primitives; do not create a second kit.
- `apps/web/README.md` still says not to scaffold until foundation approval despite the implemented application.

Fix: one concise current route/component/provider/state ownership map with links to narrower authorities; mark superseded plans explicitly, delete obsolete claims/paths and contradictory instructions, and distinguish implemented/tested/gated work. Preserve visual references but separate historical mockup notes from executable implementation rules. The docs owner received these findings.

Official references checked for this review: Privy React Solana transaction signing (`https://docs.privy.io/wallets/using-wallets/solana/send-a-transaction`) exposes provider `useSignAndSendTransaction`/`useWallets` and matching network RPC; TanStack v5 query invalidation (`https://tanstack.com/query/latest/docs/framework/react/guides/query-invalidation`) requires a query observer for background refetch. Neither requires a new custom signing or realtime truth system.

### FE-24 — P2: Creator-profile membership Connect wallet has no provider context

Evidence: `apps/web/app/profile/[handle]/page.tsx` directly renders `SubscriptionAuthorizationPanel` when a membership offer exists. This contextual route is outside `app/app/layout.tsx`, the only persistent app wallet provider boundary. `app/subscriptions/subscription-authorization-panel.tsx:17–19` uses Wallet Adapter connection/wallet/modal hooks without supplying a local runtime boundary. Root layout intentionally has no wallet providers. Installed `@solana/wallet-adapter-react` default context logs a missing-provider error and returns null publicKey; the default modal context `setVisible` only logs an error.

Result: the creator's membership CTA cannot open a wallet chooser or join when the offer is launch-approved. Coming-soon gates conceal the defect until providers are enabled. It does not crash by throwing in the currently installed SDK; it is an inert action with console errors. Fix: mount the approved lazy wallet boundary around the actionable profile membership panel or navigate to the existing scoped authenticated checkout without duplicating provider instances. Test from a direct creator URL, fresh browser and already-authenticated app navigation.

### FE-25 — P1 core conversion: Confirmed payment leaves locked content/live projections unchanged

Evidence: `apps/web/src/payment-handoff-panel.tsx:69–73` handles backend confirmation with local `setState('confirmed')` and a message only. There is no onConfirmed callback, router refresh, or canonical entitlement-query invalidation. `app/content/[contentId]/page.tsx` and `app/live/[liveRoomId]/page.tsx` supply server-fetched locked playback/access props and do not subscribe to projection refresh; these contextual routes are outside AppProviders. `content-unlock-panel.tsx:34` nevertheless says confirmed access will appear automatically. Paid live uses the same panel and stale server props.

Reproduction: open a locked post, finish a valid payment while keeping the page open, allow getPaymentIntent to return confirmed. The checkout displays confirmed copy but the media stage still renders the original locked resource until manually reloaded. Fix: after verified payment, refresh the canonical backend content/live/pass/commercial projection through the owning query or server route, keep an explicit awaiting-entitlement state for asynchronous settlement application, and handle delayed/revoked/expired access safely. Test wallet submission→verified settlement→usable media on the same screen, including existing unlock and free/approval-required event outcomes; never grant access from wallet approval alone.

The mocked smoke suites exercise many useful contracts but replace the real API/providers and do not prove provider sandbox success, uploads/webhooks, actual wallet approval/network correctness, age/session revocation, production data pagination, cross-account isolation, or accessible authenticated layouts. Staging platform tests only cover the public landing, health/readiness, and optional protected shell with a provided session cookie. A passing suite must not be presented as end-to-end launch readiness.

Still required: real sandbox matrix for external/embedded wallet sign-in, recovery and account switching; age expiry/revocation; phone/tablet/keyboard inbox; actual media interruptions + provider events; devnet checkout rejection/retry/expiry; realtime reconnect; operational admin actions; long-feed memory; CSP and error redaction; all routes and all source not yet fully read according to coverage. Binary mockups have metadata-only coverage; no claim of visual comparison to each supplied design.
