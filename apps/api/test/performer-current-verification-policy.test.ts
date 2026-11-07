import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  new URL("../src/modules/performer/performer-repository.ts", import.meta.url),
  "utf8"
);

describe("performer current-verification policy", () => {
  it("never maps a fact-incomplete canonical valid row to consent-ready", () => {
    expect(
      source.match(/when current_performer\.status = 'valid' then 'pending'/g)
    ).toHaveLength(2);
    expect(source).toContain("current_performer.threshold_age >= 18");
    expect(source).toContain("current_performer.result_over_threshold is true");
  });

  it("derives performer adulthood only from explicit adult-publisher facts", () => {
    const derivation = source.slice(
      source.indexOf("async function deriveReusablePerformerEvidence"),
      source.indexOf("async function respond")
    );
    expect(derivation).toContain("'adult_publisher_eligibility'");
    expect(derivation).toContain("source.threshold_age >= 18");
    expect(derivation).toContain("source.threshold_age, source.result_over_threshold");
    expect(derivation).not.toContain("'creator_kyc'");
    expect(derivation).not.toContain("18, true, source.assurance_level");
  });
});
