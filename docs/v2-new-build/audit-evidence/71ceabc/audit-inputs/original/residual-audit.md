# Residual API source audit — 71ceabc

Scope: remaining 22 API runtime/provider/activity/refund/telemetry files not fully read in the other code-review coverage manifests. All 22 were read completely. Related app/router/identity compatibility code and migration0057/0107 were also fully read. Repository source was not changed. Coverage: `residual-coverage.json`.

## RES-01 — P1/P2 — Global error handling exposes internal exception messages to clients

Evidence: `apps/api/src/app.ts:79-89` returns arbitrary Error objects with `reply.send(error)` or `reply.code(statusCode).send(error)`, except its validation/rate-limit special cases. Fastify serializes their messages directly. There is no final stable sanitized 5xx resource.

Executed proof against the compiled actual buildApi under pinned Node22.16.0: an audit-only injected route throwing `Error('AUDIT_PRIVATE_DIAGNOSTIC_X')` returned500 with that exact diagnostic as JSON.message. An authenticated malformed refund body returned500 with `body.reason.trim is not a function`. Evidence: `residual-runtime-proof.json`; runnable audit-only probe: `residual-runtime-proof.mjs`. Synthetic values were used; this is not evidence that a real secret was exfiltrated.

Impact: uncaught SQL/provider/library/configuration errors can disclose internal diagnostics/schema or sensitive values that happen to appear in a message; user-visible errors also violate the canonical API error resource. Production transport should not make arbitrary exception.message public.

Fix: keep internal exceptions in redacted structured diagnostics with a correlation/request ID; return stable documented codes and generic messages for unexpected5xx, and explicitly map safe expected4xx. Do not serialize arbitrary provider error bodies. Tests must throw a sentinel containing mock credentials/PII and assert it never appears in client JSON, while ordinary contract400/domain409 remain useful.

## RES-02 — P2 — Refund endpoint lacks runtime contract validation and turns malformed input into500

Evidence: `apps/api/src/modules/refund/refund-routes.ts:47` registers POST without contractRouteSchema; `:148-176` uses handwritten Partial<CreateRefundDisputeRequest> checks. At `:172`, truthy nonstring reason invokes .trim and throws. paymentIntentId is checked only for a nonempty string (`:155`), then cast to uuid by repository (`refund-repository.ts:146`). Refund/activity list cursors are passed directly to timestamptz casts without runtime validation.

Executed real-route proof: valid authenticated fixture + `reason:42` yielded500, rather than documented400. This does not require a database/provider call. Invalid UUID/cursor also has an evident SQL-error path when a database is configured; those latter variants were not executed here.

Fix: attach the canonical OpenAPI operation request/query schemas and retain only contextual ownership/policy checks. Validate body types, UUIDs, bounds and cursor before SQL. Add malformed-type/UUID/cursor/extra-field cases and ensure no unexpected500 or internal message leaks. Avoid adding a second handwritten schema system.

## RES-03 — P2 — API process does not run its close hooks during ordinary termination

Evidence: `apps/api/src/server.ts:1-13` starts listen and handles startup error only. There are no SIGTERM/SIGINT listeners anywhere in apps/api/src. `app-lifecycle.ts:49-66` registers repository/database close hooks, and app.ts registers Redis cleanup, but those require app.close(). Docker's API CMD invokes this process directly. The worker separately has graceful shutdown logic.

Impact: normal deployment/scale-down termination ends the process without draining in-flight requests or executing its documented connection cleanup. Financial/provider requests can lose their responses midway and rely entirely on retries; the audit independently found incomplete idempotency in several such paths. This is a code/deployment reliability gap, not a claim of lost committed database transactions.

Fix: install one bounded idempotent shutdown handler that stops accepting traffic, calls app.close(), waits within the orchestrator grace period and then exits. Handle multiple signals, open connections and shutdown errors safely. Test termination during an in-flight bounded request and verify request completion/explicit retry plus exactly-once close hooks.

## RES-04 — P2 — Activity and refund pagination have the same lookahead-row omission

Evidence: `activity-repository-mappers.ts:63-72`, `activity-wallet-repository.ts:39-47`, `activity-access-pass-repository.ts:34-42`, `refund-repository.ts:90-100` return the extra unreturned row's timestamp as the exclusive next cursor. Their next SQL page uses `<cursor`, so every extra lookahead row is skipped. Sorting only by created_at also drops ties, and the merged Activity union needs a stable kind/id tie-breaker.

Fix: consolidate with CONTENT-07/AUTH-11/PAY-12 rather than count this as a new independent root cause: cursor comes from the last returned row, all ORDER BY fields are encoded, and the extra row determines only hasMore. Test every activity/refund endpoint across multiple pages with identical timestamps and mixed payment/wallet activity.

## RES-05 — P2 — Concurrent same-key refund requests can fail rather than replay

Evidence: `refund-repository.ts:112-139` reads an existing actor/key row, then `:150-172` inserts a new row without an actor/key lock or ON CONFLICT/retry recovery. `0057_refund_request_idempotency.sql:17-18` imposes a unique(reporter_user_id,idempotency_key). Two READ COMMITTED transactions can both observe no row; one inserts, the other waits then raises23505. Refund routes catch configuration/conflict-domain errors, not this SQL uniqueness failure. A transaction wrapper alone does not serialize the logical operation.

Impact: the uniqueness constraint prevents duplicate review obligations, but the losing identical retry gets500 instead of the original result, and a different payload under the same key can produce500 instead of409. This concurrency schedule is source-traced; no native multi-connection PostgreSQL concurrency proof was run in this pass.

Fix: claim/lock the durable scoped logical-operation receipt atomically; after conflict, load and hash-check the winner in a fresh statement/snapshot and return its original response. Add two-connection identical and changed-payload tests with a barrier after the initial read. Keep audit creation in the same transaction.

## Identity correction / non-finding

Several residual repositories still use the deprecated supabaseUserId parameter/column. This is cleanup debt, but normal wallet users are not currently broken merely because they lack Supabase recovery: `wallet-auth-repository.ts:617-618` inserts users.id and users.supabase_user_id with the same canonical ID; migration0107 rewrites legacy nonnull values to id and enforces null-or-equal. Therefore the initial cross-review hypothesis that profile creator lookup necessarily makes ordinary wallet users anonymous is not confirmed. Null compatibility-column users are permitted by0107 and would fail these legacy lookups, but a normal current creation path leaving it null was not found. Consolidate to canonical users.id over time and test allowed null fixtures; do not label the normal current flow a reproduced identity failure.

## Other observations, not added as confirmed defects

- readyz checks only Postgres. Redis is mandatory and checked at startup, but subsequent Redis outages are not reflected in this endpoint. Clarify the required readiness contract before expanding probes.
- The public telemetry route intentionally accepts observational values with bounded attributes and does not use event IDs as metric labels. No new privacy leak was found in that file.
- The canonical provider replay runtime reuses existing domain handlers; no second payment/media authority should be introduced for these fixes.
- Lifecycle missing close entries for mcp/verification is harmless in the default shared-client dependency arrangement; do not report one database pool per repository or a default leak.

Validation boundaries: the source/error probe uses actual compiled repository code, Node22.16.0 and route injection with fake authentication/age subjects; no live provider, external user, production key, remote database or production mutation was involved. Parent owns full lint/typecheck/unit/build/browser validation.
