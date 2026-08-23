import { createHmac } from "node:crypto";
import { parseServerEnv } from "@veel/config";
import { describe, expect, it } from "vitest";
import {
  MediaWebhookSignatureError,
  normalizeMediaWebhook
} from "../src/modules/content/media-webhook-adapter";

describe("Livepeer safety webhook normalization", () => {
  it.each([
    ["multistream.connected", "target_connected", "healthy"],
    ["multistream.disconnected", "target_disconnected", "disconnected"],
    ["multistream.error", "provider_inconsistent", "inconsistent"]
  ] as const)("normalizes signed %s evidence without granting release", (event, eventKind, normalizedSignal) => {
    const timestamp = Math.floor(Date.now() / 1000);
    const rawBody = Buffer.from(JSON.stringify({
      webhookId: "webhook-1",
      timestamp: String(timestamp),
      event,
      event_object: {
        stream: { id: "stream-1" },
        target: { id: "moderation-target" }
      }
    }));
    const normalized = normalizeMediaWebhook({
      provider: "livepeer",
      body: JSON.parse(rawBody.toString("utf8")),
      rawBody,
      headers: { "livepeer-signature": signature(rawBody, timestamp) },
      env: environment()
    });

    expect(normalized.livepeerSafety).toMatchObject({
      providerStreamId: "stream-1",
      moderationTargetReference: "moderation-target",
      eventKind,
      normalizedSignal
    });
    expect(normalized.providerPlayable).toBe(false);
    expect(normalized.payloadHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("rejects replay metadata when the signed body timestamp and signature header differ", () => {
    const timestamp = Math.floor(Date.now() / 1000);
    const rawBody = Buffer.from(JSON.stringify({
      webhookId: "webhook-2",
      timestamp: String(timestamp - 1),
      event: "multistream.connected",
      event_object: { stream: { id: "stream-1" }, target: { id: "moderation-target" } }
    }));

    expect(() => normalizeMediaWebhook({
      provider: "livepeer",
      body: JSON.parse(rawBody.toString("utf8")),
      rawBody,
      headers: { "livepeer-signature": signature(rawBody, timestamp) },
      env: environment()
    })).toThrow(MediaWebhookSignatureError);
  });

  it("treats stream.started as lifecycle state, never as recurring safety proof", () => {
    const timestamp = Math.floor(Date.now() / 1000);
    const rawBody = Buffer.from(JSON.stringify({
      webhookId: "webhook-started",
      timestamp: String(timestamp),
      event: "stream.started",
      event_object: { stream: { id: "stream-1" }, playbackId: "playback-1" }
    }));

    const normalized = normalizeMediaWebhook({
      provider: "livepeer",
      body: JSON.parse(rawBody.toString("utf8")),
      rawBody,
      headers: { "livepeer-signature": signature(rawBody, timestamp) },
      env: environment()
    });

    expect(normalized.livepeerStream?.roomState).toBe("live");
    expect(normalized.livepeerSafety).toBeUndefined();
  });
});

function signature(rawBody: Buffer, timestamp: number) {
  return `t=${timestamp},v1=${createHmac("sha256", "livepeer-webhook-secret").update(rawBody).digest("hex")}`;
}

function environment() {
  return parseServerEnv({
    NODE_ENV: "test",
    API_URL: "http://localhost:4000",
    WEB_URL: "http://localhost:3000",
    LIVEPEER_WEBHOOK_SECRET: "livepeer-webhook-secret"
  });
}
