# Security And Content Protection

Status: proposed v2 architecture
Scope: documentation
Last updated: 2026-06-03
Source of truth: yes

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
- enable Livepeer JWT playback policy for paid/pass-gated live streams and paid replay assets
- keep Bunny and Livepeer secrets server-side only
- keep provider webhooks signed and verified

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
