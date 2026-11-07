import { describe, expect, it } from "vitest";
import { normalizeSupabaseRecoveryIdentity } from "../src/modules/session/supabase-auth";

const now = new Date("2026-11-04T16:00:00.000Z");
const providerSubject = "00000000-0000-4000-8000-000000000101";
const providerSessionId = "00000000-0000-4000-8000-000000000102";

function claims(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    sub: providerSubject,
    session_id: providerSessionId,
    aud: "authenticated",
    role: "authenticated",
    is_anonymous: false,
    email: "recovery@example.test",
    amr: [{ method: "password", timestamp: Date.parse("2026-11-04T15:30:00.000Z") / 1000 }],
    ...overrides
  };
}

function user(overrides: Record<string, unknown> = {}) {
  return {
    id: providerSubject,
    aud: "authenticated",
    role: "authenticated",
    is_anonymous: false,
    email: "recovery@example.test",
    ...overrides
  };
}

describe("Supabase recovery identity normalization", () => {
  it("preserves the newest genuine timestamped authentication and signed session id", () => {
    const identity = normalizeSupabaseRecoveryIdentity(
      claims({
        amr: [
          { method: "password", timestamp: Date.parse("2026-11-04T14:00:00.000Z") / 1000 },
          { method: "token_refresh", timestamp: Date.parse("2026-11-04T15:55:00.000Z") / 1000 },
          { method: "totp", timestamp: Date.parse("2026-11-04T15:45:00.000Z") / 1000 }
        ]
      }),
      user(),
      now
    );

    expect(identity).toEqual({
      provider: "supabase",
      providerSubject,
      providerSessionId,
      authenticatedAt: new Date("2026-11-04T15:45:00.000Z"),
      email: "recovery@example.test"
    });
  });

  it.each([
    ["missing AMR", undefined],
    ["string-only AMR", ["password"]],
    ["malformed AMR", [{ method: "password" }]],
    ["refresh-only AMR", [{ method: "token_refresh", timestamp: Date.parse("2026-11-04T15:55:00.000Z") / 1000 }]],
    ["future AMR", [{ method: "password", timestamp: Date.parse("2026-11-04T16:00:01.000Z") / 1000 }]]
  ])("rejects %s instead of manufacturing freshness from JWT issuance", (_label, amr) => {
    expect(normalizeSupabaseRecoveryIdentity(claims({ amr }), user(), now)).toBeNull();
  });

  it("rejects anonymous, wrong-role, and non-authenticated audience claims", () => {
    expect(normalizeSupabaseRecoveryIdentity(claims({ is_anonymous: true }), user(), now)).toBeNull();
    expect(normalizeSupabaseRecoveryIdentity(claims({ role: "anon" }), user(), now)).toBeNull();
    expect(normalizeSupabaseRecoveryIdentity(claims({ aud: "anon" }), user(), now)).toBeNull();
  });

  it("rejects claim/user mismatch and malformed session identifiers", () => {
    expect(normalizeSupabaseRecoveryIdentity(claims(), user({ id: "00000000-0000-4000-8000-000000000199" }), now)).toBeNull();
    expect(normalizeSupabaseRecoveryIdentity(claims({ session_id: "not-a-uuid" }), user(), now)).toBeNull();
    expect(normalizeSupabaseRecoveryIdentity(claims(), user({ email: "different@example.test" }), now)).toBeNull();
  });
});
