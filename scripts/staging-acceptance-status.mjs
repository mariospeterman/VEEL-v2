import { assertOpaqueEvidenceId } from "./release-evidence.mjs";

const recordedJourneyStatuses = new Set(["PASS", "FAIL", "BLOCKED", "NOT_RUN"]);
const successfulProofStatuses = new Set(["passed", "evidence_registered"]);

export function deriveJourneyResults({
  journeys,
  capabilityStatus,
  proofOutcomes = [],
  evidenceBundle = null,
  releaseManifest = null
}) {
  const proofs = new Map(proofOutcomes.map((outcome) => [outcome.name, outcome]));

  return journeys.map((journey) => {
    const optionalCapability = journey.optionalCapability ?? null;
    if (optionalCapability && capabilityStatus.get(optionalCapability) === "DISABLED") {
      return journeyResult(journey.id, "DEFERRED", {
        blockerClass: "optional_capability_disabled",
        reason: `${optionalCapability}_disabled`
      });
    }

    const unavailableCapabilities = (journey.requiredCapabilities ?? []).filter(
      (capability) => capabilityStatus.get(capability) !== "READY"
    );
    if (unavailableCapabilities.length > 0) {
      return journeyResult(journey.id, "BLOCKED", {
        blockerClass: journey.blockerClass ?? "required_capability_not_ready",
        reason: "required_capability_not_ready",
        blockedBy: unavailableCapabilities
      });
    }

    const recorded = inspectRecordedOutcome({ journey, evidenceBundle, releaseManifest });
    if (recorded.kind === "invalid") {
      return journeyResult(journey.id, "FAIL", {
        blockerClass: "invalid_current_release_evidence",
        reason: recorded.reason
      });
    }
    if (recorded.kind === "recorded" && recorded.status !== "PASS") {
      return journeyResult(journey.id, recorded.status, {
        blockerClass: recorded.blockerClass ?? journey.blockerClass ?? null,
        reason: recorded.reason,
        evidenceId: recorded.evidenceId,
        executedAt: recorded.executedAt
      });
    }

    const requiredProofs = ["release-manifest", "synthetic", ...(journey.requiredProofs ?? [])];
    const proofGate = inspectProofs(requiredProofs, proofs);
    if (proofGate) {
      return journeyResult(journey.id, proofGate.status, {
        blockerClass: proofGate.blockerClass,
        reason: proofGate.reason,
        blockedBy: proofGate.blockedBy
      });
    }

    if (recorded.kind === "missing") {
      return journeyResult(journey.id, "NOT_RUN", {
        blockerClass: "journey_evidence_not_registered",
        reason: recorded.reason
      });
    }

    return journeyResult(journey.id, "PASS", {
      blockerClass: null,
      reason: null,
      evidenceId: recorded.evidenceId,
      executedAt: recorded.executedAt
    });
  });
}

export function deriveAcceptanceOverall({ configuration, commands, proofs, journeys }) {
  if (configuration.some((entry) => entry.status === "INVALID")) return "UNSAFE_TARGET";

  if (
    commands.some((outcome) => outcome.status === "FAIL")
    || proofs.some((outcome) => outcome.status === "failed")
    || journeys.some((journey) => journey.status === "FAIL")
  ) return "FAIL";

  if (
    configuration.some((entry) => entry.status === "BLOCKED")
    || commands.some((outcome) => outcome.status === "BLOCKED")
    || proofs.some((outcome) => outcome.status === "blocked")
    || journeys.some((journey) => journey.status === "BLOCKED")
  ) return "BLOCKED_CONFIGURATION";

  if (
    commands.some((outcome) => outcome.status === "NOT_RUN")
    || proofs.some((outcome) => outcome.status === "not_run")
    || journeys.length === 0
    || journeys.some((journey) => journey.status === "NOT_RUN")
  ) return "INCOMPLETE";

  return journeys.every((journey) => journey.status === "PASS" || journey.status === "DEFERRED")
    ? "PASS"
    : "INCOMPLETE";
}

