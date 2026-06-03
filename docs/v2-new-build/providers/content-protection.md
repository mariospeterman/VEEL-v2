# Security And Content Protection

Status: accepted
Scope: documentation
Last updated: 2026-06-03
Source of truth: yes

Owns:
- content protection decisions for its named domain

Defers to:
- INDEX.md, route-map.md, OpenAPI, schema blueprint, and ADRs where narrower

Does not own:
- unrelated domains, implementation shortcuts, provider secrets, or hidden source-of-truth rules

Launch scope:
- accepted v2 launch or phased behavior stated in this document

Non-goals:
- historical-context inference, duplicate systems, and unapproved provider/product expansion

## Required Controls

- Fastify checks entitlement before issuing playback authorization.
- Bunny Stream VOD full playback always uses short-lived server-signed/tokenized playback.
- Bunny thumbnail URLs are signed by the API for Bunny Stream assets.
- Paid Livepeer streams and paid replay assets use JWT playback access from day one.
- Live playback remains server-authorized through Fastify before provider playback starts.
- Deleted, removed, and cleaned assets have local playback references revoked immediately.

## Required production settings

- enable Bunny Stream token authentication
- enable Bunny Stream allowed-domain restrictions for the real web origins
- enable Bunny CDN token authentication on the Stream pull zone if you use direct CDN paths
- enable Bunny Shield, Cloudflare API Shield, or an equivalent WAF/rate-limit/bot-control layer for API and webhook edge protection
- enable Livepeer JWT playback policy for paid/pass-gated live streams and paid replay assets
- keep Bunny and Livepeer secrets server-side only
- keep provider webhooks signed and verified

## API Edge Protection Boundary

Bunny Stream/CDN protects media delivery. It is not the business API authority.

Use Bunny Shield, Cloudflare API Shield, or an equivalent edge security layer for:

- WAF rules
- DDoS protection
- bot detection
- path and IP based rate limits
- API abuse controls
- upload scanning where supported

Fastify still owns authentication, authorization, idempotency, entitlement checks, webhook verification, and audit records. Edge protection can reduce abuse and cost, but it cannot replace backend policy.

## Recommended deterrence controls

- MediaCage DRM where the Bunny account tier supports it and the UX tradeoff is acceptable
- viewer/session watermarking for premium surfaces where practical
- short-lived playback TTLs
- rate limits on playback-token endpoints
- anomaly logging for repeated failed entitlement requests or suspicious token patterns

## Important limitation

No practical web video stack can guarantee that premium media cannot be copied. The goal is controlled access, shorter leak windows, and traceability, not a false promise of perfect prevention.

## Deferred Hardening Items

- playback anomaly dashboards
- advanced geo/IP token policies where business rules require them
- dynamic watermark overlays in the player path
- broader operator tooling around repeated token abuse
