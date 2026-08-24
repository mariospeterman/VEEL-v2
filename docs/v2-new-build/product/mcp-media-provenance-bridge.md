# WeVid MCP Media And Provenance Bridge

Status: accepted
Scope: Convergence 08 private media handoff, provenance, and trusted creator review
Last updated: 2026-08-24
Source of truth: yes for this bounded product slice

Owns:
- the optional MCP capability that hands media into an owned private WeVid draft
- minimized provenance claims and the first-party creator review required for those claims

Defers to:
- `mcp-profile-bridge.md` for remote MCP authorization and protocol behavior
- `universal-composer.md` for canonical drafts, ordered assets, and provenance fields
- `../media-live-providers.md` and provider ADRs for Bunny upload and provider-status behavior
- media-safety authorities for quarantine, normalized evidence, moderation, and release
- OpenAPI, migrations, and the MCP tool registry for exact schemas

Does not own:
- publication, moderation decisions, provider configuration, payments, wallet signing, entitlements,
  messages, age/KYC, or an external generation workflow

## Product contract

An explicitly authorized creator connection may prepare a one-time upload capability for one media
asset on one owned SFW private draft. The request declares a supported MIME type and bounded,
structured provenance. The bridge stores only a hash of the capability secret and returns the secret
once. It stores no prompt, model key, filename, provider credential, signed upload header, source
media, or raw provider payload.

The capability expires before redemption, is bound to the connection, creator, draft, media kind,
MIME type, and request hash, and is consumed at most once. Exact retries converge on the same
logical capability. A stale provisioning lease may be recovered; concurrent redemption cannot
create two canonical assets. Provider calls occur outside database transactions, and a provider
object that cannot be attached to the canonical asset is deleted or enters the existing durable
cleanup path. Every image lease attempt uses a distinct private provider object, so an expired
request can never delete the object created and attached by a recovered request.

Preparation requires a caller-generated UUID `requestId`; its normalized request is the logical
idempotency input. A newly issued capability lives for ten minutes and is redeemed only at
`POST /v1/mcp/media/uploads/{capabilityId}` with the same MCP bearer plus the separate one-time
capability header. Image redemption accepts only the declared raw image MIME and bounded body.
Video redemption is bodyless and returns a one-hour TUS handoff after the canonical asset row is
attached. Exact preparation replay returns the original capability identity without minting or
recovering the one-time capability value.

Image bytes continue through the existing WeVid sanitization and private Bunny Storage boundary.
Video bytes continue through the existing Bunny Stream TUS boundary. A redeemed video capability
receives only the documented presigned upload endpoint and safe headers for the provider-supported
minimum one-hour window; the Bunny Stream key remains server-only. Provider transfer completion is
not video readiness, safety approval, or publication evidence. For sanitized images, the server-only
Storage PUT includes the uppercase SHA-256 checksum and must receive Bunny's documented `201`; that
successful checksum-verified object write records private provider readiness so the existing safety
worker can inspect it, but never records safety approval, public delivery, or publication evidence.

## Provenance and human control

MCP-originated assets must declare one of `ai_assisted`, `ai_generated`, or
`materially_ai_manipulated`; an assistant cannot claim that an upload is human-created. The
normalized record may include a bounded source kind, opaque lineage reference, workflow provider,
and HTTPS/URN C2PA reference. References are claims, not validation results. Lineage and C2PA claims
accept only C2PA-controlled `c2pa.org` HTTPS hosts with paths named `claims`, `manifests`, `assets`,
or `lineage`, or WeVid/C2PA URNs whose terminal value is a UUID or 64-character hexadecimal
identifier; workflow references use the same opaque identifier shapes. Arbitrary hosts, paths, and
readable identifiers are not accepted. Prompts, credential vocabulary, private-key material,
personal data, and raw
generation-provider payloads are rejected at the API and database boundaries and never persisted.

