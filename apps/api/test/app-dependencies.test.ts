import type { FastifyInstance } from "fastify";
import { describe, expect, it, vi } from "vitest";
import { createApiDependencies } from "../src/app-dependencies";
import { registerApiCloseHooks } from "../src/app-lifecycle";
import type { PostgresSql } from "../src/shared/postgres";

describe("API dependency construction", () => {
  it("reuses one app-level Postgres client and closes it once from lifecycle hooks", async () => {
    const postgresClient = createFakePostgresClient();
    const app = createDependencyTestApp();
    const dependencies = createApiDependencies(app, { postgresClient });

    expect(dependencies.postgresClient).toBe(postgresClient);

    await dependencies.sessionRepository.close?.();
    await dependencies.paymentRepository.close?.();
    await dependencies.adminRepository.close?.();
    expect(postgresClient.end).not.toHaveBeenCalled();

    const closeHooks: Array<() => Promise<void>> = [];
    registerApiCloseHooks(
      {
        addHook(hookName: string, hook: () => Promise<void>) {
          if (hookName === "onClose") {
            closeHooks.push(hook);
          }
          return this;
        }
      } as FastifyInstance,
      dependencies
    );

    for (const hook of closeHooks) {
      await hook();
    }

    expect(postgresClient.end).toHaveBeenCalledTimes(1);
    expect(postgresClient.end).toHaveBeenCalledWith({ timeout: 5 });
  });
});

function createFakePostgresClient(): PostgresSql & { end: ReturnType<typeof vi.fn> } {
  const sql = vi.fn() as unknown as PostgresSql & { end: ReturnType<typeof vi.fn> };
  sql.end = vi.fn(async () => undefined);
  return sql;
}

function createDependencyTestApp(): FastifyInstance {
  return {
    config: {
      DATABASE_URL: "postgres://veel:test@127.0.0.1:5432/veel",
      SOLANA_RPC_URL: "https://api.devnet.solana.com",
      WEB_PUSH_VAPID_PUBLIC_KEY: "test-vapid-public-key",
      NOTIFICATION_DEVICE_ENCRYPTION_KEY: undefined
    }
  } as FastifyInstance;
}
