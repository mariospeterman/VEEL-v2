import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const FINANCIAL_SIGNAL = /(?:^|[^a-z])(?:amounts?|balances?|checkouts?|commissions?|earnings?|memberships?|payments?|purchases?|receipts?|revenues?|settlements?|spend(?:ing)?|subscribers?|subscriptions?|supports?|tips?|unlocks?|wallets?)(?=$|[^a-z])/i;
const RETIRED_SCORING_SIGNAL = /feed_ranking_sessions|candidate_window|ranking_score|base_score|seen_before|viewer_content_impressions/i;

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
  const pageSelection = sourceBetween(
    feedRepository,
    "page_ids as materialized (",
    "            select\n              ci.id,",
    "chronological feed page selection"
  );
  return [["chronological feed page selection", pageSelection.split("\n")]];
}

export function feedChronologyViolations(feedRepository) {
  const violations = [];
  if (!feedRepository.includes("order by content.published_at desc, content.id desc")) {
    violations.push("feed must order by published_at DESC and id DESC");
  }
  if (!feedRepository.includes("private.eligible_content(")
    || !feedRepository.includes("candidate_ids.ids")) {
    violations.push("feed must use the candidate-bounded canonical eligibility authority on every page");
  }
  if (!feedRepository.includes('input.mode === "following"')
    || !feedRepository.includes("and (${followingFilter})")) {
    violations.push("Following must remain an explicit no-fallback filter");
  }
  if (!feedRepository.includes("content.media_type not in ('text', 'poll')")) {
    violations.push("retired text and poll formats must stay out of primary feeds");
  }
  if (RETIRED_SCORING_SIGNAL.test(feedRepository)) {
    violations.push("retired scoring/session inputs remain in the active feed repository");
  }
  return violations;
}

export function collectRankingPolicyViolations(sources) {
  const implementationBlocks = feedRankingImplementationChecks(sources.feedRepository);
  const chronologyGuidance = bulletBlockAfter(
    sources.recommendationDiscovery,
    "Chronological ordering inputs:"
  );
  return [
    ...feedChronologyViolations(sources.feedRepository),
    ...implementationBlocks.flatMap(([label, lines]) => financialSignalViolations(label, lines)),
    ...financialSignalViolations("chronological ordering guidance", chronologyGuidance)
  ];
}

export function checkRankingPolicy(root = process.cwd()) {
  const read = (path) => readFileSync(`${root}/${path}`, "utf8");
  const violations = collectRankingPolicyViolations({
    feedRepository: read("apps/api/src/modules/content/content-feed-repository.ts"),
    recommendationDiscovery: read("docs/v2-new-build/recommendation-discovery.md")
  });
  if (violations.length > 0) {
    throw new Error(`Chronological feed policy violations:\n- ${violations.join("\n- ")}`);
  }
}

const isDirectRun = process.argv[1]
  && fileURLToPath(import.meta.url) === fileURLToPath(new URL(`file://${process.argv[1]}`));

if (isDirectRun) {
  try {
    checkRankingPolicy();
    console.log("Ranking policy check passed: feeds are chronological, eligibility-gated, and non-financial.");
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
