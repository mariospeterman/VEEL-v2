import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import sensible from "@fastify/sensible";
import Fastify, { type FastifyInstance } from "fastify";
import { createPostgresAdminRepository } from "./modules/admin/admin-repository.js";
import { registerAdminRoutes } from "./modules/admin/admin-routes.js";
import type { AdminRepository } from "./modules/admin/types.js";
import { createPostgresActivityRepository } from "./modules/activity/activity-repository.js";
import { registerActivityRoutes } from "./modules/activity/activity-routes.js";
import type { ActivityRepository } from "./modules/activity/types.js";
import { createAgeProviderWaterfall } from "./modules/age/age-provider-waterfall.js";
import { createPostgresAgeRepository } from "./modules/age/age-repository.js";
import { registerAgeRoutes } from "./modules/age/age-routes.js";
import type { AgeProviderWaterfall, AgeRepository } from "./modules/age/types.js";
import { createPostgresAiRepository } from "./modules/ai/ai-repository.js";
import { registerAiRoutes } from "./modules/ai/ai-routes.js";
import type { AiRepository } from "./modules/ai/types.js";
import { createPostgresContentRepository } from "./modules/content/content-repository.js";
import { registerContentRoutes } from "./modules/content/content-routes.js";
import { createBunnyStreamUploadAdapter } from "./modules/content/media-upload-adapter.js";
import type { ContentRepository, MediaUploadProviderAdapter } from "./modules/content/types.js";
import { createPostgresDatingRepository } from "./modules/dating/dating-repository.js";
import { registerDatingRoutes } from "./modules/dating/dating-routes.js";
import type { DatingRepository } from "./modules/dating/types.js";
import { createPostgresDiscoverRepository } from "./modules/discover/discover-repository.js";
import { registerDiscoverRoutes } from "./modules/discover/discover-routes.js";
import type { DiscoverRepository } from "./modules/discover/types.js";
import { createPostgresEventRepository } from "./modules/event/event-repository.js";
import { registerEventRoutes } from "./modules/event/event-routes.js";
import type { EventRepository } from "./modules/event/types.js";
import { createPostgresEngagementRepository } from "./modules/engagement/engagement-repository.js";
import { registerEngagementRoutes } from "./modules/engagement/engagement-routes.js";
import type { EngagementRepository } from "./modules/engagement/types.js";
import { createPostgresLiveRepository } from "./modules/live/live-repository.js";
import { createLivepeerProviderAdapter } from "./modules/live/livepeer-adapter.js";
import { registerLiveRoutes } from "./modules/live/live-routes.js";
import type { LiveProviderAdapter, LiveRepository } from "./modules/live/types.js";
import { createPostgresMessageRepository } from "./modules/message/message-repository.js";
import { registerMessageRoutes } from "./modules/message/message-routes.js";
import type { MessageRepository } from "./modules/message/types.js";
import {
  createPostgresPaymentEvidenceRepository,
  createPostgresPaymentRepository
} from "./modules/payment/payment-repository.js";
import { registerPaymentRoutes } from "./modules/payment/payment-routes.js";
import { createSolanaRpcSettlementVerifier } from "./modules/payment/solana-payment.js";
import type {
  PaymentEvidenceRepository,
  PaymentRepository,
  PaymentSettlementVerifier
} from "./modules/payment/types.js";
import { createPostgresProfileRepository } from "./modules/profile/profile-repository.js";
import { registerProfileRoutes } from "./modules/profile/profile-routes.js";
import type { ProfileRepository } from "./modules/profile/types.js";
import { createPostgresReferralRepository } from "./modules/referral/referral-repository.js";
import { registerReferralRoutes } from "./modules/referral/referral-routes.js";
import type { ReferralRepository } from "./modules/referral/types.js";
import { createPostgresSessionRepository } from "./modules/session/session-repository.js";
import { registerSessionRoutes } from "./modules/session/session-routes.js";
import { createSupabaseAuthVerifier } from "./modules/session/supabase-auth.js";
import type { SessionRepository, SupabaseAuthVerifier } from "./modules/session/types.js";
import { createPostgresSubscriptionRepository } from "./modules/subscription/subscription-repository.js";
import { registerSubscriptionRoutes } from "./modules/subscription/subscription-routes.js";
import { createSolanaSubscriptionAuthorizationVerifier } from "./modules/subscription/subscription-verifier.js";
import type {
  SubscriptionAuthorizationVerifier,
  SubscriptionRepository
} from "./modules/subscription/types.js";
import { createPostgresWalletRepository } from "./modules/wallet/wallet-repository.js";
import { registerWalletRoutes } from "./modules/wallet/wallet-routes.js";
import type { WalletRepository } from "./modules/wallet/types.js";
import { envPlugin } from "./plugins/env.js";
import { openApiPlugin } from "./plugins/openapi.js";
import { supabaseBoundaryPlugin } from "./plugins/supabase-boundary.js";

