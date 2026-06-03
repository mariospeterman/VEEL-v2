import type { FastifyInstance } from "fastify";
import { unauthorizedResponse, verifyRequestSession } from "../auth/http-auth.js";
import type { AgeRepository } from "../age/types.js";
import type { SessionRepository, SupabaseAuthVerifier } from "../session/types.js";
import type { WalletRepository } from "../wallet/types.js";
import { ContentRepositoryConfigurationError } from "./content-repository.js";
import type { ContentRepository, FeedMode } from "./types.js";

interface RegisterContentRoutesOptions {
  authVerifier: SupabaseAuthVerifier;
  sessionRepository: SessionRepository;
  ageRepository: AgeRepository;
  walletRepository: WalletRepository;
  contentRepository: ContentRepository;
}

const feedModes = new Set(["recommended", "following", "nsfw", "sfw", "live", "premium"]);

export async function registerContentRoutes(
  app: FastifyInstance,
  options: RegisterContentRoutesOptions
): Promise<void> {
  app.get("/v1/content/feed", async (request, reply) => {
    const verifiedSession = await verifyRequestSession(request, options.authVerifier);

    if (!verifiedSession) {
      return reply.code(401).send(unauthorizedResponse("Missing or invalid bearer token"));
    }

    const profile = await options.sessionRepository.findProfileBySupabaseUserId(
      verifiedSession.supabaseUserId
    );
    const [ageStatus, hasWallet] = await Promise.all([
      options.ageRepository.findLatestAgeStatusBySupabaseUserId(verifiedSession.supabaseUserId),
      options.walletRepository.hasWalletBySupabaseUserId(verifiedSession.supabaseUserId)
    ]);

    if (!profile?.handle || !profile.displayName || ageStatus.state !== "verified" || !hasWallet) {
      return reply.code(403).send({
        code: "forbidden",
        message: "Protected feed access requires profile, age verification, and wallet readiness"
      });
    }

    const query = request.query as { mode?: string; cursor?: string };
    const mode = feedModes.has(query.mode ?? "") ? (query.mode as FeedMode) : "recommended";

    try {
      const feedInput = {
        mode,
        limit: 20
      };

      const feed = await options.contentRepository.listHomeFeed(
        query.cursor ? { ...feedInput, cursor: query.cursor } : feedInput
      );

      return reply.code(200).send(feed);
    } catch (error) {
      if (error instanceof ContentRepositoryConfigurationError) {
        request.log.warn({ error }, "Content repository is not configured");
        return reply.code(200).send({
          items: [],
          nextCursor: null
        });
      }

      throw error;
    }
  });
}
