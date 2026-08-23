import { describe, expect, it } from "vitest";
import {
  processLiveSafety,
  type LiveSafetyProviderAction,
  type LiveSafetyRepository
} from "../src/live-safety";

function repositoryWith(actions: LiveSafetyProviderAction[]) {
  const completed: string[] = [];
  const retried: Array<{ id: string; deadLetter: boolean }> = [];
  const repository: LiveSafetyRepository = {
    async holdDueSessions() { return 2; },
    async claimProviderActions() { return actions; },
    async completeProviderAction(input) { completed.push(input.id); },
    async retryProviderAction(input) { retried.push({ id: input.id, deadLetter: input.deadLetter }); }
  };
  return { repository, completed, retried };
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
      provider: { async suspend(input) { suspended.push(input.providerStreamId); } },
      now: new Date("2026-08-23T12:00:00.000Z")
    });

    expect(suspended).toEqual(["stream-1"]);
    expect(state.completed).toEqual(["action-1"]);
    expect(result).toEqual({ held: 2, claimed: 1, completed: 1, retried: 0, deadLettered: 0 });
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
      provider: { async suspend() { throw new Error("provider unavailable"); } },
      now: new Date("2026-08-23T12:00:00.000Z")
    });

    expect(state.retried).toEqual([{ id: "action-2", deadLetter: true }]);
    expect(result.deadLettered).toBe(1);
  });
});
