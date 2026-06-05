import { describe, expect, it } from "vitest";
import { buildWorkerRuntime } from "../src/index";

describe("buildWorkerRuntime", () => {
  it("registers recurring subscription queues", () => {
    const runtime = buildWorkerRuntime();

    expect(runtime).toMatchObject({
      name: "veel-worker",
      queues: ["subscription-authorizations", "subscription-collections"],
      schedules: [
        {
          name: "subscription-collections",
          cadence: "every_minute",
          sourceIndex: "subscriptions_next_collection_idx"
        }
      ]
    });
  });
});
