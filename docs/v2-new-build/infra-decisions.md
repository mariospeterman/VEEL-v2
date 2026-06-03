# Veel V2 Infrastructure And Research Decisions

Status: proposed v2 architecture
Scope: queues, search, analytics, observability, notifications, feature flags, compliance research constraints
Last updated: 2026-06-03
Source of truth: yes for v2 infrastructure defaults

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
| Push | Web Push + FCM/APNs path | Dedicated notification service | PWA notifications for messages, live reminders, tickets, dating matches, and safety states. |
| Feature flags | Backend config table + env defaults | LaunchDarkly-style provider later | Admin can override policy safely without deploying; flags must be audited. |
| Geocoding | Hosted OSM/Nominatim-compatible provider | Dedicated maps provider if needed | Cost-efficient event location UX with server caching and attribution. |

## Hard Rules

- Backend is the business-truth layer for money, access, age, dating, tickets, subscriptions, referrals, reports, and moderation.
- Realtime is for delivery and freshness, not entitlement authority.
- Feature flags cannot bypass payment validation, age requirements, provider signatures, admin audit logging, or content safety policy.
- Paid promotion cannot silently rank content higher in For You. Any paid distribution product must be explicit, labeled, opt-out aware, and reviewed by a separate ADR.
- Provider webhooks must be idempotent, signed, rate-limited, replay-resistant, audited, and observable.

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
- unlock/support/tip/live-pass/ticket intent and completion
- share/referral click and conversion
- creator dashboard usage
- report/block/safety actions
- dating opt-in, match creation, stale/closed matches
- event ticket purchase and check-in

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
- ticket receipt/check-in reminder
- referral commission state change
- dating match and one first-reply nudge
- safety/report/admin decision

Disallowed launch notifications:

- spammy dating nudges
- addictive infinite-feed pressure
- hidden paid ranking prompts
- repeated unpaid creator promotion pressure

## Research-Backed Product Constraints

The June 2026 build plan assumes:

- Social video is a huge market, but discovery must include user control, break states, reporting, and non-addictive defaults.
- EU DSA-style recommender transparency means users need meaningful feed controls and a non-profiling/chronological option where required.
- Age assurance for adult services must be real, provider-backed, and privacy-minimizing; self-declaration is not enough.
- Ticketing must show all fees before confirmation and avoid dark patterns around checkout.
- Dating must reduce ghosting/overwhelm with active-match limits, stale-match cleanup, consent rules, report/block tooling, and gentle notifications.

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
