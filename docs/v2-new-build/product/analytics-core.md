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

Implemented boundary:
- migration `0110_analytics_core.sql` owns viewer, creator, creator-content, creator-product, organization-creator, platform-commerce, platform-operations, retention-cohort, and onboarding-funnel daily projections plus bounded typed profile-open, offer-impression, and onboarding-journey facts; versioned jobs, watermarks, reconciliation evidence, and privacy-suppression counters remain server-only
- `POST /v1/analytics/query` accepts only registered v1 metric keys, a maximum of 20 unique metrics, bounded windows up to 366 days, `day` or `total` granularity, explicit UTC, and allowlisted dimensions
- `POST /v1/analytics/onboarding-events` accepts only the closed lifecycle vocabulary, a random journey UUID, a bounded idempotency key, and a recent timestamp. It stores no email, wallet address, signature, provider token, identity document, raw provider payload, or arbitrary metadata; delivery never controls product behavior.
- viewer results are self-only, creator results are self-only, Enterprise results recheck active membership/entitlement/agreement authority, and platform results require active staff plus a bounded purpose code
- audience-derived results require a conservative cohort of at least five; suppressed values also suppress numerator and denominator, native-value metrics require explicit `SOL` or `USDC` without conversion, and every count/seconds/minor-unit scalar is serialized as a lossless decimal string
- the existing worker runtime recomputes bounded two-day UTC windows transactionally so duplicate and late facts converge; retries, dead letters, parity evidence, and watermarks are exposed through `GET /v1/admin/analytics/health`
- staff can enqueue an audited, idempotent, maximum-366-day backfill or reconciliation through `POST /v1/admin/analytics/jobs`; the admin browser surface exposes both health and this bounded command without permitting direct projection edits

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

## Existing Calculation Inventory

The Convergence 03 repository audit classifies the existing calculations before schema or consumer
replacement. `KEEP_DIRECT` means the value is current domain or operational state and must not be
copied into Analytics Core. `ANALYTICS_CORE` means the current ad-hoc aggregate becomes a registry
metric and typed projection. `FACT_SOURCE` means the existing durable record remains canonical input
without becoming a public metric by itself.

| Current owner / consumer | Current calculation and source | Classification | Target owner and migration rule |
| --- | --- | --- | --- |
| Creator dashboard readiness | Current profile, creator settings, recipient wallet, age/KYC and tax state; backend computes a five-check readiness percentage | `KEEP_DIRECT` | Profile/readiness policy stays authoritative. The percentage remains a presentation of current readiness state, not a trend metric. |
| Creator dashboard earnings | Posted `creator_earning` and related `platform_fee` ledger sums, referral commission sum, and distinct confirmed-payment count; currently returned as one hard-coded SOL group | `ANALYTICS_CORE` | Registry-backed creator revenue/payment metrics replace the ad-hoc aggregate. Results group by native currency and explicit ledger state; SOL and USDC are never combined. |
| Creator product summaries | Confirmed PaymentIntent count and amount grouped by normalized product type | `ANALYTICS_CORE` | Registry-backed purchase count and confirmed gross amount by product type/currency. Existing enablement flags stay direct creator-settings state. |
| Creator recent activity | Latest PaymentIntent rows and receipt/confirmation state | `KEEP_DIRECT` | Activity repository remains the current transaction/read authority; Analytics Core must not become a payment-history API. |
| Managed-creator reporting | Confirmed allocation count and creator-side, creator-net and management sums grouped by currency | `ANALYTICS_CORE` | Organization-creator daily projection consumes confirmed allocation facts. Authorization continues to require the canonical active relationship, membership, entitlement, agreement permission and creator consent. |
| Content engagement counters | Transactional like/comment/share counters used by renderers and deterministic feed ranking | `KEEP_DIRECT` + `FACT_SOURCE` | Counter projection stays the low-latency content/read-model authority. Daily analytics derive from reaction/comment/share facts and reconcile to counters; analytics never feeds ranking. |
| Feed impression intake | Bounded idempotent impression receipts and viewer-content impression state | `FACT_SOURCE` | Impression facts feed creator-content daily projections. Viewer identities are never exposed through analytics, and ranking continues to use its own bounded viewer state. |
| Playback usage | Credited heartbeat seconds, playback sessions and monthly platform-usage windows used to enforce tier allowance | `KEEP_DIRECT` + `FACT_SOURCE` | Subscription/platform access keeps synchronous allowance authority. Analytics consumes credited heartbeats/session facts for watch-time and usage trends without changing allowance state. |
| Publication and access state | Current content publication, entitlement, subscription, Event Access Pass and live-room state | `KEEP_DIRECT` + `FACT_SOURCE` | Domain repositories remain current-state authority; analytics derives bounded counts/trends only. |
| Web Vitals and OpenTelemetry | Privacy-minimized browser performance histograms plus API/worker traces and queue/provider diagnostics | `KEEP_DIRECT` | Observability remains operational telemetry, not user/creator product analytics and not a cohort/audience source. |
| Admin operations dashboards | Current queues, retries, dead letters, provider health and support/payment state | `KEEP_DIRECT` | Existing admin repositories remain operational truth. Analytics ops adds only projection watermark, reconciliation, version and suppression health. |
| MCP creator metrics tool | Currently aliases the creator monetisation dashboard response | `ANALYTICS_CORE_CONSUMER` | The tool must consume the same authorized structured metric objects as web surfaces; it cannot keep a parallel formula or broaden scope. MCP protocol expansion remains Convergence 07. |
| Web profile and Studio surfaces | Format backend amounts/counts and render readiness/allocation values; no independent aggregate query exists | `ANALYTICS_CORE_CONSUMER` | Convergence 04 replaces aggregate cards with generated-client Analytics Core results. Formatting remains presentation-only; no numerator, denominator, comparison or currency formula moves to the browser. |

Inventory drift rules:

- current payment, entitlement, allowance, readiness, queue and provider-status lookups stay direct;
- historical totals, rates, trends, comparisons and cohorts use only `AnalyticsQueryService`;
- source facts are deduplicated by their existing canonical keys before projection;
- no migration may delete an ad-hoc calculation until parity is proven against the same bounded source
  window, currency and authorization scope;
- no frontend or MCP consumer may infer a suppressed numerator, denominator or audience identity.

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
table. Convergence 03 selects only the families required by its registry: viewer daily, creator daily,
creator-content daily, creator-product daily, organization-creator daily, platform-commerce daily,
platform-operations daily, retention cohort daily, and onboarding-funnel daily. Public, anonymous, and authenticated database
roles receive no direct table privileges; RLS remains enabled as defense in depth and consumers use
the authorized API rather than PostgREST projection access.

Anonymous onboarding events are rate-limited, allowlisted observational telemetry. They are never
identity, entitlement, payment, compliance, or other business authority.

The existing worker runtime owns bounded leased batches, incremental watermarks, idempotent reruns,
late-arriving facts, retry/dead-letter behavior, deterministic backfill, and source reconciliation.
The initial schedule replaces each selected two-day UTC window in one transaction, records a
versioned reconciliation run, and advances the watermark only after the recomputation commits. A queue
lease may be retried or recovered by an audited admin action, while a bounded staff command can enqueue
a backfill or reconciliation with exact idempotency-key/request-hash replay semantics. Neither path edits
projection values or canonical facts directly.
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
