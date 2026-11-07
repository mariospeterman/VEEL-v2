# OpenAPI contract full-read audit: lines 3701–7331

Repository: `mariospeterman/VEEL-v2`, commit `71ceabcfaa8a5258e1b935a391ff4e6e7330c682`.

Read `AGENTS.md` and every assigned contract line. Exact untruncated read ranges, byte counts, and SHA-256 hashes are in `contract-tail-coverage.json`. Assigned coverage: 3,631 lines / 192,623 bytes. No repository source edited. Runtime files below were read only in targeted ranges, not claimed as full-file coverage. Generated TypeScript was excluded because the parent independently verified deterministic generation and byte identity.

## Confirmed low-severity contract defects

### CT01 — P3: response playback credential is marked request-only

`packages/contracts/openapi.yaml:5051` declares `PlaybackResource.jwt` with `writeOnly: true`. The API's signed live playback response intentionally returns this field: `apps/api/src/modules/live/live-route-shared.ts:232–252` obtains the viewer-scoped JWT and includes `jwt` alongside the HLS URL. `apps/api/src/modules/live/live-room-routes.ts:169–199` sends that response for `getLiveRoom`, using the OpenAPI response schema. `apps/web/app/provider-playback.tsx:74–82` reads `playback.jwt`, and line 161 supplies it to `Player.Root`. Existing regression coverage at `apps/api/test/app.test.ts:11042–11049` asserts the JWT is in the response.

Impact: the canonical contract tells clients that the credential is an input-only property, although playback consumers need it in responses. Response-model generators/filters that honor `writeOnly` can omit it and leave clients unable to pass the playback credential to the provider. This is a contract metadata defect; no current Fastify serialization failure or existing-web playback failure is claimed. Correct the field's read/write annotation (typically `readOnly: true`) and describe the short-lived viewer-scoped response token.

### CT02 — P3: admin payment state enum omits a reachable terminal state

`packages/contracts/openapi.yaml:6845` limits `AdminPaymentIntent.state` to `pending`, `transaction_requested`, `submitted`, `confirmed`, `failed`, and `expired`; it excludes `cancelled`. This state is reachable in current code: `apps/api/src/modules/event/event-access-pass-methods.ts:152–158` changes `payment_intents.state` to `cancelled` if an inventory reservation cannot be created. Migration `packages/database/migrations/0096_one_time_monetisation_checkout.sql:36–43` also cancels pre-consent payment intents. The admin list directly selects `pi.state` (`apps/api/src/modules/admin/admin-repository-money.ts:21–40`) and maps it unchanged (`apps/api/src/modules/admin/admin-repository-core-mappers.ts:219–225`).

Impact: admin payment responses for these records violate the published schema and generated enum; contract-validating clients cannot represent an existing state. The public `PaymentIntent.state` enum already permits `cancelled`, so align the admin schema with actual payment lifecycle states. No current serializer exception is claimed. `contract-tail-structural-proof.json` records the parsed enum and absence of `cancelled`.

## Reviewed candidates not filed

- The known OpenAPI 3.1 `nullable: true` issue is already DB03; not duplicated here.
- `PaymentIntent.creatorSideProceedsMinor` and `creatorAmountMinor` have minimum 1 even though `settlementKind` includes `platform_owned`. Current inspected payment creation always calls `calculateSettlementSplit`, which requires positive creator proceeds. No route emitting zero creator amounts was established, so no defect asserted.
- `PerformerConsentRequest.verificationState` omits `invalid`, matching the performer-subject table's status constraint. The database audit owner independently investigated the trigger/status-domain inconsistency and established that current normalized performer declines map to `blocked`; no reachable declined-performer webhook failure is asserted here.
- Other `oneOf` branches in these ranges are disjoint (explicit null alternatives, scalar number/string alternatives) or intentionally enforce exactly one performer identity source. No additional overlapping-schema defect found.
- ErrorCode includes `provider_unavailable`; the wallet provider-unavailable response is represented.
- No provider-blocked feature was counted as a bug merely because it is disabled or requires provider approval.

## Validation limits

Parsed the source YAML and recorded the exact relevant schema properties. Attempted a JSON Schema validator proof, but Python `jsonschema` is not installed; no installation or repository changes made. The admin enum mismatch follows directly from source-parsed enum membership plus the reachable runtime write and unmodified projection. No full test suite rerun was needed for this read-only contract tail review.
