const required = [
  "API_URL",
  "ENTERPRISE_STAGING_SESSION_COOKIE",
  "ENTERPRISE_STAGING_ORGANIZATION_ID",
  "ENTERPRISE_STAGING_RELATIONSHIP_ID",
  "ENTERPRISE_STAGING_KYB_EVIDENCE_ID",
  "ENTERPRISE_STAGING_CONTRACT_EVIDENCE_ID"
];

const missing = required.filter((key) => !process.env[key]?.trim());
if (missing.length > 0) {
  console.error(`CODE_COMPLETE_PROVIDER_BLOCKED missing=${missing.join(",")}`);
  process.exit(2);
}

const apiUrl = new URL(process.env.API_URL);
if (apiUrl.protocol !== "https:" && !["localhost", "127.0.0.1"].includes(apiUrl.hostname)) {
  console.error("ENTERPRISE_PROOF_FAILED API_URL must use HTTPS outside localhost");
  process.exit(1);
}

const organizationId = process.env.ENTERPRISE_STAGING_ORGANIZATION_ID;
const relationshipId = process.env.ENTERPRISE_STAGING_RELATIONSHIP_ID;

const [organizations, relationships, reporting] = await Promise.all([
  getJson("/v1/organizations"),
  getJson("/v1/managed-creator-relationships"),
  getJson(`/v1/managed-creator-relationships/${encodeURIComponent(relationshipId)}/reporting`)
]);

const organization = organizations.items?.find((item) => item.organization?.organizationId === organizationId);
const relationship = relationships.items?.find((item) => item.id === relationshipId);
const failures = [];

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
if (reporting.relationshipId !== relationshipId) failures.push("reporting_projection_missing");
if (reporting.financeBoundary !== "confirmed_allocations_only_no_balance_no_withdrawal_no_payout_queue") {
  failures.push("reporting_finance_boundary_invalid");
}

if (failures.length > 0) {
  console.error(`ENTERPRISE_PROOF_FAILED checks=${failures.join(",")}`);
  process.exit(1);
}

console.log(JSON.stringify({
  state: "PROVIDER_PROVEN",
  organization: { active: true, kybVerified: true, enterpriseEntitlement: true },
  managedCreator: { active: true, agreementAccepted: true, settlementWalletReady: true },
  reporting: { currencyBuckets: Array.isArray(reporting.totals) ? reporting.totals.length : 0 },
  evidence: { kyb: "configured_redacted", enterpriseContract: "configured_redacted" }
}, null, 2));

async function getJson(path) {
  const response = await fetch(new URL(path, apiUrl), {
    headers: {
      accept: "application/json",
      cookie: process.env.ENTERPRISE_STAGING_SESSION_COOKIE
    }
  });
  if (!response.ok) {
    throw new Error(`ENTERPRISE_PROOF_HTTP_${response.status}_${path}`);
  }
  return response.json();
}