Every MCP-originated asset begins with provenance review `pending`, a policy-derived visible label,
and machine-readable marking `pending` only when a C2PA reference was supplied. Provider readiness,
normalized safety evidence, and provenance review are separate predicates. Publication remains
fail-closed while any required asset has pending or rejected provenance.

Only the authenticated first-party WeVid application may confirm or reject the provenance claim.
MCP bearer tokens cannot call that review mutation. Confirmation is idempotent, audited, and bound
to the current composition revision; stale review attempts conflict. Rejection keeps the asset
private and release-blocked. Confirmation does not accept content-safety terms, approve moderation,
or submit the draft for publication.

## MCP capabilities

The final creator tool surface adds only:

1. `creator_prepare_private_media_upload` — issue or replay a short-lived, one-time capability for an
   owned compatible private draft and its bounded provenance claim.
2. `creator_get_private_media_readiness` — read minimized provider, quarantine, and provenance-review
   state for owned private-draft assets without media URLs or provider identifiers.

The preparation tool requires the existing private-draft write permission plus the media-label
permission. The readiness tool requires private-draft read plus media read. No publish-request,
provider-management, remote-fetch, arbitrary URL ingestion, base64 media, filesystem, shell, payment,
wallet, messaging, moderation, entitlement, age/KYC, or admin tool is registered.

## Failure and operations behavior

- Expired, revoked, mismatched, already-consumed, cross-user, wrong-draft, wrong-MIME, or incorrectly
  scoped capabilities fail closed with a safe normalized error and redacted audit evidence.
- Draft format and ten-asset limits are checked before capability issue and again before redemption.
- Upload quotas are backend-owned and apply before provider work; money, membership, and social state
  never increase capacity or priority. A creator-scoped transaction lock and in-flight reservation
  count keep concurrent redemptions across different drafts within the same rolling limit. The
  first-party image and video attachment paths take that same lock and count MCP reservations before
  their authoritative insert, so assistant and first-party uploads cannot race beyond the allowance.
  Recovering a stale MCP lease reuses its existing reservation rather than counting that same slot
  twice, and an expired provisioning row no longer consumes quota because it cannot produce an
  asset.
- Final attachment revalidates capability expiry plus the exact private, SFW, unpublished draft and
  media shape while holding the content lock. Publication that wins the race rejects attachment and
  triggers provider compensation; attachment that wins changes the composition before publication
  can re-evaluate release readiness. The ten-asset count is taken only after that content lock is
  acquired on MCP, first-party image, and first-party video paths, so a waiting completion observes
  the preceding committed attachment and returns a normalized draft conflict at capacity.
- Bunny/provider unavailability leaves the draft private and records only normalized failure state.
- If immediate deletion of an unattached provider object fails, a cleanup-only media id becomes a
  retired, non-composition asset in the existing provider-cleanup queue. That compensation row does
  not advance the creator-visible composition revision and exposes no provider id to the MCP client.
- Provider webhook and explicit sync continue to update video state on the canonical `media_assets`
  row. Private image readiness comes only from the successful checksum-bound Bunny Storage response;
  the bridge never infers provider success from a request attempt or client assertion.
- Capability secrets, upload signatures, private media URLs, opaque lineage references, and C2PA
  references are excluded from MCP tool-call audit payloads and general logs.
- Connection last-used persistence is best-effort after capability completion. Its failure is logged
  but cannot suppress the one response containing an already-created video upload handoff.

## Automated proof

The slice must prove capability hashing, expiry, exact replay, single redemption, lease recovery,
cross-user and scope denial, MIME and draft-shape binding, final attachment/publication exclusion,
shared first-party/MCP quota serialization, expired-reservation release, post-lock MCP and first-party
capacity conflicts, canonical image sanitization, presigned video behavior, best-effort activity
persistence, provider failure compensation, quarantine and moderation-job creation, normalized
provider readiness, provenance privacy, first-party-only review, release blocking, guarded rollback,
real-Postgres concurrency, and authenticated desktop/mobile review UX. Provider staging remains a
separate release-manifest-bound gate and deterministic fixtures never count as provider approval.
