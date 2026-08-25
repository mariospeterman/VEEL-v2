import { describe, expect, it } from "vitest";
import {
  processScheduledPublications,
  type LeasedScheduledPublication,
  type ScheduledPublicationRepository
} from "../src/scheduled-publication";

const publications: LeasedScheduledPublication[] = [
  { contentItemId: "00000000-0000-4000-8000-000000000101", creatorUserId: "00000000-0000-4000-8000-000000000201", leaseToken: "lease-a", attemptCount: 1 },
  { contentItemId: "00000000-0000-4000-8000-000000000102", creatorUserId: "00000000-0000-4000-8000-000000000202", leaseToken: "lease-b", attemptCount: 2 },
  { contentItemId: "00000000-0000-4000-8000-000000000103", creatorUserId: "00000000-0000-4000-8000-000000000203", leaseToken: "lease-c", attemptCount: 8 }
];

describe("scheduled publication worker", () => {
  it("counts completed, retrying, and dead-letter outcomes without bypassing the repository recheck", async () => {
    const outcomes = new Map([
      [publications[0]!.contentItemId, "completed" as const],
      [publications[1]!.contentItemId, "retry" as const],
      [publications[2]!.contentItemId, "dead_letter" as const]
    ]);
    const repository: ScheduledPublicationRepository = {
      async leaseDue() { return publications; },
      async publishLeased({ publication }) { return outcomes.get(publication.contentItemId)!; }
    };

    await expect(processScheduledPublications({ repository, now: new Date("2026-08-25T12:00:00.000Z") })).resolves.toEqual({
      leased: 3,
      completed: 1,
      retrying: 1,
      deadLettered: 1
    });
  });
});
