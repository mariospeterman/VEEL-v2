import type { FastifyInstance } from "fastify";
import { unauthorizedResponse, verifyRequestSession } from "../auth/http-auth.js";
import type { SupabaseAuthVerifier } from "../session/types.js";
import {
  WalletRepositoryConfigurationError
} from "./wallet-repository.js";
import type { WalletRepository } from "./types.js";

interface RegisterWalletRoutesOptions {
  authVerifier: SupabaseAuthVerifier;
  walletRepository: WalletRepository;
}

export async function registerWalletRoutes(
  app: FastifyInstance,
  options: RegisterWalletRoutesOptions
): Promise<void> {
  app.get("/v1/wallets", async (request, reply) => {
    const verifiedSession = await verifyRequestSession(request, options.authVerifier);

    if (!verifiedSession) {
      return reply.code(401).send(unauthorizedResponse("Missing or invalid bearer token"));
    }

    try {
      const wallets = await options.walletRepository.listWalletsBySupabaseUserId(
        verifiedSession.supabaseUserId
      );

      return reply.code(200).send({
        items: wallets
      });
    } catch (error) {
      if (error instanceof WalletRepositoryConfigurationError) {
        request.log.warn({ error }, "Wallet repository is not configured");
        return reply.code(200).send({
          items: []
        });
      }

      throw error;
    }
  });
}
