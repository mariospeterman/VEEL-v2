export const baseEvidenceReceiptKeys = [
  "BACKUP_RESTORE_PROOF_ID",
  "STAGING_IDENTITY_WALLET_PROOF_ID",
  "STAGING_VERIFICATION_PROOF_ID",
  "STAGING_PAYMENT_PROOF_ID",
  "STAGING_LIVEPEER_PROOF_ID",
  "STAGING_REALTIME_PUSH_PROOF_ID",
  "STAGING_MODERATION_PROOF_ID",
  "STAGING_STORAGE_BACKUP_PROOF_ID",
  "STAGING_OBSERVABILITY_PROOF_ID",
  "STAGING_DEVICE_QA_PROOF_ID",
  "STAGING_ENTERPRISE_PROOF_ID"
];

export function expectedEvidenceReceiptKeys(env = process.env) {
  return [
    ...baseEvidenceReceiptKeys,
    ...(env.SUBSCRIPTIONS_ENABLED === "true" ? ["STAGING_SUBSCRIPTIONS_PROOF_ID"] : [])
  ];
}

export function parseEvidenceBundle(value) {
  if (!value?.trim()) throw new Error("staging_evidence_bundle_missing");
  try {
    return JSON.parse(value);
  } catch {
    throw new Error("staging_evidence_bundle_invalid_json");
  }
}

export function assertReleaseEvidenceBundle(bundle, expectedManifestDigest, requiredReceiptKeys) {
  if (!bundle || bundle.schemaVersion !== 1 || typeof bundle.receipts !== "object" || bundle.receipts === null || Array.isArray(bundle.receipts)) {
    throw new Error("staging_evidence_bundle_invalid_shape");
  }
  if (!/^sha256:[a-f0-9]{64}$/.test(expectedManifestDigest ?? "")) {
    throw new Error("expected_manifest_digest_invalid");
  }
  if (bundle.manifestDigest !== expectedManifestDigest) {
    throw new Error("evidence_manifest_digest_mismatch");
  }

  for (const key of requiredReceiptKeys) {
    assertOpaqueEvidenceId(bundle.receipts[key], key);
  }
}

export function assertOpaqueEvidenceId(value, key) {
  if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:/-]{5,200}$/.test(value)) {
    throw new Error(`${key.toLowerCase()}_must_be_an_opaque_redacted_reference`);
  }
}
