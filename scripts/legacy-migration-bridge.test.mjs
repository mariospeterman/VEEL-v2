import { describe, expect, it } from "vitest";
import { bridgeTargets } from "./legacy-migration-bridge.mjs";

describe("legacy populated-upgrade bridge classification", () => {
  it("identifies every audited obsolete constraint", () => {
    expect(bridgeTargets([
      { table_name: "reports", definition: "CHECK (state = ANY (ARRAY['dismissed']))" },
      {
        table_name: "ticket_purchase_requests",
        definition: "CHECK (state = ANY (ARRAY['pending_payment', 'ticket_granted']))"
      },
      {
        table_name: "viewer_feed_preferences",
        definition: "CHECK (nsfw_preference = ANY (ARRAY['recommended', 'nsfw', 'sfw']))"
      }
    ])).toEqual([
      "0046_reports_state",
      "0056_event_access_purchase_request_state",
      "0077_viewer_feed_nsfw_preference"
    ]);
  });

  it("recognizes the Event Access constraint before and after the 0049 table rename", () => {
    const definition = "CHECK (state = ANY (ARRAY['pending_payment', 'ticket_granted']))";
    expect(bridgeTargets([
      { table_name: "ticket_purchase_requests", definition },
      { table_name: "event_access_purchase_requests", definition }
    ])).toEqual(["0056_event_access_purchase_request_state"]);
  });

  it("does not alter current final constraints", () => {
    expect(bridgeTargets([
      { table_name: "reports", definition: "CHECK (state IN ('rejected'))" },
      {
        table_name: "event_access_purchase_requests",
        definition: "CHECK (state IN ('access_pass_granted'))"
      },
      {
        table_name: "viewer_feed_preferences",
        definition: "CHECK (nsfw_preference IN ('both', 'nsfw', 'sfw'))"
      }
    ])).toEqual([]);
  });
});
