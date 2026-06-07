import { createHash, timingSafeEqual } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { unauthorizedResponse } from "../auth/http-auth.js";
import { PaymentRepositoryConfigurationError } from "./payment-repository.js";
import type { WebhookReceipt } from "./types.js";
import type { RegisterPaymentRoutesOptions } from "./payment-route-shared.js";
import { serviceUnavailableResponse } from "./payment-route-shared.js";

export async function registerSolanaIndexerWebhookRoute(
  app: FastifyInstance,
  options: RegisterPaymentRoutesOptions
): Promise<void> {
  app.post("/v1/webhooks/solana-indexer", async (request, reply) => {
    if (!app.config.HELIUS_WEBHOOK_SECRET) {
      return reply.code(503).send(serviceUnavailableResponse("Solana indexer webhook is not configured"));
    }

    const authorization = request.headers.authorization;

    if (
      typeof authorization !== "string" ||
      !secureStringEquals(authorization, app.config.HELIUS_WEBHOOK_SECRET)
    ) {
      return reply.code(401).send(unauthorizedResponse("Missing or invalid webhook authorization"));
    }

    const events = normalizeHeliusWebhookPayload(request.body);
    let processed = 0;

    try {
      for (const event of events) {
        const isNewEvent = await options.paymentEvidenceRepository.recordSolanaProviderEvent({
          providerEventId: event.providerEventId,
          eventType: event.eventType,
          signature: event.signature,
          referenceAddresses: event.referenceAddresses,
          authorizationHash: hashWebhookAuthorization(authorization)
        });

        if (!isNewEvent) {
          continue;
        }

        const match = await options.paymentEvidenceRepository.findIntentByReference({
          referenceAddresses: event.referenceAddresses
        });

        if (!match) {
          await options.paymentEvidenceRepository.updateSolanaProviderEvent({
            providerEventId: event.providerEventId,
            normalizedState: "ignored"
          });
          continue;
        }

        const settlement = await options.settlementVerifier.verifyNativeSolTransfer({
          signature: event.signature,
          referenceAddress: match.intent.referenceAddress,
          treasuryWallet: match.intent.treasuryWallet,
          amountMinor: match.intent.amountMinor
        });

        await options.paymentRepository.recordSubmission({
          supabaseUserId: match.supabaseUserId,
          paymentIntentId: match.intent.id,
          signature: event.signature,
          settlement
        });
        await options.paymentEvidenceRepository.updateSolanaProviderEvent({
          providerEventId: event.providerEventId,
          normalizedState: settlement.confirmed ? "processed" : "failed"
        });

        if (settlement.confirmed) {
          processed += 1;
        }
      }
    } catch (error) {
      if (error instanceof PaymentRepositoryConfigurationError) {
        request.log.warn({ error }, "Solana indexer webhook handling failed");
        return reply.code(503).send(serviceUnavailableResponse("Solana indexer webhook is not configured"));
      }

      throw error;
    }

    const receipt: WebhookReceipt = {
      provider: "helius",
      received: events.length,
      processed
    };

    return reply.code(202).send(receipt);
  });

}

interface NormalizedHeliusWebhookEvent {
  providerEventId: string;
  eventType: string;
  signature: string;
  referenceAddresses: string[];
}

function normalizeHeliusWebhookPayload(payload: unknown): NormalizedHeliusWebhookEvent[] {
  const records = Array.isArray(payload) ? payload : [payload];
  const events: NormalizedHeliusWebhookEvent[] = [];

  for (const record of records) {
    if (!record || typeof record !== "object") {
      continue;
    }

    const objectRecord = record as Record<string, unknown>;
    const signature = getString(objectRecord, "signature") ?? getString(objectRecord, "transactionSignature");

    if (!signature) {
      continue;
    }

    events.push({
      providerEventId: signature,
      eventType: getString(objectRecord, "type") ?? "payment.settlement",
      signature,
      referenceAddresses: extractSolanaAddresses(record)
    });
  }

  return events;
}

function getString(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];

  return typeof value === "string" && value.length > 0 ? value : null;
}

function extractSolanaAddresses(value: unknown): string[] {
  const addresses = new Set<string>();
  const visit = (entry: unknown): void => {
    if (typeof entry === "string") {
      if (isLikelySolanaAddress(entry)) {
        addresses.add(entry);
      }
      return;
    }

    if (Array.isArray(entry)) {
      for (const item of entry) visit(item);
      return;
    }

    if (entry && typeof entry === "object") {
      for (const item of Object.values(entry)) visit(item);
    }
  };

  visit(value);

  return [...addresses];
}

function isLikelySolanaAddress(value: string): boolean {
  return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value);
}

function hashWebhookAuthorization(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function secureStringEquals(a: string, b: string): boolean {
  const aBuffer = Buffer.from(a);
  const bBuffer = Buffer.from(b);

  return aBuffer.length === bBuffer.length && timingSafeEqual(aBuffer, bBuffer);
}
