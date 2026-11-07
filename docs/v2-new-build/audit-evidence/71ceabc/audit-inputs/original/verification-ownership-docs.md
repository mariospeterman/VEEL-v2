# Independent ownership/provider/documentation validation — 4 November 2026

Source: `wevid-complete` at `71ceabcfaa8a5258e1b935a391ff4e6e7330c682`. This pass makes no application edits and no provider-dashboard changes. It validates the existing audit recommendation, rather than claiming another complete repository review.

## Verdict

The existing recommendation is appropriate: keep managed provider media delivery, strengthen explicit creator rights and portability, offer an ordinary one-action asynchronous content export, and keep noncustodial Solana payments separate from storage rights. Provider account control, copyright, performer consent, wallet ownership and platform legal duties are separate matters. A wallet signature or NFT cannot establish all of them. No source reviewed establishes an ownership architecture that automatically exempts this platform from liability.

There is no verified Bunny-native delegated creator OAuth/account-transfer flow in the official Stream authentication documentation reviewed here. The positive documented mechanism is per-library API keys. A library created inside WeVid's account remains operationally controlled by that account. This is a documentation verification limit, not a proof that Bunny could never offer a custom agreement. Do not invent an unsupported API or ask ordinary creators to supply provider credentials.

The privacy-request UI is not a completed content-export implementation: repository search finds data request records and status controls, but no retained-original content export worker or portable restoration path. The existing instruction correctly treats that as work to implement, not a current product capability.

## Two precise refinements to add to the handoff

1. **Separate original retention from original exposure.** The current Bunny API documents `KeepOriginalFiles`, `ExposeOriginals`, and `AllowEarlyPlay` separately. Exposed originals are not DRM protected, and enabling Early-Play also enables exposure. Retention for creator portability must not accidentally enable publicly accessible originals. Require an explicit library setting/proof check, private/authorized original access, and tests that ordinary/public users cannot obtain original files. This is a proposed configuration hardening requirement; no live Bunny configuration was available to inspect, so it is not a confirmed live exposure.
2. **Label exported bytes accurately.** `apps/api/src/modules/content/image-sanitizer.ts:49-51,66-71,100-106` rotates and re-encodes images, strips metadata and emits a new retained byte stream. That is a sanitized retained asset, not necessarily the byte-for-byte uploaded source original. The export manifest should label source original, sanitized retained original, and rendition distinctly, with hashes for the actual bytes exported. Do not undo image safety/privacy handling merely to advertise original retention. If source-byte preservation is desired, propose its security, retention and cost policy explicitly first.

Useful export acceptance detail: pin a consistent authorized inventory/revision for a job; handle edit/delete/retire races; recheck export/download authorization and relevant account/safety policy; avoid a long-lived export link becoming a second access authority. These are implementation guidance, not new reproduced defects.

## Current primary sources checked

| Source | Verified relevant fact | Retrieval detail |
|---|---|---|
| https://bunny.net/docs/stream/storage-structure | `/original` URL exists only when original retention was configured | Current page modified 11 June 2026; opened directly |
| https://docs.bunny.net/reference/videolibrarypublic_update | Separate `KeepOriginalFiles`, `ExposeOriginals`, `AllowEarlyPlay`; originals exposure is not DRM protection | Current official API reference search result; recheck canonical redirected endpoint before code changes |
| https://bunny.net/docs/stream/security | Embed tokens and direct CDN tokens protect different surfaces; CDN token checks apply to playlists/segments, MP4, thumbnails and previews | Page modified 2 November 2026; opened directly |
| https://bunny.net/docs/stream/security-options | HLS direct paths need path-style protection for segment access; domain restrictions are separate | Page modified 20 October 2026; opened directly |
| https://bunny.net/docs/stream/authentication | Stream HTTP API uses per-library keys | Page modified 19 May 2026; opened directly |
| https://bunny.net/acceptable-use/ | Adult use is conditional on applicable terms/law; unapproved short live streaming is disallowed; client bears content responsibility under provider terms | Opened current AUP |
| https://bunny.net/tos/ | Provider distribution license does not transfer client intellectual-property ownership | Official provider source search result |
| https://livepeer.studio/terms-of-service | Broad content restrictions include obscene/otherwise objectionable content; no explicit blanket adult-use approval | Opened current terms; displayed update 20 November 2023 |
| https://docs.privy.io/wallets/overview | Embedded and external Solana wallets supported; API also supports server-controlled use | Opened current docs |
| https://docs.privy.io/security/wallet-infrastructure/policy-and-controls | Configurable owners, quorums and signers permit user-controlled or service-controlled models | Opened current docs; provider branding is insufficient to prove the deployed control model |
| https://solana.com/docs/tools/solana-pay | Solana Pay links/QRs and transaction requests support ordinary wallet integration | Current official Solana docs |
| https://solana.com/docs/tools/solana-pay/quickstart/transaction-requests | Current example uses `@solana/pay@beta` plus `@solana/kit`, unlike older `docs.solanapay.com` examples | Search result from official Solana Foundation docs/source; exact API/version compatibility must be checked before migration |

The Livepeer recommendation is a cautious inference from its current managed-service terms: obtain exact-use acceptance or retain the adult-live disabled gate. It is not an assertion that permissionless Livepeer protocol participation and Livepeer Studio managed-service acceptance are interchangeable.

## Scope actually read in this independent pass

Fully read:
- `apps/api/src/modules/content/media-upload-adapter.ts`
- `apps/api/src/modules/content/image-sanitizer.ts`
- `apps/worker/src/media-asset-cleanup.ts`
- `docs/v2-new-build/providers/content-protection.md`
- `docs/v2-new-build/media-live-providers.md`
- `docs/v2-new-build/providers/provider-map.md`
- `docs/v2-new-build/product/mcp-media-provenance-bridge.md`
- Existing Codex instruction's ownership/docs/validation/completion sections.

Reviewed existing `docs-audit.md` and selected instruction passages for architecture/documentation cleanup. Used full-repository literal searches to check original-setting references and export implementation candidates. Search absence is not a claim that every file was reread here. Existing per-file coverage evidence remains the full audit's coverage authority; this independent pass should be identified as a narrower verification pass.

No hosted provider export/delete tests or legal applicability determination were performed. No source edits, payments, deployments, or production writes occurred.
