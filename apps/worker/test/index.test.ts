import { describe, expect, it } from "vitest";
import { buildWorkerRuntime } from "../src/index";

describe("buildWorkerRuntime", () => {
  it("creates the worker skeleton without provider queues", () => {
    const runtime = buildWorkerRuntime();

    expect(runtime).toMatchObject({
      name: "veel-worker",
      queues: []
    });
  });
});
