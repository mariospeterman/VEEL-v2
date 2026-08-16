import { describe, expect, it } from "vitest";
import { validateDependencyPolicy } from "./check-dependency-policy.mjs";

const validInput = {
  npmrc: "inject-workspace-packages=true\nauto-install-peers=false\n",
  lockfile: "lockfileVersion: '9.0'\n  uuid@11.1.1:\n  uuid@14.0.1:\n",
  rootPackage: {
    pnpm: {
      overrides: {
        "uuid@>=8.0.0 <11.1.1": "11.1.1"
      }
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

  it("rejects a missing explicit Solana codec peer", () => {
    expect(validateDependencyPolicy({
      ...validInput,
      workerPackage: { dependencies: {} }
    })).toContain("worker must declare peer support fastestsmallesttextencoderdecoder@1.0.22");
  });

  it("rejects a missing UI React development peer", () => {
    expect(validateDependencyPolicy({
      ...validInput,
      uiPackage: { devDependencies: {} }
    })).toContain("ui must declare peer support react@^19.2.0");
  });
});
