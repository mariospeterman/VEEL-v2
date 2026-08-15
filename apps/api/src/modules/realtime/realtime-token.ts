import { importJWK, SignJWT, type JWK } from "jose";
import type { ServerEnv } from "@veel/config";
import type { RealtimeTokenIssuer } from "./types.js";

const realtimeAudience = "authenticated";

export class RealtimeTokenConfigurationError extends Error {
  constructor() {
    super("REALTIME_TOKEN_NOT_CONFIGURED");
    this.name = "RealtimeTokenConfigurationError";
  }
}

export function createRealtimeTokenIssuer(config: ServerEnv): RealtimeTokenIssuer {
  const issuer = config.REALTIME_JWT_ISSUER;
  const keyId = config.REALTIME_JWT_KEY_ID;
  const encodedJwk = config.REALTIME_JWT_PRIVATE_JWK;
  let keyPromise: Promise<CryptoKey | Uint8Array> | null = null;

  return {
    async issueToken(input) {
      if (!issuer || !keyId || !encodedJwk) {
        throw new RealtimeTokenConfigurationError();
      }

      keyPromise ??= importPrivateSigningKey(encodedJwk);
      const now = Math.floor(Date.now() / 1000);
      const expiresAtSeconds = now + config.REALTIME_JWT_TTL_SECONDS;
      const token = await new SignJWT({ role: realtimeAudience, wevid_session: true })
        .setProtectedHeader({ alg: "ES256", kid: keyId, typ: "JWT" })
        .setSubject(input.userId)
        .setAudience(realtimeAudience)
        .setIssuer(issuer)
        .setIssuedAt(now)
        .setExpirationTime(expiresAtSeconds)
        .sign(await keyPromise);

      return {
        token,
        expiresAt: new Date(expiresAtSeconds * 1000).toISOString()
      };
    }
  };
}

async function importPrivateSigningKey(encodedJwk: string): Promise<CryptoKey | Uint8Array> {
  let jwk: JWK;

  try {
    jwk = JSON.parse(encodedJwk) as JWK;
  } catch {
    throw new RealtimeTokenConfigurationError();
  }

  if (jwk.kty !== "EC" || jwk.crv !== "P-256" || typeof jwk.d !== "string") {
    throw new RealtimeTokenConfigurationError();
  }

  try {
    return await importJWK(jwk, "ES256");
  } catch {
    throw new RealtimeTokenConfigurationError();
  }
}