export interface BuildApiOptions {
  authVerifier?: SupabaseAuthVerifier;
  sessionRepository?: SessionRepository;
  ageRepository?: AgeRepository;
  ageProviderWaterfall?: AgeProviderWaterfall;
  contentRepository?: ContentRepository;
  datingRepository?: DatingRepository;
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
  subscriptionRepository?: SubscriptionRepository;
  subscriptionAuthorizationVerifier?: SubscriptionAuthorizationVerifier;
  walletRepository?: WalletRepository;
  adminRepository?: AdminRepository;
  aiRepository?: AiRepository;
}

export async function buildApi(options: BuildApiOptions = {}): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: process.env.LOG_LEVEL ?? "info",
      redact: [
        "req.headers.authorization",
        "SUPABASE_SECRET_KEY",
        "SUPABASE_SERVICE_ROLE_KEY",
        "DATABASE_URL",
        "HELIUS_API_KEY",
        "HELIUS_WEBHOOK_SECRET"
      ]
    }
  });

  await app.register(sensible);
  await app.register(cors, {
    origin: process.env.WEB_URL ?? "http://localhost:3000",
    credentials: true
  });
  await app.register(rateLimit, {
    max: 100,
    timeWindow: "1 minute"
  });
  await app.register(envPlugin);
  await app.register(supabaseBoundaryPlugin);
  const authVerifier = options.authVerifier ?? createSupabaseAuthVerifier(app.config);
  const sessionRepository =
    options.sessionRepository ?? createPostgresSessionRepository(app.config.DATABASE_URL);
  const ageRepository = options.ageRepository ?? createPostgresAgeRepository(app.config.DATABASE_URL);
  const ageProviderWaterfall =
    options.ageProviderWaterfall ?? createAgeProviderWaterfall(app.config);
  const profileRepository =
    options.profileRepository ?? createPostgresProfileRepository(app.config.DATABASE_URL);
  const contentRepository =
    options.contentRepository ?? createPostgresContentRepository(app.config.DATABASE_URL);
  const datingRepository =
    options.datingRepository ?? createPostgresDatingRepository(app.config.DATABASE_URL);
  const discoverRepository =
    options.discoverRepository ?? createPostgresDiscoverRepository(app.config.DATABASE_URL);
  const eventRepository =
    options.eventRepository ?? createPostgresEventRepository(app.config.DATABASE_URL);
  const engagementRepository =
    options.engagementRepository ?? createPostgresEngagementRepository(app.config.DATABASE_URL);
  const mediaUploadProvider =
    options.mediaUploadProvider ?? createBunnyStreamUploadAdapter(app.config);
  const liveRepository =
    options.liveRepository ?? createPostgresLiveRepository(app.config.DATABASE_URL);
  const liveProvider = options.liveProvider ?? createLivepeerProviderAdapter(app.config);
  const messageRepository =
    options.messageRepository ?? createPostgresMessageRepository(app.config.DATABASE_URL);
  const paymentRepository =
    options.paymentRepository ?? createPostgresPaymentRepository(app.config.DATABASE_URL);
  const paymentEvidenceRepository =
    options.paymentEvidenceRepository ??
    createPostgresPaymentEvidenceRepository(app.config.DATABASE_URL);
  const activityRepository =
    options.activityRepository ?? createPostgresActivityRepository(app.config.DATABASE_URL);
  const settlementVerifier =
    options.settlementVerifier ?? createSolanaRpcSettlementVerifier(app.config.SOLANA_RPC_URL);
  const referralRepository =
    options.referralRepository ?? createPostgresReferralRepository(app.config.DATABASE_URL);
  const subscriptionRepository =
    options.subscriptionRepository ?? createPostgresSubscriptionRepository(app.config.DATABASE_URL);
  const subscriptionAuthorizationVerifier =
    options.subscriptionAuthorizationVerifier ?? createSolanaSubscriptionAuthorizationVerifier();
  const walletRepository =
    options.walletRepository ?? createPostgresWalletRepository(app.config.DATABASE_URL);
  const adminRepository =
    options.adminRepository ?? createPostgresAdminRepository(app.config.DATABASE_URL);
  const aiRepository = options.aiRepository ?? createPostgresAiRepository(app.config.DATABASE_URL);

  if (sessionRepository.close) {
    app.addHook("onClose", async () => {
      await sessionRepository.close?.();
    });
  }
  if (ageRepository.close) {
    app.addHook("onClose", async () => {
      await ageRepository.close?.();
    });
  }
  if (profileRepository.close) {
    app.addHook("onClose", async () => {
      await profileRepository.close?.();
    });
  }
  if (walletRepository.close) {
    app.addHook("onClose", async () => {
      await walletRepository.close?.();
    });
  }
  if (contentRepository.close) {
    app.addHook("onClose", async () => {
      await contentRepository.close?.();
    });
  }
  if (datingRepository.close) {
    app.addHook("onClose", async () => {
      await datingRepository.close?.();
    });
  }
  if (discoverRepository.close) {
    app.addHook("onClose", async () => {
      await discoverRepository.close?.();
    });
  }
  if (eventRepository.close) {
    app.addHook("onClose", async () => {
      await eventRepository.close?.();
    });
  }
  if (engagementRepository.close) {
    app.addHook("onClose", async () => {
      await engagementRepository.close?.();
    });
  }
  if (liveRepository.close) {
    app.addHook("onClose", async () => {
      await liveRepository.close?.();
    });
  }
  if (messageRepository.close) {
    app.addHook("onClose", async () => {
      await messageRepository.close?.();
    });
  }
  if (paymentRepository.close) {
    app.addHook("onClose", async () => {
      await paymentRepository.close?.();
    });
  }
  if (paymentEvidenceRepository.close) {
    app.addHook("onClose", async () => {
      await paymentEvidenceRepository.close?.();
    });
  }
  if (activityRepository.close) {
    app.addHook("onClose", async () => {
      await activityRepository.close?.();
    });
  }
  if (referralRepository.close) {
    app.addHook("onClose", async () => {
      await referralRepository.close?.();
    });
  }
  if (subscriptionRepository.close) {
    app.addHook("onClose", async () => {
      await subscriptionRepository.close?.();
    });
  }
  if (adminRepository.close) {
    app.addHook("onClose", async () => {
      await adminRepository.close?.();
    });
  }
  if (aiRepository.close) {
    app.addHook("onClose", async () => {
      await aiRepository.close?.();
    });
  }

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
    mediaUploadProvider
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
  await registerDatingRoutes(app, {
    authVerifier,
    sessionRepository,
    ageRepository,
    datingRepository
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
    liveProvider
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
  await registerWalletRoutes(app, {
    authVerifier,
    sessionRepository,
    walletRepository
  });
  await app.register(openApiPlugin);

  return app;
}
