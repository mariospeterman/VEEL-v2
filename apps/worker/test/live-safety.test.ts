import { describe, expect, it, vi } from "vitest";
import type postgres from "postgres";
import {
  liveSafetyHealthConcurrency,
  liveSafetyHoldEligibleStates,
  processLiveSafety,
  releaseHealthyLiveSafetyCase,
  type LiveSafetyHealthCheck,
  type LiveSafetyProviderAction,
  type LiveSafetyRepository
} from "../src/live-safety";

function repositoryWith(
  actions: LiveSafetyProviderAction[],
  healthChecks: LiveSafetyHealthCheck[] = []
) {
  const completed: string[] = [];
  const retried: Array<{ id: string; deadLetter: boolean }> = [];
  const healthResults: Array<{ id: string; healthy: boolean }> = [];
  const holdInputs: Array<{ excludeSessionIds?: string[] }> = [];
  let actionClaimCount = 0;
  const repository: LiveSafetyRepository = {
    async claimHealthChecks() { return healthChecks; },
    async completeHealthCheck(input) { healthResults.push({ id: input.id, healthy: input.healthy }); },
    async holdDueSessions(input) {
      holdInputs.push({ excludeSessionIds: input.excludeSessionIds });
      return 2;
    },
    async claimProviderActions() {
      actionClaimCount += 1;
      return actionClaimCount === 1 ? actions : [];
    },
    async completeProviderAction(input) { completed.push(input.id); },
    async retryProviderAction(input) { retried.push({ id: input.id, deadLetter: input.deadLetter }); }
  };
  return { repository, completed, retried, healthResults, holdInputs };
}

