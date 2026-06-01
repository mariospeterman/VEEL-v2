# ADR 0004: Proposed v2 Parallel Rebuild Strategy

Status: proposed
Scope: rebuild strategy
Last updated: 2026-06-01
Source of truth: proposal

## Context

Rebuilding directly over the current app would risk breaking a working payment/media/live/message baseline. A clean rebuild may be worthwhile, but only if current production behavior stays available until v2 proves parity.

## Decision

Build v2 in parallel:

```text
apps/api-v2
apps/web-v2
packages/contracts-v2
```

Do not delete current Laravel/Next app until v2 passes:

- auth/access E2E
- media upload/playback E2E
- paid unlock E2E
- referral commission E2E
- messages/realtime E2E
- live host/viewer/pass E2E
- age/KYC E2E
- admin/safety smoke

## Consequences

Positive:

- Current app remains a working reference.
- v2 can be stricter and cleaner.
- Migration risk is visible.

Negative:

- Temporary duplication at app level.
- Requires discipline to avoid patching two products forever.
- Needs a hard cutover checklist and kill criteria.

## Cutover Rule

V2 replaces current app only when it is objectively safer, cleaner, and more complete than the current baseline.

