import type { FastifyRateLimitStoreCtor } from "@fastify/rate-limit";
import type { FastifyInstance } from "fastify";
import { createPostgresAdminRepository } from "./modules/admin/admin-repository.js";
import type { AdminRepository } from "./modules/admin/types.js";
import { createPostgresActivityRepository } from "./modules/activity/activity-repository.js";
import type { ActivityRepository } from "./modules/activity/types.js";
import { createAgeProviderWaterfall } from "./modules/age/age-provider-waterfall.js";
import { createPostgresAgeRepository } from "./modules/age/age-repository.js";
import type { AgeProviderWaterfall, AgeRepository } from "./modules/age/types.js";
import { createPostgresAiRepository } from "./modules/ai/ai-repository.js";
import type { AiRepository } from "./modules/ai/types.js";
import { createPostgresContentRepository } from "./modules/content/content-repository.js";
import { createBunnyStreamUploadAdapter } from "./modules/content/media-upload-adapter.js";
import type { ContentRepository, MediaUploadProviderAdapter } from "./modules/content/types.js";
import { createPostgresDiscoverRepository } from "./modules/discover/discover-repository.js";
import type { DiscoverRepository } from "./modules/discover/types.js";
import { createPostgresEngagementRepository } from "./modules/engagement/engagement-repository.js";
import type { EngagementRepository } from "./modules/engagement/types.js";
import { createPostgresEventRepository } from "./modules/event/event-repository.js";
import type { EventRepository } from "./modules/event/types.js";
import { createPostgresLiveRepository } from "./modules/live/live-repository.js";
import { createLivepeerProviderAdapter } from "./modules/live/livepeer-adapter.js";
import type { LiveProviderAdapter, LiveRepository } from "./modules/live/types.js";
import { createPostgresMessageRepository } from "./modules/message/message-repository.js";
import type { MessageRepository } from "./modules/message/types.js";
import { createPostgresManagedCreatorRepository } from "./modules/managed-creator/managed-creator-repository.js";
import type { ManagedCreatorRepository } from "./modules/managed-creator/types.js";
import { createPostgresMcpRepository } from "./modules/mcp/mcp-repository.js";
import type { McpRepository } from "./modules/mcp/types.js";
import { createPostgresMutualsRepository } from "./modules/mutuals/mutuals-repository.js";
import type { MutualsRepository } from "./modules/mutuals/types.js";
import { createPostgresNotificationRepository } from "./modules/notification/notification-repository.js";
import type { NotificationRepository } from "./modules/notification/types.js";
import { createPostgresOrganizationRepository } from "./modules/organization/organization-repository.js";
import type { OrganizationRepository } from "./modules/organization/types.js";
import {
  createPostgresPaymentEvidenceRepository,
  createPostgresPaymentRepository
} from "./modules/payment/payment-repository.js";
import { createSolanaRpcSettlementVerifier } from "./modules/payment/solana-payment.js";
import type {
  PaymentEvidenceRepository,
  PaymentRepository,
  PaymentSettlementVerifier
} from "./modules/payment/types.js";
import { createPostgresPerformerRepository } from "./modules/performer/performer-repository.js";
import type { PerformerRepository } from "./modules/performer/types.js";
import { createPostgresProfileRepository } from "./modules/profile/profile-repository.js";
import type { ProfileRepository } from "./modules/profile/types.js";
import { createPostgresReferralRepository } from "./modules/referral/referral-repository.js";
import type { ReferralRepository } from "./modules/referral/types.js";
import { createPostgresRefundRepository } from "./modules/refund/refund-repository.js";
import type { RefundRepository } from "./modules/refund/types.js";
import { createRealtimeTokenIssuer } from "./modules/realtime/realtime-token.js";
import type { RealtimeTokenIssuer } from "./modules/realtime/types.js";
import { createPostgresSessionRepository } from "./modules/session/session-repository.js";
import {
  createApplicationSessionVerifier,
  createSupabaseRecoveryVerifier
} from "./modules/session/supabase-auth.js";
import type {
  SessionRepository,
  ApplicationSessionVerifier,
  RecoveryIdentityVerifier
} from "./modules/session/types.js";
import {
  createPostgresWalletAuthRepository,
  type WalletAuthRepository
} from "./modules/auth/wallet-auth-repository.js";
import { createPostgresSubscriptionRepository } from "./modules/subscription/subscription-repository.js";
import { createSolanaSubscriptionAuthorizationVerifier } from "./modules/subscription/subscription-verifier.js";
import type {
  SubscriptionAuthorizationVerifier,
  SubscriptionRepository
} from "./modules/subscription/types.js";
import { createWalletOnrampProvider } from "./modules/wallet/wallet-onramp-adapter.js";
import { createPostgresWalletRepository } from "./modules/wallet/wallet-repository.js";
import type { WalletOnrampProviderAdapter, WalletRepository } from "./modules/wallet/types.js";
import { createPostgresVerificationRepository } from "./modules/verification/verification-repository.js";
import { createVerificationProviderWaterfall } from "./modules/verification/verification-provider-adapters.js";
import type { VerificationProviderWaterfall, VerificationRepository } from "./modules/verification/types.js";
import { createPostgresClient, type PostgresSql } from "./shared/postgres.js";

