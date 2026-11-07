import { describe, expect, it } from "vitest";
import {
  OrganizationStateConflictError,
  assertOwnerMembershipTransition
} from "../src/modules/organization/organization-repository.js";

describe("organization membership lifecycle", () => {
  it("requires the invitee to activate an invited membership", () => {
    expect(() => assertOwnerMembershipTransition("invited", "active")).toThrow(
      OrganizationStateConflictError
    );
  });

  it("still permits owner suspension/removal controls outside invitee acceptance", () => {
    expect(() => assertOwnerMembershipTransition("invited", "removed")).not.toThrow();
    expect(() => assertOwnerMembershipTransition("active", "suspended")).not.toThrow();
  });
});
