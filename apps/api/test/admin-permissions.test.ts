import { describe, expect, it } from "vitest";
import {
  adminPermissions,
  permissionsForRoles,
  rolePermissions,
  staffRoles
} from "../src/modules/admin/admin-permissions";

describe("canonical staff authorization registry", () => {
  it("registers every role once and only emits registered permissions", () => {
    expect(new Set(staffRoles).size).toBe(staffRoles.length);
    expect(new Set(adminPermissions).size).toBe(adminPermissions.length);
    for (const role of staffRoles) {
      expect(rolePermissions[role].length).toBeGreaterThan(0);
      expect(rolePermissions[role].every((permission) => adminPermissions.includes(permission))).toBe(true);
    }
  });

  it("keeps specialized roles inside their intended authority", () => {
    expect(rolePermissions.finance).toContain("admin.refunds.decide");
    expect(rolePermissions.finance).not.toContain("admin.content.moderate");
    expect(rolePermissions.trust_safety).toContain("admin.content.moderate");
    expect(rolePermissions.trust_safety).not.toContain("admin.payment_policy.write");
    expect(rolePermissions.ops).toContain("admin.provider_events.replay");
    expect(rolePermissions.ops).not.toContain("admin.refunds.decide");
    expect(rolePermissions.support).not.toContain("admin.staff.invite");
    expect(rolePermissions.readonly_auditor.every((permission) => permission.endsWith(".read"))).toBe(true);
  });

  it("reserves staff governance for owners by default", () => {
    for (const permission of ["admin.staff.invite", "admin.staff.change_role", "admin.staff.revoke"] as const) {
      expect(rolePermissions.owner).toContain(permission);
      for (const role of staffRoles.filter((candidate) => candidate !== "owner")) {
        expect(rolePermissions[role]).not.toContain(permission);
      }
    }
  });

  it("merges roles and allowlisted explicit grants without accepting unknown keys", () => {
    const permissions = permissionsForRoles(["support", "ops"], [
      "admin.staff.read",
      "admin.not_registered"
    ]);
    expect(permissions).toContain("admin.support.read");
    expect(permissions).toContain("admin.queues.retry");
    expect(permissions).toContain("admin.staff.read");
    expect(permissions).not.toContain("admin.not_registered");
  });
});
