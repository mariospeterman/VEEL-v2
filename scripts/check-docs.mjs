import { existsSync } from "node:fs";

const required = [
  "docs/v2-new-build/INDEX.md",
  "docs/v2-new-build/build-plan.md",
  "docs/v2-new-build/full-platform-blueprint.md",
  "docs/v2-new-build/diagrams.md",
  "docs/v2-new-build/app-architecture.md",
  "docs/v2-new-build/stack-decision.md",
  "docs/v2-new-build/product/dating-mode.md",
  "docs/v2-new-build/product/events-ticketing.md",
  "docs/v2-new-build/compliance/adult-content-compliance.md",
  "docs/v2-new-build/compliance/age-kyc-jurisdictions.md",
  "docs/v2-new-build/frontend/design-system.md",
  "docs/v2-new-build/frontend/component-map.md",
  "docs/v2-new-build/frontend/copy-system.md",
  "docs/v2-new-build/frontend/motion-system.md",
  "docs/v2-new-build/providers/identity-provider-wiring.md",
  "docs/v2-new-build/providers/content-protection.md",
  "docs/v2-new-build/providers/provider-map.md",
  "AGENTS.md",
  "CLAUDE.md",
  ".cursor/rules/veel-v2.mdc",
  "docs/ai-tooling/agent-operating-rules.md",
  ".env.example"
];

const missing = required.filter((path) => !existsSync(path));

if (missing.length > 0) {
  console.error("Missing required scaffold files:");
  for (const path of missing) {
    console.error(`- ${path}`);
  }
  process.exit(1);
}

console.log("Veel v2 scaffold docs are present.");
