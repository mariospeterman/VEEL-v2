# Independent auth/verification audit validation — 4 November 2026

Source: `mariospeterman/VEEL-v2` at `71ceabcfaa8a5258e1b935a391ff4e6e7330c682`. Application source was not changed. This is a bounded second review of the existing audit, not a replacement claim that all 94 auth-manifest files were independently reread in this pass. The earlier manifest records 702,887 bytes across 94 files.

## Result

The high-impact existing findings survive the second source trace. In particular, the generic verification writer omits primary normalized age facts and activation, conflates evidence validity with launch expiry, commits unmatched callback receipts permanently, does not serialize provider chronology across subject/purpose, and writes the pending session/record separately. The recovery verifier drops provider authentication/session identity; exchange invents `authenticatedAt = now`, while logout-all only revokes application sessions. MCP code consume and token issuance remain separate nonexclusive database operations. Admin pagination uses the excluded lookahead row, feature lookup reads a truncated list, live-room SQL has ambiguous joined columns, and identity/MCP admin projections read obsolete tables. These are independently source-confirmed; earlier executed evidence retains its original fixture limits.

Two additional distinct defects should be added to the register and execution instruction.

## AUTH-22 — P1/P2 — Sumsub correlation IDs collapse distinct verification events

**Evidence.** `apps/api/src/modules/verification/verification-webhook-adapter.ts:59` and `apps/api/src/modules/age/age-webhook-adapter.ts:78` use `firstStringValue(body.correlationId, body.applicantId)` as `providerEventId`. The former is not a unique event ID; the latter identifies the whole applicant. `verification-repository.ts:159–180` and `age-repository.ts:114–143` insert that value into `verification_events.idempotency_key`, use `ON CONFLICT DO NOTHING`, and return duplicate before decision application. Migration `0069_normalized_verification_domain.sql:109–120` has `UNIQUE(provider,idempotency_key)`.

**Primary source.** Rechecked https://docs.sumsub.com/docs/user-verification-webhooks on 4 November 2026. Its `correlationId` field description explicitly says the identifier is shared across related events from an originating operation. Multiple events may therefore carry one correlation ID. This finding does not depend on assuming an undocumented collision.

**Executed boundary.** `node verification-sumsub-event-proof.mjs` under Node v24.22.1. The actual compiled age and generic webhook normalizers from the hash-matching audit checkout accept separately HMAC-signed `applicantPending` and `applicantReviewed/GREEN` bodies sharing a documented operation correlation ID. They emit different states (`pending` → `valid` / `verified`) but the same receipt key. The exact `verification_events` table DDL was extracted unmodified from migration 0069 and run in PGlite with only a minimal FK target. Inserting these normalized receipts via the production query shape accepts the first and suppresses the second. Output: `verification-sumsub-event-proof.json`. This is signed normalization plus real SQL uniqueness behavior, not a live Sumsub call or whole app/provider end-to-end test.

**Impact.** After applicant mapping is corrected, a valid later approval, denial or lifecycle transition can still be discarded as a duplicate; an account can remain pending or retain stale access. Distinct from AUTH-03 (subject/applicant mapping), AUTH-05 (decision ordering), and AUTH-06 (callback-before-session recovery). The current mapping bug may mask this one; both need repair.

**Repair.** Choose a documented stable delivery/event identity if available; otherwise define a collision-resistant fingerprint of authenticated semantic event/version fields suitable for that provider, preserve the operation correlation ID separately, and reconcile authoritative provider state. Do not merely append event type: repeated same-type decisions also require a distinct logical identity. Preserve exact-retry dedupe without suppressing distinct same-correlation events. Keep the receipt and decision application transactional and replayable as already required by AUTH-06.

**Acceptance.** Signed Pending → GREEN; GREEN → RED; two same-type decisions with one operation correlation ID; exact redelivery; transport retry; and late delivery. Assert every distinct decision is retained, exact retries are idempotent, and final access follows provider-authoritative chronology. Run both age and generic routes against real Postgres. Include a no-correlation-ID case; applicant ID alone is not a safe lifetime event key.

## AUTH-23 — P1 for enabled Sumsub fallback — Generated launch URL never starts verification

**Evidence.** `verification-provider-adapters.ts:135–170` requests an SDK access token and builds `launchUrl = appendQuery(input.callbackUrl,{provider:'sumsub',token})`. `age-provider-waterfall.ts:24–39` forwards that URL. `age-routes.ts:169–174` supplies `/age/callback`; generic verification routes supply profile/create destinations. The actual frontends navigate to the URL with `window.location.assign`: `app/age/age-session-panel.tsx:29`, `app/landing-auth-surface.tsx:382`, `app/app/profile/earnings/earnings-setup-form.tsx:80`, `app/app/create/adult-publisher-gate.tsx:25`, and Enterprise KYB action at `app/app/enterprise/enterprise-relationship-panel.tsx:169`.

The complete `app/age/callback/route.ts` only redirects to landing onboarding with `step=age&verification=return`, drops `provider`/`token`, and never starts a Sumsub session. The age-return effect (`landing-auth-surface.tsx:319–351`) polls application session status. Repository-wide searches across applications, packages, dependencies/lockfile found neither a Sumsub WebSDK initializer/import/CDN bridge nor a Sumsub SDK-token query consumer. This absence supports the full positive caller trace above; it is not a filename-based inference.

