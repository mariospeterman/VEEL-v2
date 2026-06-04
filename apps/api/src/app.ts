import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import sensible from "@fastify/sensible";
import Fastify, { type FastifyInstance } from "fastify";
import { createAgeProviderWaterfall } from "./modules/age/age-provider-waterfall.js";
import { createPostgresAgeRepository } from "./modules/age/age-repository.js";
import { registerAgeRoutes } from "./modules/age/age-routes.js";
import type { AgeProviderWaterfall, AgeRepository } from "./modules/age/types.js";
import { createPostgresContentRepository } from "./modules/content/content-repository.js";
import { registerContentRoutes } from "./modules/content/content-routes.js";
import { createBunnyStreamUploadAdapter } from "./modules/content/media-upload-adapter.js";
import type { ContentRepository, MediaUploadProviderAdapter } from "./modules/content/types.js";
import { createPostgresProfileRepository } from "./modules/profile/profile-repository.js";
import { registerProfileRoutes } from "./modules/profile/profile-routes.js";
import type { ProfileRepository } from "./modules/profile/types.js";
import { createPostgresSessionRepository } from "./modules/session/session-repository.js";
import { registerSessionRoutes } from "./modules/session/session-routes.js";
import { createSupabaseAuthVerifier } from "./modules/session/supabase-auth.js";
import type { SessionRepository, SupabaseAuthVerifier } from "./modules/session/types.js";
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
  mediaUploadProvider?: MediaUploadProviderAdapter;
  profileRepository?: ProfileRepository;
  walletRepository?: WalletRepository;
}

export async function buildApi(options: BuildApiOptions = {}): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: process.env.LOG_LEVEL ?? "info",
      redact: [
        "req.headers.authorization",
        "SUPABASE_SECRET_KEY",
        "SUPABASE_SERVICE_ROLE_KEY",
        "DATABASE_URL"
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
  const mediaUploadProvider =
    options.mediaUploadProvider ?? createBunnyStreamUploadAdapter(app.config);
  const walletRepository =
    options.walletRepository ?? createPostgresWalletRepository(app.config.DATABASE_URL);

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
  await registerWalletRoutes(app, {
    authVerifier,
    sessionRepository,
    walletRepository
  });
  await app.register(openApiPlugin);

  return app;
}
