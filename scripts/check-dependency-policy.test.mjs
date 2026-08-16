import { describe, expect, it } from "vitest";
import { validateDependencyPolicy } from "./check-dependency-policy.mjs";

const validInput = {
  npmrc: "inject-workspace-packages=true\nauto-install-peers=false\n",
  lockfile: [
    "lockfileVersion: '9.0'",
    "  '@rolldown/binding-darwin-arm64@1.0.3':",
    "  '@rolldown/binding-darwin-x64@1.0.3':",
    "  '@rolldown/binding-linux-x64-gnu@1.0.3':",
    "  rolldown@1.0.3:",
    "  uuid@11.1.1:",
    "  uuid@14.0.1:",
    ""
  ].join("\n"),
  rootPackage: {
    pnpm: {
      overrides: {
        "uuid@>=8.0.0 <11.1.1": "11.1.1"
      }
    },
    optionalDependencies: {
      "@rolldown/binding-darwin-arm64": "1.0.3",
      "@rolldown/binding-darwin-x64": "1.0.3"
    }
  },
  apiPackage: { dependencies: { fastestsmallesttextencoderdecoder: "1.0.22" } },
  webPackage: {
    dependencies: {
      "@stripe/stripe-js": "1.54.2",
      fastestsmallesttextencoderdecoder: "1.0.22"
    }
  },
  workerPackage: { dependencies: { fastestsmallesttextencoderdecoder: "1.0.22" } },
  uiPackage: { devDependencies: { react: "^19.2.0" } }
};

describe("dependency policy", () => {
  it("accepts explicit runtime peers and patched UUID resolutions", () => {
    expect(validateDependencyPolicy(validInput)).toEqual([]);
  });

  it.each(["image-size@1.2.1", "metro@0.84.4", "react-native@0.86.0", "uuid@9.0.1"])(
    "rejects forbidden lock entry %s",
    (entry) => {
      expect(validateDependencyPolicy({ ...validInput, lockfile: `lockfileVersion: '9.0'\n  ${entry}:\n` })).not.toEqual([]);
    }
  );

  it("rejects automatic peer installation", () => {
    expect(validateDependencyPolicy({ ...validInput, npmrc: "inject-workspace-packages=true\n" })).toContain(
      ".npmrc must disable automatic peer installation"
    );
  });

  it("rejects a missing production Solana codec peer", () => {
    expect(validateDependencyPolicy({
      ...validInput,
      workerPackage: {
        dependencies: {},
        devDependencies: { fastestsmallesttextencoderdecoder: "1.0.22" }
      }
    })).toContain("worker must declare runtime peer fastestsmallesttextencoderdecoder@1.0.22 in dependencies");
  });

  it("rejects a missing UI React development peer", () => {
    expect(validateDependencyPolicy({
      ...validInput,
      uiPackage: { devDependencies: {} }
    })).toContain("ui must declare development peer react@^19.2.0 in devDependencies");
  });

  it("rejects a root Darwin binding that diverges from the Rolldown runtime", () => {
    expect(validateDependencyPolicy({
      ...validInput,
      rootPackage: {
        ...validInput.rootPackage,
        optionalDependencies: {
          ...validInput.rootPackage.optionalDependencies,
          "@rolldown/binding-darwin-arm64": "1.2.4"
        }
      }
    })).toContain("@rolldown/binding-darwin-arm64 must stay version-aligned with rolldown@1.0.3");
  });

  it("rejects a mismatched Darwin binding resolution in the lockfile", () => {
    expect(validateDependencyPolicy({
      ...validInput,
      lockfile: validInput.lockfile.replace(
        "@rolldown/binding-darwin-arm64@1.0.3",
        "@rolldown/binding-darwin-arm64@1.2.4"
      )
    })).toContain("@rolldown/binding-darwin-arm64@1.2.4 must not diverge from rolldown@1.0.3");
  });

  it("rejects a mismatched Linux binding resolution in the lockfile", () => {
    expect(validateDependencyPolicy({
      ...validInput,
      lockfile: validInput.lockfile.replace(
        "@rolldown/binding-linux-x64-gnu@1.0.3",
        "@rolldown/binding-linux-x64-gnu@1.2.4"
      )
    })).toContain("@rolldown/binding-linux-x64-gnu@1.2.4 must not diverge from rolldown@1.0.3");
  });

  it("rejects a lockfile without the matching Rolldown runtime", () => {
    expect(validateDependencyPolicy({
      ...validInput,
      lockfile: validInput.lockfile.replace("  rolldown@1.0.3:\n", "")
    })).toContain("pnpm-lock.yaml must contain rolldown@1.0.3");
  });
});
