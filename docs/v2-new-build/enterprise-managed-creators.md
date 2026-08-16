# Enterprise Managed Creators

Status: accepted
Scope: Launch 09 implementation contract
Last updated: 2026-08-16

## Product Boundary

Enterprise is an organization capability attached to universal WeVid accounts. It does not create a second creator identity, shared password, custodial balance, withdrawal system, payout queue, or preferential social treatment.

The launch journey is:

1. operations provisions an organization under an approved commercial process and invites an existing WeVid account as owner;
2. organization KYB is completed through the selected provider path;
3. an independent Enterprise entitlement is activated by contract/subscription/waiver authority;
4. an owner or admin invites existing WeVid accounts into team roles;
5. an owner or admin proposes a managed-creator relationship with explicit permissions and an exact management share;
6. the creator accepts or declines on their own account;
7. changed terms remain proposed until the creator accepts them;
8. eligible new payment intents resolve the accepted management allocation directly to the ownership-proven organization wallet;
9. either authorized party can terminate prospectively; historical payment and reporting records remain immutable.

The invited owner must accept before managing the organization or starting KYB. KYB never grants Enterprise by itself. Enterprise entitlement never grants creator management. An invitation never grants permissions. Wallet approval never proves payment.

## Team Roles

- `owner`: manages non-owner roles, organization operations, managed creators, and KYB initiation.
- `admin`: invites team members and managed creators where backend policy allows; cannot alter an owner through the member workspace.
- `member`: uses explicitly enabled team capabilities.
- `viewer`: reads permitted organization and reporting projections.

Team invitations target an existing WeVid handle and require acceptance. The current launch API does not create shadow users or email-only identities.

## Managed-Creator Agreement

Every relationship has a versioned agreement containing:

- creator-approved permissions;
- creator share basis points;
- Enterprise management share basis points;
- an exact commercial agreement version and terms hash;
- proposer and creator acceptance evidence;
- effective and end timestamps.

The creator and management shares always total exactly 10,000 basis points. Changed terms do not mutate the accepted agreement in place. A new agreement version is inert until creator acceptance.

## Allocation And Reporting

The payment-intent authority resolves a management allocation only when all of these are current:

- active managed-creator relationship;
- accepted effective agreement;
- `revenue_allocation` permission;
- normalized, unexpired organization `org_kyb` verification record;
- active Enterprise entitlement;
- active ownership-proven organization settlement wallet for the payment chain.

Confirmed reporting is grouped by asset and is derived from immutable allocation records. It is evidence, not a balance. No browser or organization member can withdraw, release, queue, or redirect funds through the reporting surface.

## Idempotency And Audit

Organization provisioning plus relationship, agreement, team-role, and termination mutations use durable server-only `enterprise_action_receipts`. Reusing a key with a different normalized request fails with `409`. Every access- or revenue-authority change writes a separate audit-ledger event. Notifications and audit-visible operational counts are written without exposing raw KYB payloads, provider secrets, or private wallet material.

The provisioning boundary is `POST /v1/admin/organizations`. It requires an authorized administrator, an existing WeVid owner handle, a reason, and an idempotency key. It creates only a pending-KYB organization plus an invited owner membership; it never creates an account, activates Enterprise, or marks KYB complete.

## Provider And Release Gate

Local mocks prove application behavior only. Run:

```bash
pnpm proof:enterprise
```

The proof requires a staging application session plus organization, relationship, redacted KYB evidence, and approved Enterprise contract evidence identifiers. It verifies the member dashboard, normalized KYB state, independent Enterprise entitlement, accepted creator agreement, settlement-wallet readiness, and allocation reporting projection. Missing configuration returns `CODE_COMPLETE_PROVIDER_BLOCKED`; it never fabricates approval.

Production remains disabled until real KYB callbacks, approved commercial evidence, organization domains, provider configuration, and the complete staging journey are recorded against the exact release artifact.
