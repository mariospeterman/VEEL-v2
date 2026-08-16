import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";
import { registerTelemetryRoutes } from "../src/modules/telemetry/telemetry-routes.js";

describe("web vitals telemetry route", () => {
  it("accepts an allowlisted metric without retaining its unique id as an attribute", async () => {
    const app = Fastify();
    const recorder = vi.fn();
    await registerTelemetryRoutes(app, recorder);

    const response = await app.inject({
      method: "POST",
      url: "/v1/telemetry/web-vitals",
      payload: { name: "LCP", value: 1234, rating: "good", navigationType: "navigate", id: "unique-browser-id" }
    });

    expect(response.statusCode).toBe(202);
    expect(recorder).toHaveBeenCalledWith(expect.objectContaining({ name: "LCP", value: 1234 }));
    await app.close();
  });

  it("rejects additional identifying fields", async () => {
    const app = Fastify();
    await registerTelemetryRoutes(app, vi.fn());
    const response = await app.inject({
      method: "POST",
      url: "/v1/telemetry/web-vitals",
      payload: { name: "LCP", value: 1234, rating: "good", navigationType: "navigate", id: "id", url: "https://private.example" }
    });
    expect(response.statusCode).toBe(400);
    await app.close();
  });
});
