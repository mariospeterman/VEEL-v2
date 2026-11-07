export function bridgeTargets(rows) {
  const targets = [];
  for (const row of rows) {
    const definition = String(row.definition ?? "");
    if (row.table_name === "reports" && !definition.includes("rejected")) {
      targets.push("0046_reports_state");
    }
    if (
      ["ticket_purchase_requests", "event_access_purchase_requests"].includes(row.table_name) &&
      !definition.includes("access_pass_granted")
    ) {
      targets.push("0056_event_access_purchase_request_state");
    }
    if (
      row.table_name === "viewer_feed_preferences" &&
      !definition.includes("both")
    ) {
      targets.push("0077_viewer_feed_nsfw_preference");
    }
  }
  return [...new Set(targets)].sort();
}
