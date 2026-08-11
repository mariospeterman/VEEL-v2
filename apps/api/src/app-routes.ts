import type { FastifyInstance } from "fastify";
import type { ApiDependencies } from "./app-dependencies.js";
import { registerAdminRoutes } from "./modules/admin/admin-routes.js";
import { registerActivityRoutes } from "./modules/activity/activity-routes.js";
import { registerAgeRoutes } from "./modules/age/age-routes.js";
import { registerAiRoutes } from "./modules/ai/ai-routes.js";
import { registerContentRoutes } from "./modules/content/content-routes.js";
import { registerDiscoverRoutes } from "./modules/discover/discover-routes.js";
import { registerEngagementRoutes } from "./modules/engagement/engagement-routes.js";
import { registerEventRoutes } from "./modules/event/event-routes.js";
import { registerLiveRoutes } from "./modules/live/live-routes.js";
import { registerMessageRoutes } from "./modules/message/message-routes.js";
import { registerMcpRoutes } from "./modules/mcp/mcp-routes.js";
import { registerMutualsRoutes } from "./modules/mutuals/mutuals-routes.js";
import { registerNotificationRoutes } from "./modules/notification/notification-routes.js";
import { registerOrganizationRoutes } from "./modules/organization/organization-routes.js";
import { registerPaymentRoutes } from "./modules/payment/payment-routes.js";
import { registerProfileRoutes } from "./modules/profile/profile-routes.js";
import { registerReferralRoutes } from "./modules/referral/referral-routes.js";
import { registerRefundRoutes } from "./modules/refund/refund-routes.js";
import { registerSessionRoutes } from "./modules/session/session-routes.js";
import { registerSubscriptionRoutes } from "./modules/subscription/subscription-routes.js";
import { registerVerificationRoutes } from "./modules/verification/verification-routes.js";
import { registerWalletRoutes } from "./modules/wallet/wallet-routes.js";
import { registerWalletAuthRoutes } from "./modules/auth/wallet-auth-routes.js";

export async function registerApiRoutes(
  app: FastifyInstance,
  dependencies: ApiDependencies
): Promise<void> {
  const {
    authVerifier,
    sessionRepository,
    ageRepository,
    ageProviderWaterfall,
    profileRepository,
    walletRepository,
    contentRepository,
    mediaUploadProvider,
    liveRepository,
    mutualsRepository,
    discoverRepository,
    eventRepository,
    engagementRepository,
    paymentRepository,
    paymentEvidenceRepository,
    settlementVerifier,
    liveProvider,
    messageRepository,
    referralRepository,
    refundRepository,
    notificationRepository,
    organizationRepository,
    subscriptionRepository,
    subscriptionAuthorizationVerifier,
    activityRepository,
    adminRepository,
    aiRepository,
    mcpRepository,
    verificationRepository,
    verificationProviderWaterfall,
    walletAuthRepository,
    onrampProvider
  } = dependencies;

  await registerWalletAuthRoutes(app, {
    authVerifier,
    walletAuthRepository
  });
  await registerSessionRoutes(app, {
    authVerifier,
    sessionRepository,
    ageRepository,
    walletRepository
  });
  await registerAgeRoutes(app, {
    authVerifier,
    sessionRepository,
    ageProviderWaterfall,
    ageRepository
  });
  await registerVerificationRoutes(app, {
    authVerifier,
    verificationRepository,
    verificationProviderWaterfall
  });
  await registerProfileRoutes(app, {
    authVerifier,
    sessionRepository,
    ageRepository,
    profileRepository
  });
  await registerContentRoutes(app, {
    authVerifier,
    sessionRepository,
    ageRepository,
    walletRepository,
    contentRepository,
    mediaUploadProvider,
    liveRepository,
    verificationRepository,
    subscriptionRepository
  });
  await registerDiscoverRoutes(app, {
    authVerifier,
    sessionRepository,
    ageRepository,
    walletRepository,
    discoverRepository
  });
  await registerEventRoutes(app, {
    authVerifier,
    sessionRepository,
    ageRepository,
    walletRepository,
    paymentRepository,
    eventRepository
  });
  await registerMutualsRoutes(app, {
    authVerifier,
    sessionRepository,
    ageRepository,
    mutualsRepository
  });
  await registerEngagementRoutes(app, {
    authVerifier,
    sessionRepository,
    ageRepository,
    engagementRepository
  });
  await registerPaymentRoutes(app, {
    authVerifier,
    sessionRepository,
    ageRepository,
    walletRepository,
    contentRepository,
    paymentRepository,
    paymentEvidenceRepository,
    settlementVerifier
  });
  await registerLiveRoutes(app, {
    authVerifier,
    sessionRepository,
    ageRepository,
    walletRepository,
    paymentRepository,
    liveRepository,
    liveProvider,
    subscriptionRepository
  });
  await registerMessageRoutes(app, {
    authVerifier,
    sessionRepository,
    ageRepository,
    walletRepository,
    paymentRepository,
    messageRepository
  });
  await registerReferralRoutes(app, {
    authVerifier,
    sessionRepository,
    ageRepository,
    walletRepository,
    referralRepository
  });
  await registerRefundRoutes(app, {
    authVerifier,
    sessionRepository,
    ageRepository,
    refundRepository
  });
  await registerNotificationRoutes(app, {
    authVerifier,
    notificationRepository,
    vapidPublicKey: app.config.WEB_PUSH_VAPID_PUBLIC_KEY
  });
  await registerOrganizationRoutes(app, {
    authVerifier,
    sessionRepository,
    ageRepository,
    organizationRepository
  });
  await registerSubscriptionRoutes(app, {
    authVerifier,
    sessionRepository,
    ageRepository,
    walletRepository,
    subscriptionRepository,
    subscriptionAuthorizationVerifier
  });
  await registerActivityRoutes(app, {
    authVerifier,
    sessionRepository,
    ageRepository,
    activityRepository
  });
  await registerAdminRoutes(app, {
    authVerifier,
    adminRepository
  });
  await registerAiRoutes(app, {
    authVerifier,
    sessionRepository,
    ageRepository,
    adminRepository,
    aiRepository
  });
  await registerMcpRoutes(app, {
    authVerifier,
    sessionRepository,
    ageRepository,
    walletRepository,
    profileRepository,
    contentRepository,
    adminRepository,
    mcpRepository
  });
  await registerWalletRoutes(app, {
    authVerifier,
    sessionRepository,
    walletRepository,
    onrampProvider
  });
}
