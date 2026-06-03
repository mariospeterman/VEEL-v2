import { describe, expect, it } from "vitest";
import { buildApi } from "../src/app";

describe("buildApi", () => {
  it("boots the Fastify skeleton and loads the OpenAPI document", async () => {
    const app = await buildApi();
    await app.ready();

    expect(app.supabaseBoundary.hasServiceRoleKey).toBe(false);
    expect(app.swagger()).toMatchObject({
      openapi: "3.1.0",
      info: {
        title: "Veel V2 API"
      }
    });

    await app.close();
  });
});
