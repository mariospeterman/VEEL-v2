# Analytics Core

Status: accepted
Scope: deterministic derived metrics, authorization, privacy, freshness, reconciliation, and insight projections
Last updated: 2026-08-23
Source of truth: yes for Convergence 03 product behavior

Owns:
- versioned metric definitions and typed aggregate projections
- structured authorized metric queries, freshness, privacy suppression, comparison, and deterministic insights
- projection backfill, late-fact handling, reconciliation evidence, and analytics operations visibility

Defers to:
- canonical domain tables and services for identity, content, social, money, access, safety, provider, and operations facts
- OpenAPI for public request and response shapes
- migrations for projection constraints, indexes, retention, RLS, and worker leases
- organization agreements, staff RBAC, tiers, and entitlements for authorization truth

Does not own:
- transactional domain state, settlement, balances, entitlements, moderation, identity, KYC/KYB, provider state, ranking, or arbitrary reporting queries

Launch scope:
- one backend metric registry, typed daily projections and watermarks, deterministic backfill/reconciliation, one structured query service, and the minimum operations surface required before Analytics surfaces

Non-goals:
- a warehouse, generic analytics event bus, EAV metric store, browser formulas, raw SQL/export, individual audience lists, private-message analysis, hosted LLM, or guaranteed-performance claims

## Authority Contract

The architecture is fixed:

```text
canonical domain facts
-> typed Analytics Core projections
-> one authorized query service
-> dashboards / exports / MCP / deterministic insights
```

Analytics is a derived read authority. It never mutates or overrides the underlying domain fact.
A dashboard, export, future MCP resource, and deterministic insight requesting the same authorized
metric with the same scope, window, timezone, and filters must receive the same definition version,
value, numerator, denominator, sample size, dimensions, data-through time, and privacy decision.

Current account, entitlement, KYC, wallet, plan, queue item, payment intent, and provider status
remain direct domain queries. Trends, rates, totals, comparisons, and cohorts belong to Analytics Core.

## Canonical Fact Matrix

| Metric family | Canonical fact source |
| --- | --- |
| Account activation | user, profile, age, and wallet state transitions |
| Impressions | canonical bounded feed-impression records |
| Qualified views and watch time | playback sessions and bounded heartbeats |
| Engagement | reactions, saves, comments, shares, and follows |
| Content supply | canonical publication state |
| Creator earnings | posted payment-ledger entries |
| Platform revenue | posted platform-fee ledger entries |
| Referral | confirmed referral-commission records |
| Enterprise allocation | confirmed managed-creator allocation records |
| Purchases | confirmed PaymentIntent and settlement facts |
| Access | entitlements and subscription state |
| Live | live-room, attendance, and access facts |
| Event Access | passes, check-ins, and confirmed settlement |
| Tier usage | platform usage windows and playback sessions |
| Safety | minimized report, moderation, hide, and block aggregates |
| Operations | provider events, worker queues, and OpenTelemetry |

Audit logs, notifications, browser callbacks, frontend caches, MCP output, and AI output are never a
metric source when a stronger domain fact exists. A new append-only fact is allowed only when the
domain genuinely lacks it and must carry idempotency, actor/subject, event and ingestion time, source
version, privacy class, and bounded typed metadata. Audit events do not become a universal analytics
event store.

## Metric Registry

One typed backend registry defines each metric with:

- stable key and explicit definition version;
- label, description, unit, source owner, and supported scope types;
- numerator and denominator definitions;
- aggregation and attribution window;
- default and allowed granularities;
- freshness target and minimum cohort size;
- privacy class and an allowlist of dimensions.

Formulas are code-reviewed definitions, not mutable browser/admin JSON. A definition change requires
a version bump, changelog, migration/backfill decision, parity tests, and consumer schema/label review.
Audited business targets and thresholds remain separate policy records.

Money metrics count confirmed, posted records only. SOL and USDC are returned separately. A future
reporting-currency value requires an approved source, timestamp, rate, original amount/currency, and
conversion version. Refunds and reversals are explicit; no analytic result is a balance.

## Typed Projections And Worker

Initial projections are typed and indexed rather than one generic `metric_name/dimension_json/value`
table. The schema audit may select only the projection families justified by callers, drawn from:

- creator-content daily;
- creator daily;
- user-usage daily;
- organization-creator daily;
- organization daily;
- tier daily;
- platform daily;
- metric watermarks and reconciliation runs.

The existing worker runtime owns bounded leased batches, incremental watermarks, idempotent reruns,
late-arriving facts, retry/dead-letter behavior, deterministic backfill, and source reconciliation.
Reconciliation reports discrepancies and alerts; it never silently rewrites unexplained differences.
Hourly rollups require measured near-realtime value. A warehouse requires measured OLTP pressure,
rollup duration, query latency, volume, or retention/cost evidence and is not a launch authority.

## Query And Authorization

One `AnalyticsQueryService` accepts a closed structured query: metric keys, bounded window and
comparison, allowed granularity/timezone, and allowlisted dimensions such as content format/id,
creator, organization, tier, currency, or product type. It never accepts SQL, table names, arbitrary
dimensions, unbounded dates, or unbounded raw export.

Every result includes metric key and definition version, label/unit, value, optional numerator and
denominator, sample size, comparison, window/timezone, normalized dimensions, `dataThrough`,
`generatedAt`, freshness state, and the applied privacy decision.

Authorization is resolved before query execution from the canonical actor, staff role, organization
membership/role, managed-creator relationship and agreement, granted permissions, tier, and purpose.
Creators see only their own profile/content. Enterprise queries require an active entitlement,
membership, accepted agreement, exact granted analytics permission, and active creator consent.
Staff queries require an active role; individual drilldown also requires a purpose code and audit.
Browser parameters cannot broaden any scope.

## Privacy And Freshness

Aggregate audience metrics enforce minimum cohorts and suppression. The service never exposes
individual viewer lists, sensitive-trait or hidden-demographic inference, cross-creator audience
identity, raw age/KYC evidence, or private-message analysis. Retention and export/delete behavior
must remain compatible with the canonical privacy workflows.

Near-realtime means an explicit watermark, `dataThrough`, lag, and visible stale state. Initial
staging targets to validate are under 60 seconds for creator/user current-period projections, under
two minutes for organization/platform aggregates, and under 500 ms p95 for ordinary dashboard
windows. They are targets, not production claims, until measured.

## Deterministic Insights

The initial insight engine is non-LLM. It consumes only canonical metric results, declared baselines,
minimum sample sizes, confidence rules, and product policy. Output states an observation, evidence,
comparison window, confidence and uncertainty, one bounded experiment, expected direction, success
metric, and expiry. It does not claim causation, promise virality, or recommend when evidence is
insufficient.

## Operations And Proof

The slice must inventory every current backend/frontend metric calculation before replacing it and
record current owner, formula, source, window, currency, freshness, authorization, consumers,
duplication, and target owner. Admin operations expose watermark lag, batch/retry/dead-letter state,
backfill and reconciliation status, version mismatches, and privacy suppression counts without raw
PII or provider payloads.

Acceptance proves definition versioning, raw-source parity, duplicate and late facts, deterministic
rerun/backfill, reconciliation mismatch, timezone/DST and comparison windows, zero denominators,
minimum-cohort suppression, native-currency separation, refunds/reversals, tier changes,
managed-creator consent/revocation, staff and tenant isolation, freshness/stale watermarks, and that
frontend consumers do not calculate metrics independently.
