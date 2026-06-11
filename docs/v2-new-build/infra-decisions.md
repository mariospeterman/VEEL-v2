# Veel V2 Infrastructure And Research Decisions

Status: accepted
Scope: queues, search, analytics, observability, notifications, feature flags, compliance research constraints
Last updated: 2026-06-07
Source of truth: yes for v2 infrastructure defaults

Owns:
- infra decisions decisions for its named domain

Defers to:
- INDEX.md, route-map.md, OpenAPI, schema blueprint, and ADRs where narrower

Does not own:
- unrelated domains, implementation shortcuts, provider secrets, or hidden source-of-truth rules

Launch scope:
- accepted v2 launch or phased behavior stated in this document

Non-goals:
- historical-context inference, duplicate systems, and unapproved provider/product expansion

This document freezes the default infrastructure choices for the greenfield repo so implementation does not drift into ad hoc services.

## Launch Defaults

| Area | Launch default | Scale option | Reason |
| --- | --- | --- | --- |
| Queue/workers | `pg-boss` on Postgres | BullMQ + Redis when throughput requires it | Keeps launch infra smaller while still giving retries, schedules, and job state. |
| Search | Postgres full-text search + trigram indexes | Typesense/Meilisearch later | Hashtags, creators, locations, and captions can launch without a second search cluster. |
| Product analytics | PostHog Cloud or self-hosted PostHog | Warehouse/ClickHouse pipeline later | Fast event analytics, funnels, and retention dashboards without custom BI. |
| Error monitoring | Sentry | Keep Sentry | Fast frontend/API/worker error triage. |
| Tracing | OpenTelemetry | Managed collector/vendor | Needed for provider calls, payment confirmation latency, media jobs, and webhook lag. |
| Logs | Structured redacted JSON logs | Centralized log vendor | Never log secrets, raw PII, signed media URLs, raw provider payloads, or wallet private data. |
| Email | Resend or equivalent transactional provider | Dedicated deliverability provider | Magic links, receipts, age/KYC status, admin operations, and safety notices need reliable delivery. |
| Push | Web Push + FCM/APNs path | Dedicated notification service | PWA notifications for messages, live reminders, Event Access Passes, Mutuals, and safety states. |
| Feature flags | Backend config table + env defaults | LaunchDarkly-style provider later | Admin can override policy safely without deploying; flags must be audited. |
| Geocoding | Hosted OSM/Nominatim-compatible provider | Dedicated maps provider if needed | Cost-efficient event location UX with server caching and attribution. |

## Hard Rules

- Backend is the business-truth layer for money, access, age, Mutuals, Event Access Passes, subscriptions, referrals, reports, and moderation.
- Realtime is for delivery and freshness, not entitlement authority.
- Feature flags cannot bypass payment validation, age requirements, provider signatures, admin audit logging, or content safety policy.
- Paid promotion cannot silently rank content higher in For You. Any paid distribution product must be explicit, labeled, opt-out aware, and reviewed by a separate ADR.
- Provider webhooks must be idempotent, signed, rate-limited, replay-resistant, audited, and observable.

## CI/CD Gates

Launch repository must keep these workflows:

```text
.github/workflows/ci.yml
.github/workflows/security.yml
.github/workflows/preview.yml
.github/workflows/deploy-staging.yml
.github/workflows/deploy-production.yml
.github/workflows/db-migrations.yml
```

Current scaffold workflows run docs/contract/schema checks and security scaffolding. They become full production gates when the foundation slice creates real app, API, worker, migration, and E2E tooling.

Current executable state:

- `preview` installs dependencies, builds deployable apps, and verifies the deploy skeleton.
- `deploy-staging` and `deploy-production` install dependencies, build deployable apps, run database migration checks, and run `pnpm deploy:check`.
- `DEPLOY_ENABLED=true` must be set only in a GitHub environment after real hosting targets exist.
- `API_HEALTH_URL` and `API_READY_URL` are required when deploy checks are active and must point at `/healthz` and `/readyz`.

Required branch protection for `main`:

