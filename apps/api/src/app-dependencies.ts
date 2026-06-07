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
import { createPostgresProfileRepository } from "./modules/profile/profile-repository.js";
import type { ProfileRepository } from "./modules/profile/types.js";
import { createPostgresReferralRepository } from "./modules/referral/referral-repository.js";
import type { ReferralRepository } from "./modules/referral/types.js";
import { createPostgresRefundRepository } from "./modules/refund/refund-repository.js";
import type { RefundRepository } from "./modules/refund/types.js";
import { createPostgresSessionRepository } from "./modules/session/session-repository.js";
import { createSupabaseAuthVerifier } from "./modules/session/supabase-auth.js";
import type { SessionRepository, SupabaseAuthVerifier } from "./modules/session/types.js";
import { createPostgresSubscriptionRepository } from "./modules/subscription/subscription-repository.js";
import { createSolanaSubscriptionAuthorizationVerifier } from "./modules/subscription/subscription-verifier.js";
import type {
  SubscriptionAuthorizationVerifier,
  SubscriptionRepository
} from "./modules/subscription/types.js";
import { createWalletOnrampProvider } from "./modules/wallet/wallet-onramp-adapter.js";
import { createPostgresWalletRepository } from "./modules/wallet/wallet-repository.js";
import type { WalletOnrampProviderAdapter, WalletRepository } from "./modules/wallet/types.js";

export interface BuildApiOptions {
  authVerifier?: SupabaseAuthVerifier;
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
  paymentRepository?: PaymentRepository;
  paymentEvidenceRepository?: PaymentEvidenceRepository;
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
  onrampProvider?: WalletOnrampProviderAdapter;
  adminRepository?: AdminRepository;
  aiRepository?: AiRepository;
}

export interface ApiDependencies {
  authVerifier: SupabaseAuthVerifier;
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
  paymentRepository: PaymentRepository;
  paymentEvidenceRepository: PaymentEvidenceRepository;
  activityRepository: ActivityRepository;
  settlementVerifier: PaymentSettlementVerifier;
  referralRepository: ReferralRepository;
  refundRepository: RefundRepository;
  notificationRepository: NotificationRepository;
  organizationRepository: OrganizationRepository;
  subscriptionRepository: SubscriptionRepository;
  subscriptionAuthorizationVerifier: SubscriptionAuthorizationVerifier;
  walletRepository: WalletRepository;
  onrampProvider: WalletOnrampProviderAdapter;
  adminRepository: AdminRepository;
  aiRepository: AiRepository;
}

export function createApiDependencies(
  app: FastifyInstance,
  options: BuildApiOptions = {}
): ApiDependencies {
  return {
    authVerifier: options.authVerifier ?? createSupabaseAuthVerifier(app.config),
    sessionRepository:
      options.sessionRepository ?? createPostgresSessionRepository(app.config.DATABASE_URL),
    ageRepository: options.ageRepository ?? createPostgresAgeRepository(app.config.DATABASE_URL),
    ageProviderWaterfall: options.ageProviderWaterfall ?? createAgeProviderWaterfall(app.config),
    profileRepository:
      options.profileRepository ?? createPostgresProfileRepository(app.config.DATABASE_URL),
    contentRepository:
      options.contentRepository ?? createPostgresContentRepository(app.config.DATABASE_URL),
    mutualsRepository:
      options.mutualsRepository ?? createPostgresMutualsRepository(app.config.DATABASE_URL),
    discoverRepository:
      options.discoverRepository ?? createPostgresDiscoverRepository(app.config.DATABASE_URL),
    eventRepository: options.eventRepository ?? createPostgresEventRepository(app.config.DATABASE_URL),
    engagementRepository:
      options.engagementRepository ?? createPostgresEngagementRepository(app.config.DATABASE_URL),
    mediaUploadProvider: options.mediaUploadProvider ?? createBunnyStreamUploadAdapter(app.config),
    liveRepository: options.liveRepository ?? createPostgresLiveRepository(app.config.DATABASE_URL),
    liveProvider: options.liveProvider ?? createLivepeerProviderAdapter(app.config),
    messageRepository:
      options.messageRepository ?? createPostgresMessageRepository(app.config.DATABASE_URL),
    paymentRepository:
      options.paymentRepository ?? createPostgresPaymentRepository(app.config.DATABASE_URL),
    paymentEvidenceRepository:
      options.paymentEvidenceRepository ??
      createPostgresPaymentEvidenceRepository(app.config.DATABASE_URL),
    activityRepository:
      options.activityRepository ?? createPostgresActivityRepository(app.config.DATABASE_URL),
    settlementVerifier:
      options.settlementVerifier ?? createSolanaRpcSettlementVerifier(app.config.SOLANA_RPC_URL),
    referralRepository:
      options.referralRepository ?? createPostgresReferralRepository(app.config.DATABASE_URL),
    refundRepository: options.refundRepository ?? createPostgresRefundRepository(app.config.DATABASE_URL),
    notificationRepository:
      options.notificationRepository ??
      createPostgresNotificationRepository(app.config.DATABASE_URL, {
        encryptionKey: app.config.NOTIFICATION_DEVICE_ENCRYPTION_KEY
      }),
    organizationRepository:
      options.organizationRepository ?? createPostgresOrganizationRepository(app.config.DATABASE_URL),
    subscriptionRepository:
      options.subscriptionRepository ?? createPostgresSubscriptionRepository(app.config.DATABASE_URL),
    subscriptionAuthorizationVerifier:
      options.subscriptionAuthorizationVerifier ?? createSolanaSubscriptionAuthorizationVerifier(),
    walletRepository:
      options.walletRepository ?? createPostgresWalletRepository(app.config.DATABASE_URL),
    onrampProvider: options.onrampProvider ?? createWalletOnrampProvider(app.config),
    adminRepository: options.adminRepository ?? createPostgresAdminRepository(app.config.DATABASE_URL),
    aiRepository: options.aiRepository ?? createPostgresAiRepository(app.config.DATABASE_URL)
  };
}
