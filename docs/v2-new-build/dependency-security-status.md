# Production Dependency Security Status

Status: accepted
Release status: code-complete evidence; production security acceptance blocked
Scope: current production dependency advisories, reachability, mitigation, and release ownership
Last updated: 2026-08-16
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

The Node.js `22.16.0` production audit on 2026-08-16 reports zero critical, one high, zero moderate, zero low, and zero informational vulnerable installed instances. The remaining advisory is the unpatched `bigint-buffer` package in the official SPL Token dependency graph.

| Advisory | Chain and runtime | Reachability and impact in WeVid | Current mitigation and fix truth | Owner / next review |
| --- | --- | --- | --- | --- |
| [`GHSA-3gc7-fjrx-p6mg`](https://github.com/advisories/GHSA-3gc7-fjrx-p6mg), `bigint-buffer@1.1.5`, high | API → `@solana/spl-token@0.4.15` → `@solana/buffer-layout-utils@0.3.0` → `bigint-buffer`. It is in the server production graph used to compose checked SPL/USDC transfers. | The advisory describes an application crash through `toBigIntLE`. WeVid does not expose caller-selected buffers or this function directly, but the package is reachable through a money path, so it is not classified as harmless. | No patched npm version exists. Amounts and token metadata remain contract-validated and backend-owned; request rate limits and process health/restart controls reduce availability impact. Production remains blocked on a supported Solana dependency replacement, an upstream fix, or documented staging proof plus explicit security acceptance. | Payments/provider dependencies; 2026-09-15 |

## Removed Findings

- `GHSA-w5hq-g745-h8pq` is absent from the current lock graph. The root resolution policy maps UUID releases `>=8.0.0 <11.1.1` to patched `11.1.1`; full typecheck, unit, provider-boundary, build, and browser proof are required on every change because this crosses upstream major ranges.
- `GHSA-w3rx-r6r6-pgpr` and `GHSA-5p2g-fcmc-qvqq` are absent from the current lock graph. pnpm automatic peer installation is disabled, so the browser PWA does not install unused React Native, Metro, or `image-size` packages. Required Solana codec and Stripe peers are direct exact dependencies of the services that execute them.
- `pnpm deps:check` fails if automatic peers are re-enabled, if those unused mobile packages or UUID 8–10 return to `pnpm-lock.yaml`, or if the explicit runtime peers drift.

## Release Rule

Every dependency change reruns `pnpm install --frozen-lockfile`, `pnpm deps:check`, the complete test/build/browser gates, and `pnpm audit --prod`. Production promotion requires either a patched/replaced graph or explicit security acceptance tied to the immutable staging-proven artifact. A local reachability inference alone cannot approve production.
