import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const FINANCIAL_SIGNAL = /(?:^|[^a-z])(?:amounts?|balances?|checkouts?|commissions?|earnings?|entitlements?|memberships?|payments?|purchases?|receipts?|revenues?|settlements?|spend(?:ing)?|subscribers?|subscriptions?|supports?|tips?|unlocks?|wallets?)(?=$|[^a-z])/i;

function sourceBetween(source, start, end, label) {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  if (startIndex < 0 || endIndex < 0) {
    throw new Error(`Ranking policy could not locate ${label}.`);
  }
  return source.slice(startIndex, endIndex);
}

export function bulletBlockAfter(source, marker) {
  const markerIndex = source.indexOf(marker);
  if (markerIndex < 0) throw new Error(`Ranking policy could not locate ${marker}.`);
  const remainder = source.slice(markerIndex + marker.length);
  const lines = remainder.split("\n");
  const bullets = [];
  let started = false;
  for (const line of lines) {
    if (/^- /.test(line)) {
      started = true;
      bullets.push(line);
      continue;
    }
    if (started && line.trim() === "") break;
    if (started) break;
  }
  if (bullets.length === 0) {
    throw new Error(`Ranking policy found no bullets after ${marker}.`);
  }
  return bullets;
}

export function financialSignalViolations(label, lines) {
  return lines
    .filter((line) => FINANCIAL_SIGNAL.test(line))
    .map((line) => `${label}: ${line.trim()}`);
}

export function feedRankingImplementationChecks(feedRepository) {
  const candidateInputs = sourceBetween(
    feedRepository,
    "candidate_window as materialized (",
    "authorized as materialized (",
    "feed ranking candidate inputs",
  );
  const scoreInputs = sourceBetween(
    feedRepository,
    "eligible as (",
    "snapshot as (",
    "feed ranking score inputs",
  );

  return [
    ["feed ranking candidate inputs", candidateInputs.split("\n")],
    ["feed ranking score inputs", scoreInputs.split("\n")],
  ];
}

export function collectRankingPolicyViolations(sources) {
  const checks = [
    ...feedRankingImplementationChecks(sources.feedRepository),
    [
      "profile recommended rankings",
      bulletBlockAfter(sources.profileRanking, "Recommended launch rankings:"),
    ],
    ["profile ranking inputs", bulletBlockAfter(sources.profileRanking, "Ranking inputs:")],
    [
      "engagement ranking inputs",
      bulletBlockAfter(sources.engagementStrategy, "Allowed ranking signals:"),
    ],
    [
      "recommendation inputs",
      bulletBlockAfter(sources.recommendationDiscovery, "Backend ranking may use:"),
    ],
    [
      "recommendation goals",
      bulletBlockAfter(sources.recommendationDiscovery, "Rank for:"),
    ],
  ];

  return checks.flatMap(([label, lines]) => financialSignalViolations(label, lines));
}

export function checkRankingPolicy(root = process.cwd()) {
  const read = (path) => readFileSync(`${root}/${path}`, "utf8");
  const violations = collectRankingPolicyViolations({
    feedRepository: read("apps/api/src/modules/content/content-feed-repository.ts"),
    profileRanking: read("docs/v2-new-build/profile-activity-ranking.md"),
    engagementStrategy: read("docs/v2-new-build/engagement-strategy.md"),
    recommendationDiscovery: read("docs/v2-new-build/recommendation-discovery.md"),
  });
  if (violations.length > 0) {
    throw new Error(`Money-based ranking policy violations:\n- ${violations.join("\n- ")}`);
  }
}

const isDirectRun = process.argv[1]
  && fileURLToPath(import.meta.url) === fileURLToPath(new URL(`file://${process.argv[1]}`));

if (isDirectRun) {
  try {
    checkRankingPolicy();
    console.log("Ranking policy check passed: scoring and active allowed-signal lists are non-financial.");
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