- pull request required
- required reviews
- CODEOWNERS review for contracts, database, payments, providers, compliance, and workflows
- CI and security checks required
- secret scanning enabled
- Dependabot enabled
- production deploy through GitHub environment approval
- OIDC for cloud deploy credentials; no long-lived deploy secrets

No production deploy workflow may become active until it has artifact digest pinning, migration backup/snapshot step, health checks, smoke tests, and rollback instructions.

## Queue Strategy

Use `pg-boss` first for:

- Solana evidence reconciliation
- payment expiry
- Bunny media status polling
- Livepeer replay handoff
- age/KYC webhook retries
- moderation jobs
- notification fanout
- admin export jobs
- AI tool-call follow-up jobs

Move selected queues to BullMQ/Redis only when one of these thresholds is reached:

- queue lag exceeds payment/access SLA under normal traffic
- job throughput needs Redis-backed fanout
- Redis is already required for rate limiting/session-adjacent infrastructure
- Postgres job writes become a measurable DB bottleneck

## Analytics Strategy

PostHog tracks product events only:

- signup funnel
- wallet path chosen
- age verification conversion
- Home/Bits feed engagement
- content-unlock/support/tip/live-pass/Event Access Pass intent and completion
- share/referral click and conversion
- creator dashboard usage
- report/block/safety actions
- Mutuals opt-in, mutual creation, stale/closed Mutuals
- Event Access Pass purchase and check-in

Do not send raw PII, raw message bodies, provider payloads, wallet private data, age images/docs, signed playback URLs, or exact private locations to analytics.

## Observability Strategy

Every production slice must emit:

- request latency and error metrics
- provider-call latency and failure metrics
- queue lag and retry metrics
- webhook accepted/processed/rejected metrics
- audit-event write success metrics
- payment confirmation time from wallet approval to entitlement grant
- media upload-to-ready latency
- live stream start/end/replay handoff latency

OpenTelemetry traces should connect:

```text
web action
  -> API request
  -> provider request/webhook
  -> worker reconciliation
  -> DB state transition
  -> realtime/cache refresh
```

## Notification Strategy

Notifications must be useful, sparse, and opt-out aware.

Allowed launch notifications:

- message received
- paid message request/action needed
- live room starting for followed creators
- payment completed/failed/retry needed
- Event Access Pass receipt/check-in reminder
- referral commission state change
- new Mutual and one first-reply nudge
- safety/report/admin decision

Disallowed launch notifications:

- spammy Mutuals nudges
- addictive infinite-feed pressure
- hidden paid ranking prompts
- repeated unpaid creator promotion pressure

## Research-Backed Product Constraints

The June 2026 build plan assumes:

- Social video is a huge market, but discovery must include user control, break states, reporting, and non-addictive defaults.
- EU DSA-style recommender transparency means users need meaningful feed controls and a non-profiling/chronological option where required.
- Age assurance for adult services must be real, provider-backed, and privacy-minimizing; self-declaration is not enough.
- Event Access Pass purchase flows must show all fees before confirmation and avoid dark patterns around checkout.
- Mutuals must reduce ghosting/overwhelm with active-Mutual limits, stale-Mutual cleanup, consent rules, report/block tooling, and gentle notifications.

References:

- DataReportal global social media reporting: https://datareportal.com/social-media-users
- EU Digital Services Act recommender-system transparency: https://digital-strategy.ec.europa.eu/en/policies/dsa-vlops
- Ofcom age-check expectations under online safety rules: https://www.ofcom.org.uk/online-safety/
- FTC junk fee guidance: https://www.ftc.gov/business-guidance/blog/2024/12/ftcs-junk-fees-rule-what-it-means
- DOJ Ticketmaster/Live Nation competition case context: https://www.justice.gov/opa/pr/justice-department-sues-live-nation-ticketmaster-monopolizing-markets-across-live-concert
- Pew online dating research: https://www.pewresearch.org/topic/internet-technology/platforms-services/online-dating/

## Acceptance

- Queue, search, analytics, observability, email, push, and feature-flag defaults are decided before implementation.
- Every slice adds operational visibility, not just product UI.
- Production choices are provider-first and cost-aware.
- Research constraints are reflected in product docs, contracts, and admin dashboards.
