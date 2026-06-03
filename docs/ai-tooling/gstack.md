# GStack Boundary

Status: accepted
Scope: AI-assisted review, planning, QA, security critique, and release critique

GStack is installed locally for Codex at `~/.codex/skills` from `~/.gstack/repos/gstack`.

Use GStack only as an advisory tool for:

- planning review
- engineering critique
- design review
- QA planning
- security review
- release review

GStack must use these Veel v2 sources before giving guidance:

- `AGENTS.md`
- `CLAUDE.md`
- `.cursor/rules/veel-v2.mdc`
- `docs/v2-new-build/INDEX.md`
- `docs/v2-new-build/build-plan.md`
- `packages/contracts/openapi.yaml`
- `packages/database/schema-blueprint.sql`

GStack does not override Veel v2 source of truth. When GStack advice conflicts with OpenAPI, schema, ADRs, provider docs, tests, or compliance docs, the Veel v2 source of truth wins.
