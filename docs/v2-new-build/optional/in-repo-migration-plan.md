# Veel V2 Migration Plan

Status: optional alternative
Scope: in-repo rebuild/migration alternative
Last updated: 2026-06-01
Source of truth: no, unless the clean `veel-v2` repo plan is rejected

This document is not the primary v2 build plan. Use `../build-plan.md` for the clean new repo. Keep this file only as an alternative if you decide to build v2 inside the existing monorepo.

## Alternative Recommendation

Do not rewrite in-place. Build v2 in parallel and cut over by proven vertical slices.

Preferred structure:

```text
apps/api        current Laravel API
apps/web        current Next app
apps/api-v2     proposed Fastify API
apps/web-v2     proposed clean Next app
packages/contracts-v2
```

Alternative: new `veel-v2` repo. Use this if the current repo noise slows development or Cursor/Codex indexing remains polluted.

## Phases

### Phase 0: Architecture Freeze

- approve v2 docs
- approve stack ADRs
- approve product flow diagrams
- approve data model
- approve provider boundaries
- approve migration strategy

No code yet.

### Phase 1: Foundation

- create `apps/api-v2`
- create `packages/contracts-v2`
- configure Fastify, OpenAPI, logging, error model
- connect Supabase local/staging
- implement auth/session endpoint
- implement test harness

### Phase 2: Core Read-Only App

- create `apps/web-v2`
- implement app shell, auth gate, Home read-only feed, media cards, profile read-only
- implement generated API client
- no payments yet

### Phase 3: Media Pipeline

- Bunny upload intent
- TUS direct upload
- provider webhook
- playback resource
- content publish
- media viewer

### Phase 4: Payments And Access

- payment intents
- Solana Pay transaction request
- native SOL devnet
- SPL/USDC mode
- Helius webhook
- RPC fallback
- entitlement grants
- paid unlock E2E

### Phase 5: Messages And Realtime

- direct threads
- messages
- read state
- Supabase Realtime
- paid messages/tips
- block/report

### Phase 6: Live

- live room create/start/end
- Livepeer provider
- host connection
- viewer playback
- live pass
- chat
- replay

### Phase 7: Safety/Admin

- age provider
- KYC/KYB provider
- moderation
- admin MVP
- audit exports

### Phase 8: Cutover

- data migration rehearsal
- staging provider smoke
- security review
- performance/load test
- launch runbook
- DNS/API cutover

## Porting Rule

Port behavior, tests, and contracts. Do not port old code unless it is clearly correct, small, and provider-aligned.

## Kill Criteria

Stop the rebuild if:

- auth migration is not solved
- payment verification is weaker than current
- provider boundaries regress
- frontend rebuild takes longer than targeted refactor
- v2 lacks tests for money/access/media

## Success Criteria

- smaller codebase
- generated contracts
- provider-first integrations
- no duplicate business systems
- no custom realtime server unless necessary
- faster local setup
- clearer production deployment
- complete payment/media/live/message E2E coverage
