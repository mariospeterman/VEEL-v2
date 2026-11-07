import { describe, expect, it } from "vitest";
import { validateProductionAuditReport } from "./audit-production-dependencies.mjs";

const acceptedReport = {
  advisories: {
    "1243066": {
      module_name: "zod",
      severity: "high",
      github_advisory_id: "GHSA-mrhx-c7xc-m3w5",
      url: "https://github.com/advisories/GHSA-mrhx-c7xc-m3w5"
    }
  }
};

describe("production dependency audit policy", () => {
  it("accepts only the exact non-expired provider-owned Zod advisory", () => {
    expect(validateProductionAuditReport(
      acceptedReport,
      new Date("2026-11-04T00:00:00.000Z")
    )).toEqual([]);
  });

  it("rejects an unknown advisory", () => {
    expect(validateProductionAuditReport({
      advisories: {
        "9999999": {
          module_name: "zod",
          severity: "high",
          github_advisory_id: "GHSA-aaaa-bbbb-cccc"
        }
      }
    }, new Date("2026-11-04T00:00:00.000Z"))).toContain(
      "unaccepted production advisory for zod: GHSA-aaaa-bbbb-cccc"
    );
  });

  it("rejects the accepted advisory after its expiry", () => {
    expect(validateProductionAuditReport(
      acceptedReport,
      new Date("2026-11-18T00:00:00.000Z")
    )).toContain("GHSA-mrhx-c7xc-m3w5 acceptance expired at 2026-11-18T00:00:00.000Z");
  });

  it("accepts a clean report", () => {
    expect(validateProductionAuditReport({ advisories: {} })).toEqual([]);
  });

  it("fails closed on an unexpected audit schema", () => {
    expect(validateProductionAuditReport({ vulnerabilities: {} })).toEqual([
      "pnpm audit report is missing its advisories object"
    ]);
  });
});
