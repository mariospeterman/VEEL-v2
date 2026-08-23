import { describe, expect, it } from "vitest";
import {
  processLiveSafety,
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
  const repository: LiveSafetyRepository = {
    async claimHealthChecks() { return healthChecks; },
    async completeHealthCheck(input) { healthResults.push({ id: input.id, healthy: input.healthy }); },
    async holdDueSessions() { return 2; },
    async claimProviderActions() { return actions; },
    async completeProviderAction(input) { completed.push(input.id); },
    async retryProviderAction(input) { retried.push({ id: input.id, deadLetter: input.deadLetter }); }
  };
  return { repository, completed, retried, healthResults };
}

describe("live safety watchdog", () => {
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
});
