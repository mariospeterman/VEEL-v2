# WeVid Staging Acceptance Matrix

Status: accepted
Scope: operator-readable view of the canonical machine-readable staging acceptance manifest
Last updated: 2026-11-04
Source of truth: no — generated from `staging-acceptance.json`

Committed values below are requirements, not results. `staging:acceptance` derives `PASS`, `FAIL`, `BLOCKED`, or `NOT_RUN` from the named proof outcomes and an exact-release journey receipt. Only a capability declared optional here may become `DEFERRED`, and only while that capability is disabled.

| Journey | Role | Route | Provider | Required capabilities | Named proofs | Optional capability | Blocker when unavailable |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `auth.continue_to_wevid` | visitor_or_returning_user | `/?mode=login` | Privy, Wallet Standard | `core`, `supabase_cloud`, `rate_limiting`, `wallet` | `identity-wallet`, `target-device-accessibility` | no | wallet_provider_credentials |
| `account.onboarding_age_recovery` | new_user | `/?mode=onboarding` | configured age provider, Supabase Auth recovery | `core`, `supabase_cloud`, `rate_limiting`, `wallet`, `verification` | `identity-wallet`, `verification`, `target-device-accessibility` | no | verification_provider_credentials |
| `privacy.user_lifecycle` | authenticated_user | `/app/settings` | none | `core`, `supabase_cloud`, `rate_limiting` | `target-device-accessibility` | no | real_stack_session |
| `content.universal_creation` | age_verified_creator | `/app/create` | Bunny Stream, Bunny Storage, moderation provider | `core`, `supabase_cloud`, `rate_limiting`, `bunny`, `moderation` | `bunny-sfw`, `moderation`, `target-device-accessibility` | no | bunny_and_moderation_credentials |
| `content.moments` | creator_and_viewer | `/app/moments` | existing media provider only | `core`, `supabase_cloud`, `bunny`, `moderation` | `bunny-sfw`, `moderation`, `target-device-accessibility` | no | real_stack_media_and_session |
| `discovery.home_bits_search` | authenticated_viewer | `/app/home` | signed media playback | `core`, `supabase_cloud`, `bunny` | `target-device-accessibility` | no | real_stack_session |
| `engagement.social_loop` | authenticated_viewer | `/content/{contentId}` | none | `core`, `supabase_cloud`, `realtime_push` | `realtime-push`, `target-device-accessibility` | no | real_stack_session |
| `messages.consent_and_commerce` | viewer_and_creator | `/app/messages` | private media provider for attachments | `core`, `supabase_cloud`, `bunny`, `realtime_push`, `email` | `realtime-push`, `transactional-email`, `target-device-accessibility` | no | realtime_and_provider_credentials |
| `payments.one_time_split` | buyer_and_creator | `/content/{contentId}` | Solana devnet, Helius or RPC | `core`, `supabase_cloud`, `wallet`, `payments`, `email` | `solana-network`, `payments`, `transactional-email`, `target-device-accessibility` | no | devnet_wallet_and_helius_configuration |
| `subscriptions.platform_studio_membership` | subscriber_or_creator | `/app/subscriptions` | official Solana recurring delegation | `core`, `supabase_cloud`, `wallet`, `payments`, `subscriptions` | `solana-network`, `subscriptions`, `subscriptions-evidence`, `target-device-accessibility` | `subscriptions` | recurring_program_approval |
| `live.sfw_and_replay` | creator_and_viewer | `/live/{liveRoomId}` | Livepeer, moderation provider | `core`, `supabase_cloud`, `live`, `moderation`, `realtime_push` | `livepeer`, `moderation`, `target-device-accessibility` | no | livepeer_and_moderation_credentials |
| `analytics.consistent_projections` | creator_studio_enterprise_staff | `/app/studio` | none | `core`, `supabase_cloud` | `target-device-accessibility` | no | real_stack_data |
| `realtime.private_topics_push` | authenticated_user | `/app/notifications` | Supabase Realtime, Web Push, Resend | `core`, `supabase_cloud`, `realtime_push`, `email` | `realtime-push`, `transactional-email`, `target-device-accessibility` | no | realtime_push_email_credentials |
| `enterprise.managed_creators` | enterprise_owner_and_creator | `/app/enterprise` | KYB provider | `core`, `supabase_cloud`, `enterprise`, `verification` | `enterprise`, `enterprise-evidence`, `verification`, `target-device-accessibility` | no | enterprise_fixture_and_kyb_configuration |
| `admin.permission_rbac` | platform_staff | `/admin` | none | `core`, `supabase_cloud`, `rate_limiting` | `target-device-accessibility` | no | admin_rbac_journey_not_proven |
| `mcp.optional_bridge` | consenting_creator_or_staff | `/app/assistant` | public HTTPS callback | `core`, `supabase_cloud`, `mcp` | `target-device-accessibility` | `mcp` | public_https_and_client_configuration |
| `operations.backup_observability_recovery` | platform_operations | `/admin/providers` | OTLP destination, backup storage | `core`, `supabase_cloud`, `observability` | `database-backup-restore`, `storage-backup-restore`, `database-backup-evidence`, `storage-backup-evidence`, `observability-alerting` | no | observability_and_restore_targets |

Regenerate with `pnpm staging:acceptance:render`. Do not edit this file by hand.
