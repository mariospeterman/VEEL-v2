# Production Dependency Security Status

Status: accepted
Scope: current production dependency advisories, reachability, mitigation, and release ownership
Last updated: 2026-08-15
Source of truth: yes

Owns:
- the reviewed result of `pnpm audit --prod` for the pinned Launch 01 graph
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

The Node.js `22.16.0` production audit on 2026-08-15 reports zero critical, three high, two moderate, zero low, and zero informational vulnerable installed instances. Those instances map to four advisory records. The Solana Web3/Jayson `uuid` instance was moved to patched `uuid@11.1.1`; the remaining `uuid` instances enter through Privy's bundled EVM/MetaMask connector graph.

| Advisory | Chain and runtime | Reachability and impact in WeVid | Current mitigation and fix truth | Owner / next review |
| --- | --- | --- | --- | --- |
| [`GHSA-3gc7-fjrx-p6mg`](https://github.com/advisories/GHSA-3gc7-fjrx-p6mg), `bigint-buffer@1.1.5`, high | API → `@solana/spl-token@0.4.15` → `@solana/buffer-layout-utils@0.3.0` → `bigint-buffer`. It is in the server production graph used to compose checked SPL/USDC transfers. | The advisory describes an application crash through `toBigIntLE`. WeVid does not expose caller-selected buffers or this function directly, but the package is reachable through a money path, so it is not classified as harmless. | No patched npm version exists. Amounts and token metadata remain contract-validated and backend-owned; request rate limits and process health/restart controls reduce availability impact. Production remains blocked on a supported Solana dependency replacement, an upstream fix, or documented staging proof plus explicit security acceptance. | Payments/provider dependencies; 2026-09-15 |
| [`GHSA-w5hq-g745-h8pq`](https://github.com/advisories/GHSA-w5hq-g745-h8pq), `uuid@8.3.2` and `9.0.1`, moderate | Web → `@privy-io/react-auth@3.37.0` → `x402`/Wagmi → MetaMask connector packages → `uuid`. The affected connector code is packaged transitively with the identity SDK. | The flaw requires the `v3`, `v5`, or `v6` API with a caller-provided undersized buffer or invalid offset. WeVid has no such call and exposes only Privy's approved email/social/passkey and Solana wallet surfaces; the EVM/MetaMask connector is not a WeVid login or wallet option. | A patched version exists, but forcing all upstream packages across unsupported `uuid` majors is not accepted. The directly compatible Jayson chain is pinned to `11.1.1`. Upgrade Privy and its connector graph when it adopts patched versions, or replace the dependency before production if staging bundling/reachability proof cannot isolate it. | Identity-provider dependencies; 2026-09-15 |
| [`GHSA-w3rx-r6r6-pgpr`](https://github.com/advisories/GHSA-w3rx-r6r6-pgpr), `image-size@1.2.1`, high | Web → Solana wallet-adapter React → Solana Mobile Wallet Adapter → React Native Metro CLI → `image-size`. This is Metro tooling pulled into the production dependency graph, not WeVid's server media parser. | The advisory requires a crafted ICNS buffer to be processed by `image-size`. WeVid does not import `image-size`, run Metro in the deployed Next.js service, or pass uploads to this chain. It is still tracked because the vulnerable package remains installed. | No patched npm version exists. WeVid's media upload/probe path remains provider-backed and separate. Replace or upgrade the Solana adapter graph when supported; staging must also prove the package is absent from executable server/browser artifacts before any security acceptance. | Wallet-provider dependencies; 2026-09-15 |
| [`GHSA-5p2g-fcmc-qvqq`](https://github.com/advisories/GHSA-5p2g-fcmc-qvqq), `image-size@1.2.1`, high | Same Solana Mobile Wallet Adapter → React Native Metro CLI chain as the ICNS advisory. | The advisory requires a crafted JXL/HEIF buffer to be parsed by the transitive Metro utility. No WeVid request or upload route calls this package. | Same no-patch and replacement requirement as the ICNS advisory. Artifact reachability proof is a pre-production security gate, not permission to erase the finding. | Wallet-provider dependencies; 2026-09-15 |

## Release Rule

Every dependency change reruns `pnpm install --frozen-lockfile`, the complete test/build/browser gates, and `pnpm audit --prod`. Production promotion requires either a patched/replaced graph or explicit security acceptance tied to the immutable staging-proven artifact. A local reachability inference alone cannot approve production.