export interface BuildApiOptions {
  rateLimitStore?: FastifyRateLimitStoreCtor;
  authVerifier?: ApplicationSessionVerifier;
  recoveryIdentityVerifier?: RecoveryIdentityVerifier;
  sessionRepository?: SessionRepository;
  ageRepository?: AgeRepository;
  ageProviderWaterfall?: AgeProviderWaterfall;
  contentRepository?: ContentRepository;
  mutualsRepository?: MutualsRepository;
  discoverRepository?: DiscoverRepository;
  eventRepository?: EventRepository;
  engagementRepository?: EngagementRepository;
  mediaUploadProvider?: MediaUploadProviderAdapter;
  liveRepository?: LiveRepository;
  liveProvider?: LiveProviderAdapter;
  messageRepository?: MessageRepository;
  managedCreatorRepository?: ManagedCreatorRepository;
  paymentRepository?: PaymentRepository;
  paymentEvidenceRepository?: PaymentEvidenceRepository;
  performerRepository?: PerformerRepository;
  activityRepository?: ActivityRepository;
  settlementVerifier?: PaymentSettlementVerifier;
  profileRepository?: ProfileRepository;
  referralRepository?: ReferralRepository;
  refundRepository?: RefundRepository;
  notificationRepository?: NotificationRepository;
  organizationRepository?: OrganizationRepository;
  subscriptionRepository?: SubscriptionRepository;
  subscriptionAuthorizationVerifier?: SubscriptionAuthorizationVerifier;
  walletRepository?: WalletRepository;
  walletAuthRepository?: WalletAuthRepository;
  onrampProvider?: WalletOnrampProviderAdapter;
  adminRepository?: AdminRepository;
  aiRepository?: AiRepository;
  mcpRepository?: McpRepository;
  verificationRepository?: VerificationRepository;
  verificationProviderWaterfall?: VerificationProviderWaterfall;
  realtimeTokenIssuer?: RealtimeTokenIssuer;
  postgresClient?: PostgresSql;
}

export interface ApiDependencies {
  postgresClient: PostgresSql | undefined;
  authVerifier: ApplicationSessionVerifier;
  recoveryIdentityVerifier: RecoveryIdentityVerifier;
  sessionRepository: SessionRepository;
  ageRepository: AgeRepository;
  ageProviderWaterfall: AgeProviderWaterfall;
  profileRepository: ProfileRepository;
  contentRepository: ContentRepository;
  mutualsRepository: MutualsRepository;
  discoverRepository: DiscoverRepository;
  eventRepository: EventRepository;
  engagementRepository: EngagementRepository;
  mediaUploadProvider: MediaUploadProviderAdapter;
  liveRepository: LiveRepository;
  liveProvider: LiveProviderAdapter;
  messageRepository: MessageRepository;
  managedCreatorRepository: ManagedCreatorRepository;
  paymentRepository: PaymentRepository;
  paymentEvidenceRepository: PaymentEvidenceRepository;
  performerRepository: PerformerRepository;
  activityRepository: ActivityRepository;
  settlementVerifier: PaymentSettlementVerifier;
  referralRepository: ReferralRepository;
  refundRepository: RefundRepository;
  notificationRepository: NotificationRepository;
  organizationRepository: OrganizationRepository;
  subscriptionRepository: SubscriptionRepository;
  subscriptionAuthorizationVerifier: SubscriptionAuthorizationVerifier;
  walletRepository: WalletRepository;
  walletAuthRepository: WalletAuthRepository;
  onrampProvider: WalletOnrampProviderAdapter;
  adminRepository: AdminRepository;
  aiRepository: AiRepository;
  mcpRepository: McpRepository;
  verificationRepository: VerificationRepository;
  verificationProviderWaterfall: VerificationProviderWaterfall;
  realtimeTokenIssuer: RealtimeTokenIssuer;
}

