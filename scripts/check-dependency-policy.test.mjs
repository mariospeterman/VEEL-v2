import { describe, expect, it } from "vitest";
import { validateDependencyPolicy } from "./check-dependency-policy.mjs";

const securityOverrides = {
  "@grpc/grpc-js@>=1.14.0 <1.14.5": "1.14.5",
  "axios@>=1.15.2 <1.20.0": "1.20.0",
  "brace-expansion@>=2.0.0 <2.1.7": "2.1.7",
  "decode-uri-component@<=0.5.0": "0.5.1",
  "fast-copy@>=3.0.0 <3.1.0": "3.1.0",
  "fast-uri@>=3.0.0 <3.1.9": "3.1.9",
  "fast-uri@>=4.0.0 <4.2.3": "4.2.3",
  "follow-redirects@>=1.16.0 <1.16.2": "1.16.2",
  "gaxios@7.1.3>rimraf": "-",
  "hono@<4.13.11": "4.13.11",
  "ip-address@<=10.7.3": "10.7.4",
  "source-map-js@>=1.0.0 <1.2.2": "1.2.2",
  "stream-json@<3.7.0": "3.7.0",
  "systeminformation@<5.33.16": "5.33.16",
  "uuid@>=8.0.0 <11.1.1": "11.1.1",
  "ws@>=8.0.0 <8.21.0": "8.21.3"
};

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
    engines: { node: ">=22.23.4 <23" },
    pnpm: {
      overrides: securityOverrides
    },
    optionalDependencies: {
      "@rolldown/binding-darwin-arm64": "1.0.3",
      "@rolldown/binding-darwin-x64": "1.0.3"
    }
  },
  apiPackage: {
    dependencies: {
      "@coinbase/cdp-sdk": "1.60.0",
      fastestsmallesttextencoderdecoder: "1.0.22",
      fastify: "5.12.8",
      sharp: "0.35.5"
    }
  },
  webPackage: {
    dependencies: {
      "@privy-io/react-auth": "3.51.1",
      "@stripe/stripe-js": "1.54.2",
      fastestsmallesttextencoderdecoder: "1.0.22",
      next: "16.4.5"
    }
  },
  workerPackage: { dependencies: { fastestsmallesttextencoderdecoder: "1.0.22" } },
  uiPackage: { devDependencies: { react: "^19.2.0" } },
  configPackage: { dependencies: { zod: "4.6.7" } }
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

  it("rejects removal of the scoped gaxios rimraf pruning policy", () => {
    expect(validateDependencyPolicy({
      ...validInput,
      rootPackage: {
        ...validInput.rootPackage,
        pnpm: {
          overrides: {
            ...securityOverrides,
            "gaxios@7.1.3>rimraf": undefined
          }
        }
      }
    })).toContain("pnpm security override gaxios@7.1.3>rimraf must remain -");
  });

  it("rejects a lockfile that retains rimraf beneath gaxios", () => {
    expect(validateDependencyPolicy({
      ...validInput,
      lockfile: `${validInput.lockfile}  gaxios@7.1.3:\n    dependencies:\n      rimraf: 5.0.10\n`
    })).toContain("gaxios@7.1.3 must not retain its unused vulnerable rimraf production dependency");
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