The existing mocked KYC route test (`apps/api/test/app.test.ts:1773–1827`) supplies `https://sumsub.example/sdk?...` as an already prepared launch URL, hiding the actual adapter's local callback URL.

**Primary sources.** Rechecked https://docs.sumsub.com/reference/generate-access-token and https://docs.sumsub.com/docs/get-started-with-web-sdk on 4 November 2026. A generated token is an SDK input: the official integration initializes and launches the WebSDK with it, including expiry handling. Returning to an application callback is not that launch.

**Executed boundary.** `node verification-sumsub-launch-proof.mjs` calls the actual compiled adapter with a synthetic fetch response matching the official token response (`token`, `userId`). Result: `https://wevid.example/age/callback?provider=sumsub&token=...`, not a hosted verification page. Output: `verification-sumsub-launch-proof.json`. The browser failure is statically traced, not browser-executed; no provider was contacted.

**Impact.** If Sumsub is configured/selected or reached by fallback, users return directly to pending status without seeing or completing the provider check. This affects age, creator/adult-publisher identity and organization checks that choose this adapter. Default Didit-only paths do not inherit this particular defect.

**Repair.** Either use Sumsub's currently documented hosted verification-link operation and return its true provider launch URL, or integrate the official SDK in a single narrow verified launcher with safe token delivery/refresh and the required camera/CSP/origin policies. Do not invent a hosted URL from an SDK token or leak it into durable analytics/logs/history. If Sumsub is not an accepted launch provider, remove/disable the advertised fallback and mark the adapter unsupported until completed; the task need not install every possible identity SDK.

**Acceptance.** Browser journey with the actual adapter and documented provider boundary: age/KYC/KYB start → provider UI rendered → cancellation/retry/token expiry → signed callback → one consistent normalized decision. A route test accepting an injected launch URL is insufficient.

## Instruction additions

After the current Section 5A Sumsub/Persona bullet add:

> Do not use Sumsub correlationId or applicantId as a globally unique logical event identifier. Preserve related distinct states and same-type decisions while deduplicating exact redelivery; test both age and generic verification receipt paths (AUTH-22). Complete the actual Sumsub launch contract: an SDK token appended to the application's callback cannot launch provider verification. Use the official hosted-link operation or one supported SDK launcher, or disable/remove that unimplemented fallback until accepted scope requires it (AUTH-23). Test the real adapter through the browser rather than injecting a fabricated provider URL.

The existing instruction correctly calls for provider-specific explicit decision states, signed freshness, revocation, canonical identity, durable reconciliation, RLS/permission parity, protected avatar processing, and single-use OAuth redemption. Preserve its cautious distinction between local source/fixture proof and real provider acceptance. Do not promote Didit fallback-without-event-id risk into a blanket modern-provider defect: the currently documented Didit envelope includes `event_id`. Legacy payload support needs explicit verified compatibility tests.

## New primary-source checks relevant to existing findings

- Persona: https://docs.withpersona.com/2025-12-08/updates/changelog/2026/1/18 confirms that one-time-link/session fields are opt-in through their creation flags. Current API docs https://docs.withpersona.com/api-reference/inquiries/create-an-inquiry show the versioned API. AUTH-04 is retained; static sample responses alone are not proof fields exist by default.
- Sumsub token response: https://docs.sumsub.com/reference/generate-access-token explicitly defines response `userId` as the identifier on the integrator's side and token TTL as its lifespan. This independently supports AUTH-02 and AUTH-03.
- Didit: https://docs.didit.me/integration/webhooks currently documents event_id, dispatch timestamp and signed status/session envelope. Its header freshness example still checks unsigned `X-Timestamp`; retain AUTH-15's contract-ambiguity qualification and use verified deployed signatures rather than asserting this review proved a live replay exploit.

## Coverage and limits of this second pass

Fully reread in this pass (full output or complete reconstruction across bounded chunks):

- API verification: `verification-provider-adapters.ts`, `verification-repository.ts`, `verification-routes.ts`, `verification-webhook-adapter.ts`, `didit-webhook.ts`.
- API age: `age-provider-waterfall.ts`, `age-routes.ts`, `age-repository.ts`, `age-webhook-adapter.ts`.
- API auth/session: `wallet-auth-repository.ts`, `wallet-auth-routes.ts`, `http-auth.ts`, `session-routes.ts`, `supabase-auth.ts`.
- API admin: `admin-route-auth.ts`, `admin-permissions.ts`, `admin-repository-mapper-utils.ts`, `admin-repository-feature-flag.ts`, `admin-repository-event-ops.ts`.
- Web: age panel/page/callback route; adult-publisher gate; `apps/web/package.json`.

Targeted sections only: MCP routes/repository; landing age-return and start flow; earnings start action; Enterprise KYB action; large app test's Sumsub fixture; migration 0069 event DDL. Existing audit and auth section of instruction were read for reconciliation. No whole-file coverage is claimed for these targeted sections, the full instruction, or the other 70+ manifest entries in this bounded second pass. Prior full-file coverage remains prior evidence and was not inflated by this review.

No repository changes, remote mutations, live provider calls, mainnet transactions or production actions. The two new probes use synthetic nonsecret credentials. They must not be described as live-provider/browser end-to-end proof. Files written are review/proof artifacts outside the application checkout.