export function createApiDependencies(
  app: FastifyInstance,
  options: BuildApiOptions = {}
): ApiDependencies {
  const postgresClient =
    options.postgresClient ??
    (app.config.DATABASE_URL ? createPostgresClient(app.config.DATABASE_URL) : undefined);
  const walletAuthRepository =
    options.walletAuthRepository ?? createPostgresWalletAuthRepository(postgresClient);

  return {
    postgresClient,
    walletAuthRepository,
    authVerifier:
      options.authVerifier ??
      createApplicationSessionVerifier(walletAuthRepository),
    recoveryIdentityVerifier:
      options.recoveryIdentityVerifier ?? createSupabaseRecoveryVerifier(app.config),
    sessionRepository:
      options.sessionRepository ?? createPostgresSessionRepository(postgresClient),
    ageRepository: options.ageRepository ?? createPostgresAgeRepository(postgresClient),
    ageProviderWaterfall: options.ageProviderWaterfall ?? createAgeProviderWaterfall(app.config),
    profileRepository:
      options.profileRepository ?? createPostgresProfileRepository(postgresClient),
    contentRepository:
      options.contentRepository ?? createPostgresContentRepository(postgresClient),
    mutualsRepository:
      options.mutualsRepository ?? createPostgresMutualsRepository(postgresClient),
    discoverRepository:
      options.discoverRepository ?? createPostgresDiscoverRepository(postgresClient),
    eventRepository: options.eventRepository ?? createPostgresEventRepository(postgresClient),
    engagementRepository:
      options.engagementRepository ?? createPostgresEngagementRepository(postgresClient),
    mediaUploadProvider: options.mediaUploadProvider ?? createBunnyStreamUploadAdapter(app.config),
    liveRepository: options.liveRepository ?? createPostgresLiveRepository(postgresClient),
    liveProvider: options.liveProvider ?? createLivepeerProviderAdapter(app.config),
    messageRepository:
      options.messageRepository ?? createPostgresMessageRepository(postgresClient),
    managedCreatorRepository:
      options.managedCreatorRepository ?? createPostgresManagedCreatorRepository(postgresClient),
    paymentRepository:
      options.paymentRepository ?? createPostgresPaymentRepository(postgresClient),
    paymentEvidenceRepository:
      options.paymentEvidenceRepository ??
      createPostgresPaymentEvidenceRepository(postgresClient),
    performerRepository:
      options.performerRepository ?? createPostgresPerformerRepository(postgresClient),
    activityRepository:
      options.activityRepository ?? createPostgresActivityRepository(postgresClient),
    settlementVerifier:
      options.settlementVerifier ??
        createSolanaRpcSettlementVerifier(
          app.config.SOLANA_RPC_URL,
          app.config.PAYMENT_SOLANA_FINALITY
        ),
    referralRepository:
      options.referralRepository ?? createPostgresReferralRepository(postgresClient),
    refundRepository: options.refundRepository ?? createPostgresRefundRepository(postgresClient),
    notificationRepository:
      options.notificationRepository ??
      createPostgresNotificationRepository(postgresClient, {
        encryptionKey: app.config.NOTIFICATION_DEVICE_ENCRYPTION_KEY
      }),
    organizationRepository:
      options.organizationRepository ?? createPostgresOrganizationRepository(postgresClient),
    subscriptionRepository:
      options.subscriptionRepository ?? createPostgresSubscriptionRepository(postgresClient),
    subscriptionAuthorizationVerifier:
      options.subscriptionAuthorizationVerifier ?? createSolanaSubscriptionAuthorizationVerifier(app.config),
    walletRepository:
      options.walletRepository ?? createPostgresWalletRepository(postgresClient),
    onrampProvider: options.onrampProvider ?? createWalletOnrampProvider(app.config),
    adminRepository: options.adminRepository ?? createPostgresAdminRepository(postgresClient),
    aiRepository: options.aiRepository ?? createPostgresAiRepository(postgresClient),
    mcpRepository: options.mcpRepository ?? createPostgresMcpRepository(postgresClient),
    verificationRepository:
      options.verificationRepository ?? createPostgresVerificationRepository(postgresClient),
    verificationProviderWaterfall:
      options.verificationProviderWaterfall ?? createVerificationProviderWaterfall(app.config),
    realtimeTokenIssuer:
      options.realtimeTokenIssuer ?? createRealtimeTokenIssuer(app.config)
  };
}
