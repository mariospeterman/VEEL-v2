import { describe, expect, it, vi } from "vitest";
import {
  EnterpriseProofError,
  runEnterpriseProjectionProof
} from "../apps/api/scripts/prove-enterprise-managed-creators.mjs";

const baseEnv = {
  API_URL: "https://staging.wevid.example",
  ENTERPRISE_STAGING_SESSION_COOKIE: "redacted-session-cookie",
  ENTERPRISE_STAGING_ORGANIZATION_ID: "organization-1",
  ENTERPRISE_STAGING_RELATIONSHIP_ID: "relationship-1"
};

function response(body) {
  return {
    ok: true,
    status: 200,
    async json() {
      return body;
    }
  };
}

function projectionFetch({ totals = [] } = {}) {
  return vi.fn(async (url, init) => {
    expect(init.signal).toBeInstanceOf(AbortSignal);
    if (url.pathname === "/v1/organizations") {
      return response({
        items: [
          {
            organization: { organizationId: "organization-1", state: "active" },
            governance: { kybState: "verified" },
            capabilities: { rbacEnabled: true }
          }
        ]
      });
    }
    if (url.pathname === "/v1/managed-creator-relationships") {
      return response({
        items: [
          {
            id: "relationship-1",
            organizationId: "organization-1",
            state: "active",
            agreementState: "accepted",
            organizationKybReady: true,
            enterpriseEntitlementReady: true,
            settlementWalletReady: true
          }
        ]
      });
    }
    return response({
      relationshipId: "relationship-1",
      totals,
      financeBoundary: "confirmed_allocations_only_no_balance_no_withdrawal_no_payout_queue"
    });
  });
}

describe("enterprise projection proof", () => {
  it("reports application projection smoke without claiming provider evidence", async () => {
    const fetchImpl = projectionFetch({ totals: [{ currency: "USDC" }] });
    const result = await runEnterpriseProjectionProof({ env: baseEnv, fetchImpl });

    expect(result).toEqual({
      state: "APPLICATION_PROJECTION_SMOKE",
      organization: { active: true, normalizedKybVerified: true, enterpriseEntitlement: true },
      managedCreator: { active: true, agreementAccepted: true, settlementWalletReady: true },
      reporting: { currencyBuckets: 1 },
      providerEvidence: "REQUIRES_RELEASE_BOUND_ENTERPRISE_EVIDENCE"
    });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("rejects an invalid reporting shape instead of treating it as zero buckets", async () => {
    const fetchImpl = projectionFetch();
    fetchImpl.mockImplementationOnce(async () => response({ items: [] }));
    await expect(
      runEnterpriseProjectionProof({ env: baseEnv, fetchImpl })
    ).rejects.toBeInstanceOf(EnterpriseProofError);

    const invalidReportingFetch = vi.fn(async (url) => {
      if (url.pathname === "/v1/organizations") {
        return response({
          items: [{
            organization: { organizationId: "organization-1", state: "active" },
            governance: { kybState: "verified" },
            capabilities: { rbacEnabled: true }
          }]
        });
      }
      if (url.pathname === "/v1/managed-creator-relationships") {
        return response({
          items: [{
            id: "relationship-1",
            organizationId: "organization-1",
            state: "active",
            agreementState: "accepted",
            organizationKybReady: true,
            enterpriseEntitlementReady: true,
            settlementWalletReady: true
          }]
        });
      }
      return response({
        relationshipId: "relationship-1",
        financeBoundary: "confirmed_allocations_only_no_balance_no_withdrawal_no_payout_queue"
      });
    });

    await expect(
      runEnterpriseProjectionProof({ env: baseEnv, fetchImpl: invalidReportingFetch })
    ).rejects.toThrow(/reporting_totals_invalid/);
  });

  it("fails closed when the required projection target is not configured", async () => {
    await expect(
      runEnterpriseProjectionProof({ env: { API_URL: baseEnv.API_URL }, fetchImpl: projectionFetch() })
    ).rejects.toMatchObject({ code: "CODE_COMPLETE_PROVIDER_BLOCKED", exitCode: 2 });
  });
});
