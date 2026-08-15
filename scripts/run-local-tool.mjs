import { existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { spawn, spawnSync } from "node:child_process";

const repoRoot = resolve(import.meta.dirname, "..");
const command = process.argv[2];
const args = process.argv.slice(3);

const parseVersion = (version) => {
  const match = version.match(/^v?(\d+)\.(\d+)\.(\d+)/);
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    raw: version.replace(/^v/, "")
  };
};

const compareVersion = (a, b) =>
  a.major - b.major || a.minor - b.minor || a.patch - b.patch;

const isCodexBundledNode = (candidate) =>
  process.platform === "darwin" && candidate.includes("/Applications/Codex.app/");

const getCandidateNodes = () => {
  const candidates = [];
  if (process.env.VEEL_NODE_BINARY) candidates.push(process.env.VEEL_NODE_BINARY);

  const nvmRoot = join(process.env.HOME ?? "", ".nvm/versions/node");
  if (existsSync(nvmRoot)) {
    const nvmCandidates = readdirSync(nvmRoot)
      .map((entry) => ({ entry, version: parseVersion(entry) }))
      .filter((candidate) => candidate.version && candidate.version.major >= 22)
      .sort((a, b) => {
        if (a.version.major === 22 && b.version.major !== 22) return -1;
        if (b.version.major === 22 && a.version.major !== 22) return 1;
        return compareVersion(b.version, a.version);
      });

    for (const candidate of nvmCandidates) {
      candidates.push(join(nvmRoot, candidate.entry, "bin/node"));
    }
  }

  candidates.push("/opt/homebrew/bin/node", "/usr/local/bin/node");
  if (!isCodexBundledNode(process.execPath)) candidates.push(process.execPath);
  return [...new Set(candidates)].filter((candidate) => {
    try {
      return existsSync(candidate) && statSync(candidate).isFile();
    } catch {
      return false;
    }
  });
};

const inspectNode = (candidate) => {
  const result = spawnSync(candidate, ["-p", "process.versions.node"], {
    cwd: repoRoot,
    encoding: "utf8",
    timeout: 15_000
  });
  if (result.status !== 0) return null;
  const version = parseVersion(result.stdout.trim());
  if (!version || version.major < 22) return null;
  return { path: candidate, version };
};

const selectNode = () => {
  for (const candidate of getCandidateNodes()) {
    const inspected = inspectNode(candidate);
    if (inspected) return inspected;
  }

  console.error("No usable Node.js >=22 binary found. Set VEEL_NODE_BINARY to a non-hardened Node binary.");
  process.exit(1);
};

const resolveTool = () => {
  if (command === "vitest") {
    return {
      executable: join(repoRoot, "node_modules/vitest/vitest.mjs"),
      cwd: repoRoot,
      args
    };
  }

  if (command === "playwright") {
    mkdirSync(join(repoRoot, "test-results"), { recursive: true });
    return {
      executable: join(repoRoot, "node_modules/@playwright/test/cli.js"),
      cwd: repoRoot,
      args
    };
  }

  if (command === "web-dev") {
    return {
      executable: join(repoRoot, "apps/web/node_modules/next/dist/bin/next"),
      cwd: join(repoRoot, "apps/web"),
      args: ["dev", "--webpack", "--port", "3000", "--hostname", "127.0.0.1", ...args]
    };
  }

  if (command === "web-build") {
    return {
      executable: join(repoRoot, "apps/web/node_modules/next/dist/bin/next"),
      cwd: join(repoRoot, "apps/web"),
      args: ["build", "--webpack", ...args]
    };
  }

  if (command === "web-preview") {
    return {
      executable: join(repoRoot, "apps/web/node_modules/next/dist/bin/next"),
      cwd: join(repoRoot, "apps/web"),
      args: ["start", "--port", "3000", "--hostname", "127.0.0.1", ...args]
    };
  }

  console.error(`Unknown local tool command: ${command ?? "<missing>"}`);
  process.exit(1);
};

const node = selectNode();
const tool = resolveTool();
const childEnv = {
  ...process.env,
  PATH: `${dirname(node.path)}:${process.env.PATH ?? ""}`
};
if (childEnv.FORCE_COLOR) delete childEnv.NO_COLOR;

const child = spawn(node.path, [tool.executable, ...tool.args], {
  cwd: tool.cwd,
  env: childEnv,
  stdio: "inherit"
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 1);
});
