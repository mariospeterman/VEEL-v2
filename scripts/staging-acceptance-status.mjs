export function deriveJourneyResults({ journeys, capabilityStatus }) {
  return journeys.map((journey) => {
    const disabledOptional = (
      journey.id === "subscriptions.platform_studio_membership"
      && capabilityStatus.get("subscriptions") === "DISABLED"
    ) || (
      journey.id === "mcp.optional_bridge"
      && capabilityStatus.get("mcp") === "DISABLED"
    );
    const status = disabledOptional ? "DEFERRED" : journey.status;
    return {
      id: journey.id,
      status,
      blockerClass: status === "PASS"
        ? null
        : disabledOptional
          ? "optional_capability_disabled"
          : journey.blockerClass,
      cleanup: "not_run"
    };
  });
}
