import { describe, expect, it } from "vitest";
import type postgres from "postgres";
import { createProfileCreatorRepositoryMethods } from "../src/modules/profile/profile-creator-repository.js";

describe("profile creator repository", () => {
  it("passes the canonical viewer user id directly to content eligibility", async () => {
    const viewerUserId = "11111111-1111-4111-8111-111111111111";
    const calls: Array<{ text: string; values: unknown[] }> = [];
    const sql = ((strings: TemplateStringsArray, ...values: unknown[]) => {
      calls.push({ text: strings.join("?"), values });
      return Promise.resolve([]);
    }) as unknown as postgres.Sql;
    const repository = createProfileCreatorRepositoryMethods(sql);

    await expect(
      repository.findCreatorProfileByHandle("creator", viewerUserId)
    ).resolves.toBeNull();

    expect(calls).toHaveLength(1);
    expect(calls[0]?.text).toContain("private.eligible_content(?, null)");
    expect(calls[0]?.text).not.toContain("supabase_user_id");
    expect(calls[0]?.text).toContain("sp.state = 'active'");
    expect(calls[0]?.text).toContain("sp.provider_state <> 'disabled'");
    expect(calls[0]?.values).toContain(viewerUserId);
  });
});