describe("live safety watchdog", () => {
  it("releases the canonical safety case only through the backend predicate", async () => {
    const queries: string[] = [];
    const transaction = (async (strings: TemplateStringsArray) => {
      queries.push(strings.join("?"));
      return [];
    }) as unknown as postgres.TransactionSql;

    await releaseHealthyLiveSafetyCase(transaction, {
      roomId: "room-1",
      observedAt: new Date("2026-08-23T12:00:00.000Z")
    });

    expect(queries[0]).toContain("update media_safety_cases safety");
    expect(queries[0]).toContain("provider_release_allowed = true");
    expect(queries[0]).toContain("private.live_safety_release_ready");
  });

  it("does not hold target-connected sessions deferred beyond the polling batch limit", () => {
    expect(liveSafetyHoldEligibleStates).not.toContain("target_connected");
    expect(liveSafetyHoldEligibleStates).toEqual(["monitoring_pending", "monitoring"]);
  });

  it("holds stale viewer access before suspending the provider", async () => {
    const action = {
      id: "action-1",
      roomId: "room-1",
      providerStreamId: "stream-1",
      leaseToken: "lease-1",
      attemptCount: 1
    };
    const state = repositoryWith([action]);
    const suspended: string[] = [];
    const result = await processLiveSafety({
      repository: state.repository,
      provider: {
        async checkHealth() { return { healthy: true }; },
        async suspend(input) { suspended.push(input.providerStreamId); }
      },
      now: new Date("2026-08-23T12:00:00.000Z")
    });

    expect(suspended).toEqual(["stream-1"]);
    expect(state.completed).toEqual(["action-1"]);
    expect(result).toEqual({
      healthChecked: 0,
      healthConfirmed: 0,
      healthFailed: 0,
      held: 2,
      claimed: 1,
      completed: 1,
      retried: 0,
      deadLettered: 0
    });
  });

  it("processes an already-queued suspension before starting provider health polling", async () => {
    const events: string[] = [];
    const state = repositoryWith([{
      id: "action-urgent",
      roomId: "room-urgent",
      providerStreamId: "stream-urgent",
      leaseToken: "lease-urgent",
      attemptCount: 1
    }], [{
      id: "session-health",
      roomId: "room-health",
      providerStreamId: "stream-health",
      leaseToken: "health-lease"
    }]);

    await processLiveSafety({
      repository: state.repository,
      provider: {
        async suspend() { events.push("suspend"); },
        async checkHealth() {
          events.push("health");
          return { healthy: true };
        }
      },
      now: new Date("2026-08-23T12:00:00.000Z")
    });

    expect(events).toEqual(["suspend", "health"]);
  });

  it("keeps local denial durable while provider suspension retries", async () => {
    const state = repositoryWith([{
      id: "action-2",
      roomId: "room-2",
      providerStreamId: "stream-2",
      leaseToken: "lease-2",
      attemptCount: 10
    }]);
    const result = await processLiveSafety({
      repository: state.repository,
      provider: {
        async checkHealth() { return { healthy: true }; },
        async suspend() { throw new Error("provider unavailable"); }
      },
      now: new Date("2026-08-23T12:00:00.000Z")
    });

    expect(state.retried).toEqual([{ id: "action-2", deadLetter: true }]);
    expect(result.deadLettered).toBe(1);
  });

  it("refreshes monitoring only from a recurring healthy provider observation", async () => {
    const state = repositoryWith([], [{
      id: "session-1",
      roomId: "room-1",
      providerStreamId: "stream-1",
      leaseToken: "health-lease-1"
    }]);
    const observed: string[] = [];
    const result = await processLiveSafety({
      repository: state.repository,
      provider: {
        async checkHealth(input) {
          observed.push(input.providerStreamId);
          return { healthy: true };
        },
        async suspend() {}
      },
      now: new Date("2026-08-23T12:00:00.000Z")
    });

    expect(observed).toEqual(["stream-1"]);
    expect(state.healthResults).toEqual([{ id: "session-1", healthy: true }]);
    expect(result.healthConfirmed).toBe(1);
    expect(result.healthFailed).toBe(0);
  });

  it("fails closed when recurring provider health cannot be verified", async () => {
    const state = repositoryWith([], [{
      id: "session-2",
      roomId: "room-2",
      providerStreamId: "stream-2",
      leaseToken: "health-lease-2"
    }]);
    const result = await processLiveSafety({
      repository: state.repository,
      provider: {
        async checkHealth() { throw new Error("provider unavailable"); },
        async suspend() {}
      },
      now: new Date("2026-08-23T12:00:00.000Z")
    });

    expect(state.healthResults).toEqual([{ id: "session-2", healthy: false }]);
    expect(result.healthFailed).toBe(1);
  });

  it("timestamps each sequential provider health request when it starts", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-23T12:00:00.000Z"));
    try {
      const state = repositoryWith([], [
        {
          id: "session-1",
          roomId: "room-1",
          providerStreamId: "stream-1",
          leaseToken: "health-lease-1"
        },
        {
          id: "session-2",
          roomId: "room-2",
          providerStreamId: "stream-2",
          leaseToken: "health-lease-2"
        }
      ]);
      const observedAt: string[] = [];
      await processLiveSafety({
        repository: state.repository,
        provider: {
          async checkHealth(input) {
            observedAt.push(input.observedAt.toISOString());
            if (input.providerStreamId === "stream-1") vi.advanceTimersByTime(31_000);
            return { healthy: true };
          },
          async suspend() {}
        }
      });

      expect(observedAt).toEqual([
        "2026-08-23T12:00:00.000Z",
        "2026-08-23T12:00:31.000Z"
      ]);
      expect(state.holdInputs).toEqual([{
        excludeSessionIds: ["session-1", "session-2"]
      }]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not let a long batch invalidate health confirmed in the same tick", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-23T12:00:00.000Z"));
    try {
      const state = repositoryWith([], [
        {
          id: "healthy-session",
          roomId: "room-1",
          providerStreamId: "healthy-stream",
          leaseToken: "health-lease-1"
        },
        {
          id: "failed-session",
          roomId: "room-2",
          providerStreamId: "failed-stream",
          leaseToken: "health-lease-2"
        }
      ]);
      await processLiveSafety({
        repository: state.repository,
        provider: {
          async checkHealth(input) {
            if (input.providerStreamId === "healthy-stream") return { healthy: true };
            vi.advanceTimersByTime(100_000);
            return { healthy: false };
          },
          async suspend() {}
        }
      });

      expect(state.holdInputs).toEqual([{
        excludeSessionIds: ["healthy-session"]
      }]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("bounds concurrent health polling so a claimed batch stays inside its lease budget", async () => {
    const healthChecks = Array.from({ length: 25 }, (_, index) => ({
      id: `session-${index}`,
      roomId: `room-${index}`,
      providerStreamId: `stream-${index}`,
      leaseToken: "health-lease"
    }));
    const state = repositoryWith([], healthChecks);
    let active = 0;
    let maxActive = 0;

    await processLiveSafety({
      repository: state.repository,
      provider: {
        async checkHealth() {
          active += 1;
          maxActive = Math.max(maxActive, active);
          await new Promise<void>((resolve) => setTimeout(resolve, 0));
          active -= 1;
          return { healthy: true };
        },
        async suspend() {}
      }
    });

    expect(maxActive).toBe(liveSafetyHealthConcurrency);
    expect(state.healthResults).toHaveLength(25);
  });
});
