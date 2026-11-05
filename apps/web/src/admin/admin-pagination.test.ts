import { describe, expect, it } from "vitest";
import {
  adminApiPagePath,
  adminSearchParam,
  adminSectionPageHref,
  isUuid,
  preservedAdminSearchEntries
} from "./admin-pagination";

describe("admin pagination", () => {
  it("encodes opaque API cursors without changing their bytes", () => {
    expect(adminApiPagePath("/v1/admin/users", "scope:a+b/c=="))
      .toBe("/v1/admin/users?cursor=scope%3Aa%2Bb%2Fc%3D%3D");
    expect(adminApiPagePath("/v1/admin/users")).toBe("/v1/admin/users");
  });

  it("advances one resource cursor while preserving independent section state", () => {
    const href = adminSectionPageHref({
      section: "compliance",
      searchParams: {
        ledgerCursor: "old-ledger",
        receiptsCursor: "receipt-page-2",
        organizationId: "00000000-0000-4000-8000-000000000123"
      },
      cursorKey: "ledgerCursor",
      cursor: "ledger-page-3"
    });

    const parsed = new URL(href, "https://wevid.example");
    expect(parsed.pathname).toBe("/admin/compliance");
    expect(Object.fromEntries(parsed.searchParams)).toEqual({
      ledgerCursor: "ledger-page-3",
      organizationId: "00000000-0000-4000-8000-000000000123",
      receiptsCursor: "receipt-page-2"
    });
  });

  it("uses one bounded scalar value and omits replaced selection state", () => {
    const tooLong = "x".repeat(4_097);
    const query = {
      organizationId: ["first", "second"],
      organizationMembersCursor: "members-page-2",
      ignored: tooLong
    };

    expect(adminSearchParam(query, "organizationId")).toBe("first");
    expect(adminSearchParam(query, "ignored")).toBeUndefined();
    expect(preservedAdminSearchEntries(query, ["organizationId", "organizationMembersCursor"]))
      .toEqual([]);
  });

  it("accepts canonical UUIDs only for organization selection", () => {
    expect(isUuid("00000000-0000-4000-8000-000000000123")).toBe(true);
    expect(isUuid("../provider-events")).toBe(false);
    expect(isUuid("00000000-0000-0000-0000-000000000123")).toBe(false);
  });
});
