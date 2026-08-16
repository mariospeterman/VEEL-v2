#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const expectedRuntimePeers = {
  api: {
    fastestsmallesttextencoderdecoder: "1.0.22"
  },
  web: {
    "@stripe/stripe-js": "1.54.2",
    fastestsmallesttextencoderdecoder: "1.0.22"
  },
  worker: {
    fastestsmallesttextencoderdecoder: "1.0.22"
  },
  ui: {
    react: "^19.2.0"
  }
};

export function validateDependencyPolicy({ npmrc, lockfile, rootPackage, apiPackage, webPackage, workerPackage, uiPackage }) {
  const errors = [];

  if (!npmrc.split(/\r?\n/u).some((line) => line.trim() === "auto-install-peers=false")) {
    errors.push(".npmrc must disable automatic peer installation");
  }

  const manifests = { api: apiPackage, web: webPackage, worker: workerPackage, ui: uiPackage };
  for (const [workspace, peers] of Object.entries(expectedRuntimePeers)) {
    for (const [name, version] of Object.entries(peers)) {
      const manifest = manifests[workspace];
      const declaredVersion = manifest?.dependencies?.[name] ?? manifest?.devDependencies?.[name];
      if (declaredVersion !== version) {
        errors.push(`${workspace} must declare peer support ${name}@${version}`);
      }
    }
  }

  if (rootPackage?.pnpm?.overrides?.["uuid@>=8.0.0 <11.1.1"] !== "11.1.1") {
    errors.push("pnpm must override vulnerable uuid 8-10 releases to 11.1.1");
  }

  const forbiddenLockEntries = [
    ["image-size", /^ {2}image-size@/mu],
    ["metro", /^ {2}metro@/mu],
    ["react-native", /^ {2}react-native@/mu],
    ["uuid before 11.1.1", /^ {2}uuid@(?:8|9|10)\./mu]
  ];
  for (const [name, pattern] of forbiddenLockEntries) {
    if (pattern.test(lockfile)) {
      errors.push(`pnpm-lock.yaml must not contain ${name}`);
    }
  }

  return errors;
}

async function main() {
  const [npmrc, lockfile, rootPackage, apiPackage, webPackage, workerPackage, uiPackage] = await Promise.all([
    readFile(".npmrc", "utf8"),
    readFile("pnpm-lock.yaml", "utf8"),
    readJson("package.json"),
    readJson("apps/api/package.json"),
    readJson("apps/web/package.json"),
    readJson("apps/worker/package.json"),
    readJson("packages/ui/package.json")
  ]);

  const errors = validateDependencyPolicy({ npmrc, lockfile, rootPackage, apiPackage, webPackage, workerPackage, uiPackage });
  if (errors.length > 0) {
    throw new Error(`Dependency policy check failed:\n- ${errors.join("\n- ")}`);
  }

  console.log("Dependency peer and vulnerable-resolution policy checks passed.");
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
