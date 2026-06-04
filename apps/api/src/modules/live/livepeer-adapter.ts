import { createPrivateKey, createSign } from "node:crypto";
import type { ServerEnv } from "@veel/config";
import type {
  CreatedLiveProviderRoom,
  LiveProviderAdapter,
  LiveProviderRoomStatus
} from "./types.js";

const livepeerApiBaseUrl = "https://livepeer.studio/api";
const livepeerRtmpIngestBaseUrl = "rtmp://rtmp.livepeer.com/live";

export class LiveProviderConfigurationError extends Error {
  constructor() {
    super("LIVEPEER_NOT_CONFIGURED");
    this.name = "LiveProviderConfigurationError";
  }
}

interface LivepeerStreamResponse {
  id?: string;
  streamKey?: string;
  playbackId?: string;
  isActive?: boolean;
  lastTerminatedAt?: number | null;
  record?: boolean;
}

interface LivepeerPlaybackResponse {
  type?: "live" | "vod" | "recording";
  meta?: {
    live?: number;
    source?: Array<{ type?: string; url?: string }>;
    dvrPlayback?: Array<{ url?: string; error?: string }>;
  };
}

export function createLivepeerProviderAdapter(env: ServerEnv): LiveProviderAdapter {
  return {
    isConfigured() {
      return Boolean(env.LIVEPEER_API_KEY);
    },
    async createRoom(input) {
      const apiKey = env.LIVEPEER_API_KEY;

      if (!apiKey) {
        throw new LiveProviderConfigurationError();
      }

      const response = await fetch(`${livepeerApiBaseUrl}/stream`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${apiKey}`,
          "content-type": "application/json"
        },
        body: JSON.stringify({
          name: input.title,
          playbackPolicy: { type: "jwt" },
          record: true,
          userTags: {
            veelRoomId: input.roomId
          }
        })
      });

      if (!response.ok) {
        throw new LiveProviderConfigurationError();
      }

      const payload = (await response.json()) as LivepeerStreamResponse;

      if (!payload.id || !payload.streamKey) {
        throw new LiveProviderConfigurationError();
      }

      return {
        provider: "livepeer",
        providerStreamId: payload.id,
        providerPlaybackId: payload.playbackId ?? null,
        providerState: payload.isActive ? "active" : "created",
        hostIngestUrl: `${livepeerRtmpIngestBaseUrl}/${payload.streamKey}`,
        hostStreamKey: payload.streamKey,
        playbackUrl: playbackUrlFromPlaybackId(payload.playbackId)
      } satisfies CreatedLiveProviderRoom;
    },
    async getRoomStatus(input) {
      const apiKey = env.LIVEPEER_API_KEY;

      if (!apiKey) {
        throw new LiveProviderConfigurationError();
      }

      const streamResponse = await fetch(`${livepeerApiBaseUrl}/stream/${input.providerStreamId}`, {
        headers: {
          authorization: `Bearer ${apiKey}`
        }
      });

      if (!streamResponse.ok) {
        throw new LiveProviderConfigurationError();
      }

      const stream = (await streamResponse.json()) as LivepeerStreamResponse;
      const providerPlaybackId = stream.playbackId ?? input.providerPlaybackId;
      const playbackUrl = providerPlaybackId ? await findPlaybackUrl(apiKey, providerPlaybackId) : null;
      const isActive = Boolean(stream.isActive);
      const state: LiveProviderRoomStatus["state"] = isActive
        ? "live"
        : stream.lastTerminatedAt
          ? "ended"
          : "waiting";

      return {
        providerStreamId: stream.id ?? input.providerStreamId,
        providerPlaybackId,
        providerState: isActive ? "active" : "idle",
        state,
        playbackUrl
      };
    },
    async createPlaybackJwt(input) {
      if (
        !env.LIVEPEER_ACCESS_CONTROL_PRIVATE_KEY ||
        !env.LIVEPEER_ACCESS_CONTROL_PUBLIC_KEY
      ) {
        return null;
      }

      return signLivepeerPlaybackJwt({
        privateKeyPem: env.LIVEPEER_ACCESS_CONTROL_PRIVATE_KEY,
        issuer: env.API_URL,
        playbackId: input.playbackId,
        subject: input.supabaseUserId
      });
    }
  };
}

async function findPlaybackUrl(apiKey: string, playbackId: string): Promise<string | null> {
  const response = await fetch(`${livepeerApiBaseUrl}/playback/${playbackId}`, {
    headers: {
      authorization: `Bearer ${apiKey}`
    }
  });

  if (!response.ok) {
    return playbackUrlFromPlaybackId(playbackId);
  }

  const payload = (await response.json()) as LivepeerPlaybackResponse;
  const sources = [...(payload.meta?.source ?? []), ...(payload.meta?.dvrPlayback ?? [])];
  const hls = sources.find((source) => source.url?.includes(".m3u8"));

  return hls?.url ?? playbackUrlFromPlaybackId(playbackId);
}

function playbackUrlFromPlaybackId(playbackId: string | undefined): string | null {
  return playbackId ? `https://livepeercdn.studio/hls/${playbackId}/index.m3u8` : null;
}

function signLivepeerPlaybackJwt(input: {
  privateKeyPem: string;
  issuer: string;
  playbackId: string;
  subject: string;
}): string {
  const now = Math.floor(Date.now() / 1000);
  const header = {
    alg: "ES256",
    typ: "JWT"
  };
  const payload = {
    iss: input.issuer,
    sub: input.subject,
    video: input.playbackId,
    iat: now,
    exp: now + 60 * 60
  };
  const unsigned = `${base64UrlJson(header)}.${base64UrlJson(payload)}`;
  const signer = createSign("SHA256");
  signer.update(unsigned);
  signer.end();
  const signature = signer.sign(createPrivateKey(input.privateKeyPem));

  return `${unsigned}.${signature.toString("base64url")}`;
}

function base64UrlJson(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}
