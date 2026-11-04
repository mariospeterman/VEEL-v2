# Production Dependency Security Status

Status: accepted
Release status: conditional; one provider-owned advisory requires explicit artifact-specific security acceptance
Scope: current production dependency advisories, reachability, mitigation, and release ownership
Last updated: 2026-11-04
Source of truth: yes

Owns:
- the reviewed result of `pnpm audit --prod` for the pinned current production graph
- advisory-chain, runtime-reachability, mitigation, owner, and review-date truth

Defers to:
- `package.json` and `pnpm-lock.yaml` for the installed graph
- GitHub Security Advisories for vulnerability details and patched-version truth
- provider ADRs for dependency or provider replacement decisions

Does not own:
- provider behavior, payment authority, or runtime request validation

Launch scope:
- Launch 01 dependency-warning closure and pre-production release gating

Non-goals:
- treating an apparently unreachable path as resolved
- forcing unsupported transitive major upgrades only to make the audit count zero

## Current Audit

The Node.js `22.23.4` production audit on 2026-11-04 reports zero critical, moderate, or low findings and two high installed instances belonging to one advisory: `GHSA-mrhx-c7xc-m3w5` in `zod@3.25.76`. The two instances enter through the exact current provider roots `@coinbase/cdp-sdk@1.60.0` and `@privy-io/react-auth@3.51.1`/`x402@0.7.3`.

The patched line begins at Zod `4.6.6`; Zod `3.25.76` is the latest v3 release, and both current provider releases still declare the v3 major. A root Zod 4 override would violate those provider ranges and is not an accepted compatibility fix.

## Time-Limited Accepted Advisory

- Advisory: `GHSA-mrhx-c7xc-m3w5` / `CVE-2023-54404`.
- Impact: availability risk from excessive memory use in affected collection parsing paths; it is not treated as resolved merely because current reachability is narrow.
- Current API reachability: WeVid imports only `generateJwt` from the Coinbase SDK's isolated `@coinbase/cdp-sdk/auth` export. The installed auth import graph has no Zod edge. Any new Coinbase root import invalidates this assessment.
- Current browser reachability: WeVid uses Privy authentication, passkey, OAuth, and Solana-wallet hooks. The affected x402 payment wrapper is lazy and unused; any `x402` or payment-fetch-wrapper activation invalidates this assessment.
- Owner: Platform/Security.
- Review expiry: 2026-11-18 or the next Coinbase CDP/Privy provider release, whichever occurs first.
- Required action: recheck provider releases and upstream remediation, retain the import-boundary tests, and replace this acceptance with a patched compatible graph as soon as one exists.
- Promotion rule: production promotion requires named security acceptance tied to the exact immutable staging-proven artifact. CI must allow only this exact advisory until the expiry; it must not blanket-ignore audit failures.

## Removed Findings

- `GHSA-3gc7-fjrx-p6mg` is absent from the current lock graph. The API replaced legacy `@solana/spl-token@0.4.15` and its unpatched `bigint-buffer` chain with the official generated `@solana-program/token@0.15.0` client compatible with the pinned `@solana/kit@7.1.0`. One server-only bridge converts official generated instructions to the existing audited `@solana/web3.js` transaction boundary and decodes only canonical token-account base fields. Checked SPL/USDC transaction, associated-account, recurring-authorization, settlement-verification, dependency-policy, type, and unit proofs are green.
- `GHSA-w5hq-g745-h8pq` is absent from the current lock graph. The root resolution policy maps UUID releases `>=8.0.0 <11.1.1` to patched `11.1.1`; full typecheck, unit, provider-boundary, build, and browser proof are required on every change because this crosses upstream major ranges.
- `GHSA-w3rx-r6r6-pgpr` and `GHSA-5p2g-fcmc-qvqq` are absent from the current lock graph. pnpm automatic peer installation is disabled, so the browser PWA does not install unused React Native, Metro, or `image-size` packages. Required Solana codec and Stripe peers are direct exact dependencies of the services that execute them.
- `GHSA-3g3m-2fjr-6pw4` and `GHSA-g3hv-75wg-m249` are absent from the production graph. `gaxios@7.1.3` declared build-only `rimraf@5` as a runtime dependency even though its shipped build never imports it; the exact scoped pnpm removal `gaxios@7.1.3>rimraf: -` removes the vulnerable glob/minimatch chain without forcing incompatible major overrides.
- The patched Node `22.23.4`, Next.js `16.4.5`, and sharp `0.35.5` lines replace the pre-advisory runtime pins. Compatible direct/provider upgrades and narrowly scoped transitive resolutions are exact and lockfile-enforced.
- `pnpm deps:check` fails if automatic peers are re-enabled, if unused mobile packages or UUID 8–10 return to `pnpm-lock.yaml`, if the gaxios/rimraf pruning disappears, if security resolutions drift, or if exact runtime/provider pins change without review.

## Release Rule

Every dependency change reruns `pnpm install --frozen-lockfile`, `pnpm deps:check`, the complete test/build/browser gates, and `pnpm audit --prod`. Production promotion requires either a patched/replaced graph or explicit security acceptance tied to the immutable staging-proven artifact. A local reachability inference alone cannot approve production, and any new advisory is a release blocker until separately triaged.
