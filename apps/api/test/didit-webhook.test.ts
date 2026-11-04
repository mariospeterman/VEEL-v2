import { describe, expect, it } from "vitest";
import {
  canonicalDiditJson,
  verifyDiditV3Webhook
} from "../src/modules/verification/didit-webhook.js";

// Payload copied from Didit's documented V3 session-envelope example on 2026-11-04:
// https://docs.didit.me/integration/webhooks#session-envelope-example
const documentedEnvelope = {
  event_id: "9c0c8b8a-1111-4222-9333-444444444444",
  webhook_type: "status.updated",
  timestamp: 1774970000,
  created_at: 1774969994,
  application_id: "11111111-2222-3333-4444-555555555555",
  environment: "live",
  sandbox_scenario: null,
  session_id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
  status: "Approved",
  workflow_id: "66666666-7777-8888-9999-000000000000",
  workflow_version: 4,
  vendor_data: "user_42",
  metadata: { tier: "premium" },
  decision: { "...": "see /sessions-api/retrieve-session" }
} as const;

const fixtureSecret = "didit-documented-fixture-secret";
// HMAC-SHA256 over Didit's documented recursively sorted, compact, Unicode-preserved JSON.
const fixtureSignature = "44d32f30e50375c2400b082c53d05987731c9c9a140e7061ff12cddb0dc13bf5";

describe("Didit V3 webhook verification", () => {
  it("accepts a fresh documented envelope whose body timestamp is V2-signed", () => {
    expect(canonicalDiditJson(documentedEnvelope)).toBe(
      '{"application_id":"11111111-2222-3333-4444-555555555555","created_at":1774969994,"decision":{"...":"see /sessions-api/retrieve-session"},"environment":"live","event_id":"9c0c8b8a-1111-4222-9333-444444444444","metadata":{"tier":"premium"},"sandbox_scenario":null,"session_id":"aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee","status":"Approved","timestamp":1774970000,"vendor_data":"user_42","webhook_type":"status.updated","workflow_id":"66666666-7777-8888-9999-000000000000","workflow_version":4}'
    );
    expect(verifyAt(documentedEnvelope, String(documentedEnvelope.timestamp), 60)).toBe(
      fixtureSignature
    );
  });

  it("rejects a stale webhook even when its documented V2 signature is valid", () => {
    expect(verifyAt(documentedEnvelope, String(documentedEnvelope.timestamp), 301)).toBeNull();
  });

  it("rejects replay of an old signed body with a refreshed unsigned header", () => {
    expect(
      verifyDiditV3Webhook({
        body: documentedEnvelope,
        headers: {
          "x-signature-v2": fixtureSignature,
          "x-timestamp": String(documentedEnvelope.timestamp + 86_400)
        },
        secret: fixtureSecret,
        now: new Date((documentedEnvelope.timestamp + 86_400) * 1000)
      })
    ).toBeNull();
  });

  it("fails closed when the signed body omits the V3 dispatch timestamp", () => {
    const { timestamp: _timestamp, ...bodyWithoutTimestamp } = documentedEnvelope;
    expect(
      verifyDiditV3Webhook({
        body: bodyWithoutTimestamp,
        headers: {
          "x-signature-v2": fixtureSignature,
          "x-timestamp": String(documentedEnvelope.timestamp)
        },
        secret: fixtureSecret,
        now: new Date(documentedEnvelope.timestamp * 1000)
      })
    ).toBeNull();
  });
});

function verifyAt(body: unknown, timestampHeader: string, offsetSeconds: number): string | null {
  return verifyDiditV3Webhook({
    body,
    headers: {
      "x-signature-v2": fixtureSignature,
      "x-timestamp": timestampHeader
    },
    secret: fixtureSecret,
    now: new Date((documentedEnvelope.timestamp + offsetSeconds) * 1000)
  });
}
