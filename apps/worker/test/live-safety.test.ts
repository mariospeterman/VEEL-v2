import { describe, expect, it, vi } from "vitest";
import type postgres from "postgres";
import {
  liveSafetyHoldEligibleStates,
  liveSafetyProviderConcurrency,
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
  const queuedActions = [...actions];
  const queuedHealthChecks = [...healthChecks];
  const completed: string[] = [];
  const retried: Array<{ id: string; deadLetter: boolean }> = [];
  const healthResults: Array<{ id: string; healthy: boolean }> = [];
  const healthClaimInputs: Array<{ excludeSessionIds?: string[]; limit: number }> = [];
  const holdInputs: Array<{ excludeSessionIds?: string[] }> = [];
  const actionClaimInputs: Array<{ excludeActionIds?: string[] }> = [];
  const repository: LiveSafetyRepository = {
    async claimHealthChecks(input) {
      healthClaimInputs.push({
        excludeSessionIds: input.excludeSessionIds,
        limit: input.limit
      });
      return queuedHealthChecks.splice(0, input.limit);
    },
    async completeHealthCheck(input) { healthResults.push({ id: input.id, healthy: input.healthy }); },
    async holdDueSessions(input) {
      holdInputs.push({ excludeSessionIds: input.excludeSessionIds });
      return 2;
    },
    async claimProviderActions(input) {
      actionClaimInputs.push({ excludeActionIds: input.excludeActionIds });
      return queuedActions.splice(0, input.limit);
    },
    async completeProviderAction(input) { completed.push(input.id); },
    async retryProviderAction(input) { retried.push({ id: input.id, deadLetter: input.deadLetter }); }
  };
  return {
    repository,
    completed,
    retried,
    healthResults,
    holdInputs,
    actionClaimInputs,
    healthClaimInputs
  };
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

  it("starts health leases after the initial suspension batch completes", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-23T12:00:00.000Z"));
    try {
      const claimedAt: string[] = [];
      const state = repositoryWith([{
        id: "action-slow",
        roomId: "room-slow",
        providerStreamId: "stream-slow",
        leaseToken: "lease-slow",
        attemptCount: 1
      }]);
      state.repository.claimHealthChecks = async (input) => {
        claimedAt.push(input.now.toISOString());
        return [];
      };

      await processLiveSafety({
        repository: state.repository,
        provider: {
          async suspend() { vi.advanceTimersByTime(150_000); },
          async checkHealth() { return { healthy: true }; }
        }
      });

      expect(claimedAt).toEqual(["2026-08-23T12:02:30.000Z"]);
    } finally {
      vi.useRealTimers();
    }
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
    expect(state.actionClaimInputs).toEqual([
      { excludeActionIds: [] },
      { excludeActionIds: ["action-2"] }
    ]);
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

  it("schedules healthy monitoring from provider completion rather than request start", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-23T12:00:00.000Z"));
    try {
      const completedAt: string[] = [];
      const state = repositoryWith([], [{
        id: "session-slow-health",
        roomId: "room-slow-health",
        providerStreamId: "stream-slow-health",
        leaseToken: "health-lease-slow"
      }]);
      state.repository.completeHealthCheck = async (input) => {
        completedAt.push(input.completedAt.toISOString());
      };

      await processLiveSafety({
        repository: state.repository,
        provider: {
          async checkHealth() {
            vi.advanceTimersByTime(60_000);
            return { healthy: true };
          },
          async suspend() {}
        }
      });

      expect(completedAt).toEqual(["2026-08-23T12:01:00.000Z"]);
    } finally {
      vi.useRealTimers();
    }
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

    expect(maxActive).toBe(liveSafetyProviderConcurrency);
    expect(state.healthResults).toHaveLength(25);
  });

  it("claims health checks in separately leased waves", async () => {
    const claimLimits: number[] = [];
    const healthChecks = Array.from({ length: 12 }, (_, index) => ({
      id: `session-${index}`,
      roomId: `room-${index}`,
      providerStreamId: `stream-${index}`,
      leaseToken: `health-lease-${index}`
    }));
    const state = repositoryWith([], healthChecks);
    const claimHealthChecks = state.repository.claimHealthChecks.bind(state.repository);
    state.repository.claimHealthChecks = async (input) => {
      claimLimits.push(input.limit);
      return claimHealthChecks(input);
    };

    await processLiveSafety({
      repository: state.repository,
      provider: {
        async checkHealth() { return { healthy: true }; },
        async suspend() {}
      }
    });

    expect(claimLimits).toEqual([5, 5, 5]);
    expect(state.healthClaimInputs.map((claim) => claim.excludeSessionIds?.length)).toEqual([
      0,
      5,
      10
    ]);
  });

  it("processes suspension actions in separately leased concurrent waves", async () => {
    const actions = Array.from({ length: 12 }, (_, index) => ({
      id: `action-${index}`,
      roomId: `room-${index}`,
      providerStreamId: `stream-${index}`,
      leaseToken: `action-lease-${index}`,
      attemptCount: 1
    }));
    const state = repositoryWith(actions);
    let active = 0;
    let maxActive = 0;

    await processLiveSafety({
      repository: state.repository,
      provider: {
        async checkHealth() { return { healthy: true }; },
        async suspend() {
          active += 1;
          maxActive = Math.max(maxActive, active);
          await new Promise<void>((resolve) => setTimeout(resolve, 0));
          active -= 1;
        }
      }
    });

    expect(maxActive).toBe(liveSafetyProviderConcurrency);
    expect(state.completed).toHaveLength(12);
  });
});
