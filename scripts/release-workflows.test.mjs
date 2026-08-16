import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const workflow = (name) => readFile(new URL(`../.github/workflows/${name}`, import.meta.url), "utf8");

describe("immutable release workflows", () => {
  it.each(["deploy-staging.yml", "deploy-production.yml"])(
    "%s checks out and verifies the manifest source",
    async (name) => {
      const source = await workflow(name);

      expect(source).toContain("ref: ${{ env.RELEASE_SOURCE_SHA }}");
      expect(source).toContain('gh run download "$RELEASE_RUN_ID" --repo "$GITHUB_REPOSITORY"');
      expect(source).toContain('RELEASE_VERIFY_SOURCE: "true"');
      expect(source).toContain("RELEASE_EXPECTED_SHA: ${{ env.RELEASE_SOURCE_SHA }}");
      expect(source.indexOf("Resolve immutable source") >= 0 || source.indexOf("Resolve exact approved source") >= 0).toBe(true);
      expect(source.indexOf("uses: actions/checkout@v7")).toBeGreaterThan(source.indexOf("RELEASE_SOURCE_SHA=$(node"));
    }
  );

  it("never rebuilds during production promotion", async () => {
    const source = await workflow("deploy-production.yml");

    expect(source).not.toContain("docker build");
    expect(source).not.toContain("docker/build-push-action");
    expect(source).toContain("PROMOTE_EXACT_STAGING_ARTIFACT");
    expect(source).toContain("STAGING_EVIDENCE_MANIFEST_DIGEST");
  });

  it("loads the downloaded staging manifest from its absolute runner path", async () => {
    const source = await workflow("deploy-staging.yml");

    expect(source).toContain("require(process.env.RELEASE_MANIFEST_PATH)");
    expect(source).not.toContain('require("./"+process.env.RELEASE_MANIFEST_PATH)');
  });
});