function inspectRecordedOutcome({ journey, evidenceBundle, releaseManifest }) {
  if (!evidenceBundle) return { kind: "missing", reason: "evidence_bundle_not_registered" };
  if (!releaseManifest) return { kind: "missing", reason: "release_manifest_not_verified" };
  if (!isRecord(evidenceBundle.journeyOutcomes)) {
    return evidenceBundle.journeyOutcomes === undefined
      ? { kind: "missing", reason: "journey_outcomes_not_registered" }
      : { kind: "invalid", reason: "journey_outcomes_invalid_shape" };
  }

  const outcome = evidenceBundle.journeyOutcomes[journey.id];
  if (outcome === undefined) return { kind: "missing", reason: "journey_outcome_not_registered" };
  if (!isRecord(outcome)) return { kind: "invalid", reason: "journey_outcome_invalid_shape" };
  if (!recordedJourneyStatuses.has(outcome.status)) {
    return { kind: "invalid", reason: "journey_outcome_status_invalid" };
  }
  if (
    evidenceBundle.manifestDigest !== releaseManifest.manifestDigest
    || outcome.manifestDigest !== releaseManifest.manifestDigest
  ) {
    return { kind: "invalid", reason: "journey_evidence_manifest_digest_mismatch" };
  }
  if (outcome.releaseSha !== releaseManifest.sourceSha) {
    return { kind: "invalid", reason: "journey_evidence_release_sha_mismatch" };
  }
  if (!isIsoTimestamp(outcome.executedAt)) {
    return { kind: "invalid", reason: "journey_evidence_executed_at_invalid" };
  }

  let evidenceId;
  if (outcome.status === "PASS" || outcome.evidenceId !== undefined) {
    try {
      assertOpaqueEvidenceId(outcome.evidenceId, `${journey.id}_evidence_id`);
      evidenceId = outcome.evidenceId;
    } catch {
      return { kind: "invalid", reason: "journey_evidence_id_invalid" };
    }
  }

  return {
    kind: "recorded",
    status: outcome.status,
    blockerClass: safeToken(outcome.blockerClass),
    reason: safeToken(outcome.reason) ?? `journey_${outcome.status.toLowerCase()}`,
    evidenceId,
    executedAt: outcome.executedAt
  };
}

function inspectProofs(requiredProofs, proofs) {
  const missing = [];
  const blocked = [];

  for (const proofName of requiredProofs) {
    const outcome = proofs.get(proofName);
    if (!outcome || outcome.status === "not_run") {
      missing.push(proofName);
      continue;
    }
    if (outcome.status === "failed") {
      return {
        status: "FAIL",
        blockerClass: "required_proof_failed",
        reason: `required_proof_failed:${proofName}`,
        blockedBy: [proofName]
      };
    }
    if (outcome.status === "blocked" || outcome.status === "skipped") {
      blocked.push(proofName);
      continue;
    }
    if (!successfulProofStatuses.has(outcome.status)) {
      return {
        status: "FAIL",
        blockerClass: "required_proof_status_invalid",
        reason: `required_proof_status_invalid:${proofName}`,
        blockedBy: [proofName]
      };
    }
  }

  if (blocked.length > 0) {
    return {
      status: "BLOCKED",
      blockerClass: "required_proof_blocked",
      reason: "required_proof_blocked",
      blockedBy: blocked
    };
  }
  if (missing.length > 0) {
    return {
      status: "NOT_RUN",
      blockerClass: "required_proof_not_run",
      reason: "required_proof_not_run",
      blockedBy: missing
    };
  }
  return null;
}

function journeyResult(id, status, details) {
  return {
    id,
    status,
    blockerClass: details.blockerClass ?? null,
    reason: details.reason ?? null,
    evidenceId: details.evidenceId ?? null,
    executedAt: details.executedAt ?? null,
    blockedBy: details.blockedBy ?? [],
    cleanup: "NOT_RECORDED"
  };
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isIsoTimestamp(value) {
  return typeof value === "string"
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)
    && Number.isFinite(Date.parse(value));
}

function safeToken(value) {
  return typeof value === "string" && /^[a-z0-9][a-z0-9_.:-]{0,159}$/i.test(value) ? value : null;
}
