#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const expectedServiceRuntimePeers = {
  api: {
    fastestsmallesttextencoderdecoder: "1.0.22"
  },
  web: {
    "@stripe/stripe-js": "1.54.2",
    fastestsmallesttextencoderdecoder: "1.0.22"
  },
  worker: {
    fastestsmallesttextencoderdecoder: "1.0.22"
  }
};

const expectedUiDevelopmentPeers = {
  react: "^19.2.0"
};

const expectedRolldownRuntimeVersion = "1.0.3";
const expectedNodeEngine = ">=22.23.4 <23";
const expectedRolldownDarwinBindings = [
  "@rolldown/binding-darwin-arm64",
  "@rolldown/binding-darwin-x64"
];

const expectedSecurityOverrides = {
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

const expectedPinnedProductionDependencies = {
  api: {
    "@coinbase/cdp-sdk": "1.60.0",
    fastify: "5.12.8",
    sharp: "0.35.5"
  },
  config: {
    zod: "4.6.7"
  },
  web: {
    "@privy-io/react-auth": "3.51.1",
    next: "16.4.5"
  }
};

export function validateDependencyPolicy({ npmrc, lockfile, rootPackage, apiPackage, webPackage, workerPackage, uiPackage, configPackage }) {
  const errors = [];

  if (!npmrc.split(/\r?\n/u).some((line) => line.trim() === "auto-install-peers=false")) {
    errors.push(".npmrc must disable automatic peer installation");
  }

  const serviceManifests = { api: apiPackage, web: webPackage, worker: workerPackage };
  for (const [workspace, peers] of Object.entries(expectedServiceRuntimePeers)) {
    for (const [name, version] of Object.entries(peers)) {
      if (serviceManifests[workspace]?.dependencies?.[name] !== version) {
        errors.push(`${workspace} must declare runtime peer ${name}@${version} in dependencies`);
      }
    }
  }

  for (const [name, version] of Object.entries(expectedUiDevelopmentPeers)) {
    if (uiPackage?.devDependencies?.[name] !== version) {
      errors.push(`ui must declare development peer ${name}@${version} in devDependencies`);
    }
  }

  if (rootPackage?.engines?.node !== expectedNodeEngine) {
    errors.push(`root Node engine must remain ${expectedNodeEngine}`);
  }

  const pinnedManifests = { api: apiPackage, config: configPackage, web: webPackage };
  for (const [workspace, dependencies] of Object.entries(expectedPinnedProductionDependencies)) {
    for (const [name, version] of Object.entries(dependencies)) {
      if (pinnedManifests[workspace]?.dependencies?.[name] !== version) {
        errors.push(`${workspace} must pin ${name}@${version}`);
      }
    }
  }

  for (const [selector, version] of Object.entries(expectedSecurityOverrides)) {
    if (rootPackage?.pnpm?.overrides?.[selector] !== version) {
      errors.push(`pnpm security override ${selector} must remain ${version}`);
    }
  }

  const gaxiosBlocks = [...lockfile.matchAll(/^ {2}gaxios@7\.1\.3:\n((?: {4,}.*\n)*)/gmu)];
  if (gaxiosBlocks.some(([, block]) => /^ {6}rimraf:/mu.test(block))) {
    errors.push("gaxios@7.1.3 must not retain its unused vulnerable rimraf production dependency");
  }

  for (const binding of expectedRolldownDarwinBindings) {
    if (rootPackage?.optionalDependencies?.[binding] !== expectedRolldownRuntimeVersion) {
      errors.push(`${binding} must stay version-aligned with rolldown@${expectedRolldownRuntimeVersion}`);
    }
  }

  if (!new RegExp(`^ {2}rolldown@${escapeRegExp(expectedRolldownRuntimeVersion)}:`, "mu").test(lockfile)) {
    errors.push(`pnpm-lock.yaml must contain rolldown@${expectedRolldownRuntimeVersion}`);
  }

  const rolldownBindingEntries = lockfile.matchAll(
    /^ {2}'?(@rolldown\/binding-[^@':\s]+)@([^':\s]+)'?:/gmu
  );
  for (const [, binding, version] of rolldownBindingEntries) {
    if (version !== expectedRolldownRuntimeVersion) {
      errors.push(`${binding}@${version} must not diverge from rolldown@${expectedRolldownRuntimeVersion}`);
    }
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
  const [npmrc, lockfile, rootPackage, apiPackage, webPackage, workerPackage, uiPackage, configPackage] = await Promise.all([
    readFile(".npmrc", "utf8"),
    readFile("pnpm-lock.yaml", "utf8"),
    readJson("package.json"),
    readJson("apps/api/package.json"),
    readJson("apps/web/package.json"),
    readJson("apps/worker/package.json"),
    readJson("packages/ui/package.json"),
    readJson("packages/config/package.json")
  ]);

  const errors = validateDependencyPolicy({ npmrc, lockfile, rootPackage, apiPackage, webPackage, workerPackage, uiPackage, configPackage });
  if (errors.length > 0) {
    throw new Error(`Dependency policy check failed:\n- ${errors.join("\n- ")}`);
  }

  console.log("Dependency peer and vulnerable-resolution policy checks passed.");
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
