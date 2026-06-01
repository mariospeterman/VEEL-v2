# Security And Content Protection

Status: current
Scope: documentation
Last updated: 2026-05-29
Source of truth: yes

## Current controls

- Laravel checks entitlement before issuing playback authorization.
- Bunny Stream VOD playback uses short-lived server-signed URLs.
- Bunny thumbnail URLs are signed by the API for Bunny Stream assets.
- Live playback remains server-authorized through Laravel before provider playback starts.
- Deleted, removed, and cleaned assets have local playback references revoked immediately.

## Required production settings

- enable Bunny Stream token authentication
- enable Bunny Stream allowed-domain restrictions for the real web origins
- enable Bunny CDN token authentication on the Stream pull zone if you use direct CDN paths
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

## TODOs that are still real

- playback anomaly dashboards
- advanced geo/IP token policies where business rules require them
- dynamic watermark overlays in the player path
- broader operator tooling around repeated token abuse
