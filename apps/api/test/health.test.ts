import { describe, expect, it } from "vitest";
import { buildApi } from "../src/app.js";
import type { PostgresSql } from "../src/shared/postgres.js";

describe("API health probes", () => {
  it("returns sanitized liveness state without database configuration", async () => {
    const app = await buildApi();

    try {
      const response = await app.inject({ method: "GET", url: "/healthz" });
      const body = response.json();

      expect(response.statusCode).toBe(200);
      expect(body).toMatchObject({
        service: "veel-api",
        status: "ok",
        checks: {
          api: { status: "ok" }
        }
      });
      expect(JSON.stringify(body)).not.toContain("DATABASE_URL");
    } finally {
      await app.close();
    }
  });

  it("fails readiness when the database is not configured", async () => {
    const app = await buildApi();

    try {
      const response = await app.inject({ method: "GET", url: "/readyz" });
      const body = response.json();

      expect(response.statusCode).toBe(503);
      expect(body).toMatchObject({
        service: "veel-api",
        status: "degraded",
        checks: {
          api: { status: "ok" },
          postgres: { status: "not_configured" }
        }
      });
    } finally {
      await app.close();
    }
  });

  it("returns ready when the database probe succeeds", async () => {
    const postgresClient = (async () => [{ ready: 1 }]) as unknown as PostgresSql;
    const app = await buildApi({ postgresClient });

    try {
      const response = await app.inject({ method: "GET", url: "/readyz" });
      const body = response.json();

      expect(response.statusCode).toBe(200);
      expect(body).toMatchObject({
        status: "ok",
        checks: {
          postgres: { status: "ok" }
        }
      });
    } finally {
      await app.close();
    }
  });

  it("fails readiness when the database probe fails", async () => {
    const postgresClient = (async () => {
      throw new Error("connection refused");
    }) as unknown as PostgresSql;
    const app = await buildApi({ postgresClient });

    try {
      const response = await app.inject({ method: "GET", url: "/readyz" });
      const body = response.json();

      expect(response.statusCode).toBe(503);
      expect(body).toMatchObject({
        status: "unavailable",
        checks: {
          postgres: { status: "unavailable" }
        }
      });
      expect(JSON.stringify(body)).not.toContain("connection refused");
    } finally {
      await app.close();
    }
  });
});
