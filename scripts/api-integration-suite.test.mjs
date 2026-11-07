import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("real API integration suite policy", () => {
  it("discovers every integration suite through one guarded package command", () => {
    const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
    const command = packageJson.scripts["test:integration:api"];
    const suites = readdirSync(new URL("../apps/api/test", import.meta.url))
      .filter((file) => file.endsWith(".integration.test.ts"));

    expect(suites).toEqual(expect.arrayContaining([
      "authenticated-happy-path.integration.test.ts",
      "data-api-authority.integration.test.ts",
      "notification-push-delivery.integration.test.ts",
      "payment-confirmation-email.integration.test.ts",
      "recovery-session-revocation.integration.test.ts"
    ]));
    expect(command).toContain("VEEL_ENABLE_REAL_API_INTEGRATION_TESTS=1");
    expect(command).toContain("--env-file-if-exists=.env");
    expect(command).toContain("apps/api/test/*.integration.test.ts");

    for (const suite of suites) {
      const source = readFileSync(new URL(`../apps/api/test/${suite}`, import.meta.url), "utf8");
      expect(source).toContain('from "./integration-database.js"');
    }
  });

  it("keeps CI on the same authoritative package command", () => {
    const workflow = readFileSync(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8");
    expect(workflow).toContain('API_INTEGRATION_DATABASE_URL="$DB_URL" pnpm test:integration:api');
    expect(workflow).not.toContain("authenticated-happy-path.integration.test.ts apps/api/test");
  });

  it("isolates long-journey identities and serializes global policy mutation", () => {
    const journey = readFileSync(
      new URL("../apps/api/test/authenticated-happy-path.integration.test.ts", import.meta.url),
      "utf8"
    );
    const policy = readFileSync(
      new URL("../apps/api/test/policy-content-eligibility.integration.test.ts", import.meta.url),
      "utf8"
    );

    expect(journey).toContain("const buyerSupabaseUserId = randomUUID()");
    expect(journey).toContain("const creatorSupabaseUserId = randomUUID()");
    expect(journey).toContain("randomBase58Address()");
    expect(journey).toContain("randomBase58Signature()");
    expect(journey).not.toContain('const buyerSupabaseUserId = "10000000-0000-4000-8000-000000000001"');
    expect(journey).toContain("wevid-integration:authenticated-happy-path");
    expect(journey).toContain("pg_advisory_lock");
    expect(journey).toContain("pg_advisory_unlock");
    expect(journey).toContain("journeyLock.release()");
    expect(journey).toContain("delete from mutation_command_receipts");
    expect(journey).toContain("set commercial_policy_override_id = null");
    expect(policy).toContain("pg_advisory_lock");
    expect(policy).toContain("pg_advisory_unlock");
    expect(policy).toContain("policyLock.release()");
  });
});
