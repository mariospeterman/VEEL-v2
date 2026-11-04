import { describe, expect, it, vi } from "vitest";
import type { PostgresSql } from "../src/shared/postgres.js";
import { decodeTimestampKindIdCursor } from "../src/shared/keyset-pagination.js";
import { createPostgresReferralRepository } from "../src/modules/referral/referral-repository.js";

const cursorScope = "GET /v1/referrals/activity";
const kinds = ["share", "commission"] as const;

describe("referral activity compound pagination", () => {
  it("walks 21 tied share/commission rows without gaps when a newer row arrives", async () => {
    const tiedAt = new Date("2026-11-04T12:00:00.000Z");
    const originalRows = Array.from({ length: 21 }, (_, index) => referralRow(index + 1, tiedAt));
    const allRows = [...originalRows].sort(compareRows);
    const sql = vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => {
      const query = strings.join("?");
      expect(query).toContain("order by activity.created_at desc, activity.activity_type desc, activity.id desc");
      const timestamp = values[1] as string | null;
      const kind = values[4] as (typeof kinds)[number] | null;
      const id = values[7] as string | null;
      const limit = values[9] as number;
      return Promise.resolve(
        allRows.filter((row) => afterCursor(row, { timestamp, kind, id })).slice(0, limit)
      );
    }) as unknown as PostgresSql;
    const repository = createPostgresReferralRepository(sql);
    const seen: string[] = [];
    let cursor: string | undefined;
    let firstCursor: string | null = null;

    do {
      const page = await repository.listActivity({
        supabaseUserId: "00000000-0000-4000-8000-000000000099",
        limit: 5,
        ...(cursor ? { cursor } : {})
      });
      seen.push(...page.items.map((item) => item.id));
      if (!firstCursor) {
        firstCursor = page.nextCursor;
        allRows.push(referralRow(100, new Date("2026-11-04T12:00:01.000Z")));
        allRows.sort(compareRows);
      }
      cursor = page.nextCursor ?? undefined;
    } while (cursor);

    const expected = originalRows.sort(compareRows).map((row) => row.id);
    expect(seen).toEqual(expected);
    expect(new Set(seen)).toHaveLength(21);
    expect(seen.filter((id) => id !== uuidFor(100))).toHaveLength(21);
    expect(decodeTimestampKindIdCursor(cursorScope, firstCursor ?? undefined, kinds).id)
      .toBe(expected[4]);
  });
});

function referralRow(index: number, createdAt: Date) {
  return {
    id: uuidFor(index),
    activity_type: index % 3 === 0 ? "share" as const : "commission" as const,
    token: `token-${Math.ceil(index / 3)}`,
    target_type: "profile",
    target_id: uuidFor(500 + Math.ceil(index / 3)),
    eligibility: "external_share",
    state: index % 3 === 0 ? "active" : "confirmed",
    created_at: createdAt,
    commission_amount_minor: index % 3 === 0 ? null : index,
    currency: index % 3 === 0 ? null : "USDC" as const
  };
}

function compareRows(
  left: ReturnType<typeof referralRow>,
  right: ReturnType<typeof referralRow>
): number {
  return right.created_at.getTime() - left.created_at.getTime() ||
    right.activity_type.localeCompare(left.activity_type) ||
    right.id.localeCompare(left.id);
}

function afterCursor(
  row: ReturnType<typeof referralRow>,
  cursor: { timestamp: string | null; kind: string | null; id: string | null }
): boolean {
  if (!cursor.timestamp) return true;
  const timestamp = row.created_at.toISOString();
  if (!cursor.kind || !cursor.id) return timestamp <= cursor.timestamp;
  return timestamp < cursor.timestamp || (
    timestamp === cursor.timestamp && (
      row.activity_type < cursor.kind ||
      (row.activity_type === cursor.kind && row.id < cursor.id)
    )
  );
}

function uuidFor(value: number): string {
  return `00000000-0000-4000-8000-${value.toString(16).padStart(12, "0")}`;
}
