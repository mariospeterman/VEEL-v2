import { describe, expect, it } from "vitest";
import { appendUniquePageItems, prependUniquePageItems } from "./merge-page-items";

const items = (...ids: string[]) => ids.map((id) => ({ id }));

describe("cursor page merging", () => {
  it("appends older descending pages without duplicate boundary rows", () => {
    expect(appendUniquePageItems(items("new", "middle"), items("middle", "old"))).toEqual(
      items("new", "middle", "old")
    );
  });

  it("prepends earlier chronological message pages without duplicate boundary rows", () => {
    expect(prependUniquePageItems(items("middle", "new"), items("old", "middle"))).toEqual(
      items("old", "middle", "new")
    );
  });
});
