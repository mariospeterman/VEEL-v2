# Veel V2 Media And Live Provider Architecture

Status: proposed v2 architecture
Scope: Bunny, Livepeer, media, live
Last updated: 2026-06-01
Source of truth: proposal

## Provider Split

- Bunny Stream: VOD upload, transcoding, thumbnails, CDN playback.
- Livepeer: live room creation, stream key/ingest, live playback, replay handoff where useful.
- Veel backend: content state, access, moderation, provider mapping, frontend-safe resources.
- Frontend: official provider player/component integration wrapped in Veel layout primitives.

## Bunny VOD Flow

```mermaid
sequenceDiagram
  participant Web
  participant API
  participant Bunny
  participant DB

  Web->>API: Create content draft
  Web->>API: Request upload intent
  API->>Bunny: Create video object
  Bunny-->>API: videoId
  API->>DB: Store asset provider id/status
  API-->>Web: TUS endpoint + safe headers
  Web->>Bunny: TUS upload directly
  Bunny->>API: Webhook/status
  API->>DB: Normalize state
  Web->>API: Refresh content status
```

Rules:

- Bunny video object is created by backend before TUS upload.
- Bunny API key never reaches frontend.
- Frontend receives only upload target/headers needed for TUS.
- Provider payload is sanitized before frontend response.
- Paid full playback requires backend access state.

## Livepeer Live Flow

```mermaid
sequenceDiagram
  participant Creator
  participant Viewer
  participant API
  participant Livepeer
  participant DB

  Creator->>API: Create/start room
  API->>Livepeer: Create stream
  Livepeer-->>API: streamKey, ingest, playback
  API->>DB: Store encrypted host credentials
  API-->>Creator: Host connection
  Viewer->>API: Open viewer room
  API-->>Viewer: Safe playback/access state
  Livepeer->>API: Stream webhook
  API->>DB: Update live/replay state
```

Rules:

- Creator-only host endpoint exposes masked/revealed stream key only after authorization.
- Viewer never receives stream key or ingest URL.
- Replay state is separate from live state.
- Playback access can use Livepeer JWT/webhook if protected playback needs provider-enforced access.
- Use Livepeer React/player primitives where they fit the UX, especially for live/replay playback.
- Use provider-supported JWT access for paid/pass-gated streams where staging proves the flow.

## Media Access Resource

Frontend receives:

- media type
- poster/thumbnail
- teaser playback
- full playback only when authorized
- provider label/status
- normalized processing state

Frontend does not receive:

- provider API keys
- raw provider payloads
- Bunny management URLs
- Livepeer stream key
- ingest URL for viewers
- signed full playback when locked

## Playback And Player Strategy

- Use official provider players/components before custom playback code.
- Use Bunny player or provider-supported Stream playback URLs where they reduce custom player work.
- Use Bunny Stream token authentication / signed or tokenized playback where provider/account supports it.
- Use Livepeer JWT access control for protected streams/assets where paid/pass-gated.
- Teaser playback can be public or short-lived signed, depending content risk and cost.
- Full locked playback requires backend entitlement before issuing safe playback resource.
- Veel UI wraps provider players for layout, gestures, action rails, sheets, and accessibility.

## Moderation Pipeline

```text
upload ready -> automated scan -> policy review if needed -> publish allowed
```

Moderation can block:

- publish
- discovery
- monetisation
- playback
- live room continuation

## Test Matrix

- Bunny TUS credentials safe
- Bunny duplicate webhook idempotent
- Bunny provider payload sanitized
- Bunny player/playback resource contains no management secrets
- locked full media not exposed
- unlocked viewer receives full playback
- Livepeer viewer no host credentials
- Livepeer creator host connection authorized
- Livepeer JWT/protected playback path works for paid streams if enabled
- replay resource safe
- live pass access controls playback/chat
