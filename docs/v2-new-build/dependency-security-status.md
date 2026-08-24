# Production Dependency Security Status

Status: accepted
Release status: accepted; current production graph has no known audit findings
Scope: current production dependency advisories, reachability, mitigation, and release ownership
Last updated: 2026-08-24
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

The Node.js `22.16.0` production audit on 2026-08-24 reports zero critical, high, moderate, low, or informational vulnerable installed instances. There are no accepted or deferred production advisories.

## Removed Findings

- `GHSA-3gc7-fjrx-p6mg` is absent from the current lock graph. The API replaced legacy `@solana/spl-token@0.4.15` and its unpatched `bigint-buffer` chain with the official generated `@solana-program/token@0.15.0` client compatible with the pinned `@solana/kit@7.1.0`. One server-only bridge converts official generated instructions to the existing audited `@solana/web3.js` transaction boundary and decodes only canonical token-account base fields. Checked SPL/USDC transaction, associated-account, recurring-authorization, settlement-verification, dependency-policy, type, and unit proofs are green.
- `GHSA-w5hq-g745-h8pq` is absent from the current lock graph. The root resolution policy maps UUID releases `>=8.0.0 <11.1.1` to patched `11.1.1`; full typecheck, unit, provider-boundary, build, and browser proof are required on every change because this crosses upstream major ranges.
- `GHSA-w3rx-r6r6-pgpr` and `GHSA-5p2g-fcmc-qvqq` are absent from the current lock graph. pnpm automatic peer installation is disabled, so the browser PWA does not install unused React Native, Metro, or `image-size` packages. Required Solana codec and Stripe peers are direct exact dependencies of the services that execute them.
- `pnpm deps:check` fails if automatic peers are re-enabled, if those unused mobile packages or UUID 8–10 return to `pnpm-lock.yaml`, or if the explicit runtime peers drift.

## Release Rule

Every dependency change reruns `pnpm install --frozen-lockfile`, `pnpm deps:check`, the complete test/build/browser gates, and `pnpm audit --prod`. Production promotion requires either a patched/replaced graph or explicit security acceptance tied to the immutable staging-proven artifact. A local reachability inference alone cannot approve production.
