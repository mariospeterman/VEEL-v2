import { pathToFileURL } from "node:url";

const required = [
  "API_URL",
  "ENTERPRISE_STAGING_SESSION_COOKIE",
  "ENTERPRISE_STAGING_ORGANIZATION_ID",
  "ENTERPRISE_STAGING_RELATIONSHIP_ID"
];

const defaultTimeoutMs = 10_000;

export async function runEnterpriseProjectionProof({
  env = process.env,
  fetchImpl = fetch,
  timeoutMs = defaultTimeoutMs
} = {}) {
  const missing = required.filter((key) => !env[key]?.trim());
  if (missing.length > 0) {
    throw new EnterpriseProofError(
      "CODE_COMPLETE_PROVIDER_BLOCKED",
      `missing=${missing.join(",")}`,
      2
    );
  }

  const apiUrl = new URL(env.API_URL);
  if (apiUrl.protocol !== "https:" && !["localhost", "127.0.0.1"].includes(apiUrl.hostname)) {
    throw new EnterpriseProofError(
      "ENTERPRISE_PROJECTION_SMOKE_FAILED",
      "API_URL_must_use_HTTPS_outside_localhost"
    );
  }

  const organizationId = env.ENTERPRISE_STAGING_ORGANIZATION_ID;
  const relationshipId = env.ENTERPRISE_STAGING_RELATIONSHIP_ID;
  const getJson = createJsonFetcher({
    apiUrl,
    sessionCookie: env.ENTERPRISE_STAGING_SESSION_COOKIE,
    fetchImpl,
    timeoutMs
  });

  const [organizations, relationships, reporting] = await Promise.all([
    getJson("/v1/organizations"),
    getJson("/v1/managed-creator-relationships"),
    getJson(`/v1/managed-creator-relationships/${encodeURIComponent(relationshipId)}/reporting`)
  ]);

  const failures = [];
  if (!Array.isArray(organizations?.items)) failures.push("organization_projection_invalid");
  if (!Array.isArray(relationships?.items)) failures.push("relationship_projection_invalid");
  if (!reporting || typeof reporting !== "object" || Array.isArray(reporting)) {
    failures.push("reporting_projection_invalid");
  }
  if (!Array.isArray(reporting?.totals)) failures.push("reporting_totals_invalid");

  const organization = organizations?.items?.find(
    (item) => item.organization?.organizationId === organizationId
  );
  const relationship = relationships?.items?.find((item) => item.id === relationshipId);

  if (!organization) failures.push("organization_projection_missing");
  if (organization?.organization?.state !== "active") failures.push("organization_not_active");
  if (organization?.governance?.kybState !== "verified") failures.push("normalized_kyb_not_verified");
  if (organization?.capabilities?.rbacEnabled !== true) failures.push("enterprise_entitlement_not_active");
  if (!relationship) failures.push("relationship_projection_missing");
  if (relationship?.organizationId !== organizationId) failures.push("relationship_organization_mismatch");
  if (relationship?.state !== "active") failures.push("relationship_not_active");
  if (relationship?.agreementState !== "accepted") failures.push("creator_terms_not_accepted");
  if (relationship?.organizationKybReady !== true) failures.push("relationship_kyb_not_ready");
  if (relationship?.enterpriseEntitlementReady !== true) failures.push("relationship_entitlement_not_ready");
  if (relationship?.settlementWalletReady !== true) failures.push("settlement_wallet_not_ready");
  if (reporting?.relationshipId !== relationshipId) failures.push("reporting_projection_missing");
  if (
    reporting?.financeBoundary !==
    "confirmed_allocations_only_no_balance_no_withdrawal_no_payout_queue"
  ) {
    failures.push("reporting_finance_boundary_invalid");
  }

  if (failures.length > 0) {
    throw new EnterpriseProofError(
      "ENTERPRISE_PROJECTION_SMOKE_FAILED",
      `checks=${[...new Set(failures)].join(",")}`
    );
  }

  return {
    state: "APPLICATION_PROJECTION_SMOKE",
    organization: { active: true, normalizedKybVerified: true, enterpriseEntitlement: true },
    managedCreator: { active: true, agreementAccepted: true, settlementWalletReady: true },
    reporting: { currencyBuckets: reporting.totals.length },
    providerEvidence: "REQUIRES_RELEASE_BOUND_ENTERPRISE_EVIDENCE"
  };
}

function createJsonFetcher({ apiUrl, sessionCookie, fetchImpl, timeoutMs }) {
  return async function getJson(path) {
    let response;
    try {
      response = await fetchImpl(new URL(path, apiUrl), {
        headers: {
          accept: "application/json",
          cookie: sessionCookie
        },
        signal: AbortSignal.timeout(timeoutMs)
      });
    } catch {
      throw new EnterpriseProofError("ENTERPRISE_PROJECTION_SMOKE_FAILED", `request_failed=${path}`);
    }

    if (!response.ok) {
      throw new EnterpriseProofError(
        "ENTERPRISE_PROJECTION_SMOKE_FAILED",
        `http_status=${response.status},path=${path}`
      );
    }

    try {
      return await response.json();
    } catch {
      throw new EnterpriseProofError(
        "ENTERPRISE_PROJECTION_SMOKE_FAILED",
        `invalid_json=${path}`
      );
    }
  };
}

export class EnterpriseProofError extends Error {
  constructor(code, detail, exitCode = 1) {
    super(`${code} ${detail}`);
    this.name = "EnterpriseProofError";
    this.code = code;
    this.detail = detail;
    this.exitCode = exitCode;
  }
}

async function main() {
  try {
    const result = await runEnterpriseProjectionProof();
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    if (error instanceof EnterpriseProofError) {
      console.error(`${error.code} ${error.detail}`);
      process.exitCode = error.exitCode;
      return;
    }
    console.error("ENTERPRISE_PROJECTION_SMOKE_FAILED unexpected_error");
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
