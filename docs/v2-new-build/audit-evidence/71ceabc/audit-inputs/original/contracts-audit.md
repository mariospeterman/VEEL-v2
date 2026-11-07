# WeVid canonical OpenAPI full-read audit — 71ceabc

Scope: `mariospeterman/VEEL-v2` at exact commit `71ceabcfaa8a5258e1b935a391ff4e6e7330c682`. Read root `AGENTS.md`. The canonical YAML is 7,331 lines / 364,473 bytes, SHA-256 `04d50c69cf442e172cd1cd2b298d03ac5f96e05e1e5d9b81a3b258708ddddcf0`. Main reviewer read every line 1–3700 in eleven bounded untruncated chunks; delegated reviewer read lines 3701–7331. Exact range/hash evidence is in `contracts-coverage.json` and `contract-tail-coverage.json`. Generated TypeScript is a mechanical derivative whose regeneration and byte identity were verified separately by root; this report does not claim a semantic line-by-line review of that generated file. Repository source was not edited.

## CONTRACT-01 — P2 — The age-webhook contract rejects its known provider payloads and documents authentication that the runtime does not use

`packages/contracts/openapi.yaml:3685–3694` defines `AgeWebhookPayload` as `oneOf` Sumsub, Yoti, and an unrestricted object. Every valid Sumsub/Yoti object also matches the fallback object, so a compliant validator rejects precisely the known-provider payloads. Deterministic Ajv 8.20.0 JSON Schema2020 validation of the dereferenced source schema proved a Sumsub sample matches branches 0+2 and a Yoti sample matches 1+2, both failing `must match exactly one schema in oneOf`. See `contracts-webhook-proof.json`. This is independent of DB-03 legacy nullability.

The same operation (`openapi.yaml:3467–3471`) requires `X-Veel-Webhook-Signature` via the parameter at 3504–3509. The actual adapter reads Sumsub `x-payload-digest`/`x-payload-digest-alg` (`apps/api/src/modules/age/age-webhook-adapter.ts:69–73`) or Yoti `body.signature` (`:114–118`); it never consumes the required X-Veel header. `AgeProvider` also advertises Didit (`openapi.yaml:3584–3588`), while `age-routes.ts:35–38,54–58` intentionally routes Didit through the verification webhook and rejects it on the age path.

Impact: generated clients, contract-based callback fixtures, gateways, and future application of this canonical schema cannot implement the currently supported callback boundary accurately. The current age-webhook Fastify registration (`age-routes.ts:44–50`) does **not** attach the contract body/header schema, so this is not evidence that current callbacks are failing at runtime. Provider-approved/blocked status is separate from this reproducible contract contradiction.

Fix: make callback contracts provider-specific or explicitly discriminate their schemas, remove the overlapping unrestricted `oneOf` branch, represent each provider’s actual signature location, and remove Didit from this path while retaining its canonical verification path. Avoid replacing the union with `anyOf` plus a catch-all: that would silently eliminate all useful provider payload validation. Validate actual signed provider fixtures against the selected schema without changing the provider bytes before signature verification.

## Existing findings and deliberate exclusions

- DB-03 already records OpenAPI3.1 with 328 legacy `nullable:true` occurrences; do not count it again.
- Scope/identity/state, pagination, authorization, idempotency storage, exact asset units and payment correctness are covered in the domain runtime audits; no additional security bypass is claimed from missing documentation alone.
- Public profile behavior is intentionally accessible without a session in runtime although the path inherits global cookie security; this is a minor documentation mismatch to fix with `security: []`, not a demonstrated data exposure.
- `/mcp` uses its own JSON-RPC protocol; its absence from the REST contract is not counted as a defect here.
- Disabled recurring/provider-dependent features remain blocked until their actual approval/proof requirements are met. Nominal enum values alone are not proof of a reachable runtime state; e.g. a possible zero creator allocation for `platform_owned` was not filed because no current route was found that emits it.

## CONTRACT-02 — P3 — Response playback credential is marked request-only

`packages/contracts/openapi.yaml:5051` annotates `PlaybackResource.jwt` with `writeOnly:true`, although `apps/api/src/modules/live/live-route-shared.ts:232–252` obtains a viewer-scoped JWT and includes it in the signed live playback response. `live-room-routes.ts:169–199` returns that object using the contract response schema. `apps/web/app/provider-playback.tsx:74–82,161` reads the response JWT and passes it to the Livepeer player; `apps/api/test/app.test.ts:11042–11049` asserts it is present.

Impact: response-model generators/filters that honor `writeOnly` can omit a credential required for playback. This is a metadata defect; no current Fastify serialization or web playback failure is claimed. Correct the response annotation (typically `readOnly:true`) and describe the short-lived viewer-scoped capability. Delegated detailed evidence: `contract-tail-audit.md`, CT01.

## CONTRACT-03 — P3 — Admin payment state enum omits reachable cancellation

`packages/contracts/openapi.yaml:6845` excludes `cancelled` from `AdminPaymentIntent.state`. `apps/api/src/modules/event/event-access-pass-methods.ts:152–158` writes this state to `payment_intents` on inventory-reservation failure; migration `packages/database/migrations/0096_one_time_monetisation_checkout.sql:36–43` also cancels pre-consent intents. The admin query selects `pi.state` (`admin-repository-money.ts:21–40`) and maps it unchanged (`admin-repository-core-mappers.ts:219–225`).

Impact: the admin API can return a lifecycle state that the canonical schema and generated enum reject. Align it with the public `PaymentIntent.state` enum, which already permits cancellation. Parsed membership evidence: `contract-tail-structural-proof.json`; delegated details: `contract-tail-audit.md`, CT02. No current serializer exception is asserted.

## Complete coverage result

All 7,331 canonical YAML lines / 364,473 bytes were read semantically across 21 untruncated source chunks, without gaps or overlaps. The merged `contracts-coverage.json` recomputes and verifies every range’s byte count/hash against the fixed commit and marks coverage complete. Findings comprise one P2 contract-boundary defect and two P3 contract metadata/enum defects; no additional runtime vulnerability is inferred from those defects.
