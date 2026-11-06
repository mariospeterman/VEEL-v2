import { Readable } from "node:stream";
import { createHash } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import {
  ContentExportProviderConfigurationError,
  ContentExportProviderTransientError
} from "../../content-export-provider.js";
import { MutationCommandIdempotencyConflictError } from "../../shared/mutation-command-receipt.js";
import { mutationRateLimit } from "../../shared/rate-limits.js";
import { unauthorizedResponse, verifyRequestSession } from "../auth/http-auth.js";
import { ContentExportPolicyError, ContentExportRepositoryConfigurationError } from "./content-export-errors.js";
import type { RegisterContentExportRoutesOptions } from "./types.js";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function registerContentExportRoutes(
  app: FastifyInstance,
  options: RegisterContentExportRoutesOptions
): Promise<void> {
  app.post(
    "/v1/privacy/content-exports/:contentExportId/cancel",
    mutationRateLimit("socialMutation", "cancelContentExport"),
    async (request, reply) => mutationRoute(request, reply, options, "cancel")
  );
  app.post(
    "/v1/privacy/content-exports/:contentExportId/retry",
    mutationRateLimit("socialMutation", "retryContentExport"),
    async (request, reply) => mutationRoute(request, reply, options, "retry")
  );
  app.post(
    "/v1/privacy/content-exports/:contentExportId/download-grants",
    mutationRateLimit("socialMutation", "createContentExportDownloadGrant"),
    async (request, reply) => mutationRoute(request, reply, options, "grant")
  );
  app.get(
    "/v1/privacy/content-exports/:contentExportId/downloads/:grantId",
    mutationRateLimit("accessMutation", "downloadContentExport"),
    async (request, reply) => {
      const session = await verifyRequestSession(request, options.authVerifier);
      if (!session) return reply.code(401).send(unauthorizedResponse("Missing or invalid bearer token"));
      const { contentExportId, grantId } = request.params as {
        contentExportId?: string;
        grantId?: string;
      };
      if (!isUuid(contentExportId) || !isUuid(grantId)) {
        return reply.code(400).send({ code: "validation_failed", message: "Invalid export or grant id" });
      }
      try {
        const authorized = await options.contentExportRepository.authorizeDownload({
          userId: session.userId,
          jobId: contentExportId,
          grantId,
          now: new Date()
        });
        if (!authorized) {
          return reply.code(404).send({ code: "not_found", message: "Content export download was not found" });
        }
        const archive = await options.contentExportProvider.openArchive({
          archiveObjectKey: authorized.archiveObjectKey
        });
        if (archive.byteLength !== null && archive.byteLength !== authorized.archiveByteSize) {
          throw new ContentExportProviderTransientError("CONTENT_EXPORT_ARCHIVE_LENGTH_MISMATCH");
        }
        reply.header("Content-Type", "application/x-tar");
        reply.header("Content-Disposition", `attachment; filename="${authorized.filename}"`);
        const digest = Buffer.from(authorized.archiveSha256, "hex").toString("base64");
        reply.header("Content-Digest", `sha-256=:${digest}:`);
        reply.header("Cache-Control", "private, no-store");
        if (archive.byteLength === authorized.archiveByteSize) {
          reply.header("Content-Length", String(authorized.archiveByteSize));
        }
        return reply.code(200).send(Readable.from(verifiedContentExportArchiveBody({
          body: archive.body,
          expectedByteSize: authorized.archiveByteSize,
          expectedSha256: authorized.archiveSha256
        })));
      } catch (error) {
        return contentExportErrorReply(request, reply, error);
      }
    }
  );
}

export async function* verifiedContentExportArchiveBody(input: {
  body: AsyncIterable<Uint8Array>;
  expectedByteSize: number;
  expectedSha256: string;
}): AsyncGenerator<Uint8Array> {
  if (
    !Number.isSafeInteger(input.expectedByteSize) ||
    input.expectedByteSize <= 0 ||
    !/^[a-f0-9]{64}$/.test(input.expectedSha256)
  ) {
    throw new ContentExportProviderTransientError("CONTENT_EXPORT_ARCHIVE_EVIDENCE_INVALID");
  }
  const hash = createHash("sha256");
  let actualByteSize = 0;
  for await (const sourceChunk of input.body) {
    const chunk = sourceChunk instanceof Uint8Array ? sourceChunk : new Uint8Array(sourceChunk);
    actualByteSize += chunk.byteLength;
    if (actualByteSize > input.expectedByteSize) {
      throw new ContentExportProviderTransientError("CONTENT_EXPORT_ARCHIVE_LENGTH_MISMATCH");
    }
    hash.update(chunk);
    yield chunk;
  }
  if (actualByteSize !== input.expectedByteSize) {
    throw new ContentExportProviderTransientError("CONTENT_EXPORT_ARCHIVE_LENGTH_MISMATCH");
  }
  if (hash.digest("hex") !== input.expectedSha256) {
    throw new ContentExportProviderTransientError("CONTENT_EXPORT_ARCHIVE_HASH_MISMATCH");
  }
}

async function mutationRoute(
  request: FastifyRequest,
  reply: FastifyReply,
  options: RegisterContentExportRoutesOptions,
  action: "cancel" | "retry" | "grant"
) {
  const session = await verifyRequestSession(request, options.authVerifier);
  if (!session) return reply.code(401).send(unauthorizedResponse("Missing or invalid bearer token"));
  const contentExportId = (request.params as { contentExportId?: string }).contentExportId;
  if (!isUuid(contentExportId)) {
    return reply.code(400).send({ code: "validation_failed", message: "contentExportId must be a UUID" });
  }
  const idempotencyKey = request.headers["idempotency-key"];
  if (typeof idempotencyKey !== "string" || idempotencyKey.length < 1 || idempotencyKey.length > 128) {
    return reply.code(400).send({ code: "validation_failed", message: "Idempotency-Key header is required" });
  }
  try {
    const common = {
      userId: session.userId,
      jobId: contentExportId,
      idempotencyKey
    };
    const resource = action === "cancel"
      ? await options.contentExportRepository.cancel(common)
      : action === "retry"
        ? await options.contentExportRepository.retry(common)
        : await options.contentExportRepository.createDownloadGrant({ ...common, now: new Date() });
    if (!resource) {
      return reply.code(404).send({ code: "not_found", message: "Content export was not found" });
    }
    return reply.code(action === "grant" ? 201 : 200).send(resource);
  } catch (error) {
    return contentExportErrorReply(request, reply, error);
  }
}

function contentExportErrorReply(request: FastifyRequest, reply: FastifyReply, error: unknown) {
  if (error instanceof MutationCommandIdempotencyConflictError) {
    return reply.code(409).send({ code: "idempotency_conflict", message: "Idempotency key was already used" });
  }
  if (error instanceof ContentExportPolicyError) {
    return reply.code(409).send({ code: "conflict", message: error.message });
  }
  if (
    error instanceof ContentExportRepositoryConfigurationError
    || error instanceof ContentExportProviderConfigurationError
    || error instanceof ContentExportProviderTransientError
  ) {
    request.log.warn({ errorName: error.name }, "Content export is unavailable");
    return reply.code(503).send({ code: "service_unavailable", message: "Content export is temporarily unavailable" });
  }
  throw error;
}

function isUuid(value: string | undefined): value is string {
  return typeof value === "string" && uuidPattern.test(value);
}
