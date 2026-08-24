export const adminPermissions = [
  "admin.overview.read",
  "admin.users.read",
  "admin.users.restrict",
  "admin.content.read",
  "admin.content.moderate",
  "admin.reports.read",
  "admin.reports.decide",
  "admin.live.read",
  "admin.live.suspend",
  "admin.live.resume",
  "admin.events.read",
  "admin.events.write",
  "admin.payments.read",
  "admin.payment_policy.write",
  "admin.subscriptions.read",
  "admin.subscriptions.recover",
  "admin.refunds.read",
  "admin.refunds.decide",
  "admin.providers.read",
  "admin.provider_events.replay",
  "admin.queues.read",
  "admin.queues.retry",
  "admin.analytics.read",
  "admin.analytics.recompute",
  "admin.organizations.read",
  "admin.organizations.write",
  "admin.staff.read",
  "admin.staff.invite",
  "admin.staff.change_role",
  "admin.staff.revoke",
  "admin.compliance.read",
  "admin.compliance.export",
  "admin.privacy.read",
  "admin.privacy.process",
  "admin.support.read",
  "admin.support.write",
  "admin.ai.read",
  "admin.feature_flags.read",
  "admin.feature_flags.write",
  "admin.audit.read"
] as const;

export type AdminPermission = typeof adminPermissions[number];

export const staffRoles = [
  "owner",
  "admin",
  "trust_safety",
  "finance",
  "ops",
  "support",
  "creator_success",
  "event_ops",
  "ai_ops",
  "compliance",
  "readonly_auditor"
] as const;

export type StaffRole = typeof staffRoles[number];

const readOnlyPermissions = adminPermissions.filter((permission) => permission.endsWith(".read"));
const allPermissions = [...adminPermissions];

export const rolePermissions: Record<StaffRole, readonly AdminPermission[]> = {
  owner: allPermissions,
  admin: allPermissions.filter((permission) =>
    !["admin.staff.invite", "admin.staff.change_role", "admin.staff.revoke"].includes(permission)
  ),
  trust_safety: [
    "admin.overview.read", "admin.users.read", "admin.users.restrict", "admin.content.read",
    "admin.content.moderate", "admin.reports.read", "admin.reports.decide", "admin.live.read",
    "admin.live.suspend", "admin.live.resume", "admin.events.read", "admin.privacy.read", "admin.audit.read"
  ],
  finance: [
    "admin.overview.read", "admin.users.read", "admin.payments.read", "admin.payment_policy.write",
    "admin.subscriptions.read", "admin.subscriptions.recover", "admin.refunds.read", "admin.refunds.decide",
    "admin.compliance.read", "admin.compliance.export", "admin.analytics.read", "admin.audit.read"
  ],
  ops: [
    "admin.overview.read", "admin.live.read", "admin.providers.read", "admin.provider_events.replay",
    "admin.queues.read", "admin.queues.retry", "admin.analytics.read", "admin.analytics.recompute",
    "admin.feature_flags.read", "admin.audit.read"
  ],
  support: [
    "admin.overview.read", "admin.users.read", "admin.content.read", "admin.reports.read", "admin.events.read",
    "admin.payments.read", "admin.subscriptions.read", "admin.refunds.read", "admin.organizations.read",
    "admin.privacy.read", "admin.support.read"
  ],
  creator_success: [
    "admin.overview.read", "admin.users.read", "admin.content.read", "admin.reports.read",
    "admin.analytics.read", "admin.organizations.read", "admin.support.read"
  ],
  event_ops: [
    "admin.overview.read", "admin.users.read", "admin.events.read", "admin.events.write", "admin.live.read",
    "admin.payments.read", "admin.refunds.read", "admin.support.read"
  ],
  ai_ops: ["admin.overview.read", "admin.ai.read", "admin.audit.read"],
  compliance: [
    "admin.overview.read", "admin.users.read", "admin.payments.read", "admin.subscriptions.read",
    "admin.refunds.read", "admin.compliance.read", "admin.compliance.export", "admin.privacy.read",
    "admin.privacy.process", "admin.audit.read"
  ],
  readonly_auditor: readOnlyPermissions.filter((permission) =>
    !["admin.privacy.read", "admin.ai.read"].includes(permission)
  )
};

const permissionSet = new Set<string>(adminPermissions);
const roleSet = new Set<string>(staffRoles);

export function isAdminPermission(value: string): value is AdminPermission {
  return permissionSet.has(value);
}

export function isStaffRole(value: string): value is StaffRole {
  return roleSet.has(value);
}

export function permissionsForRoles(roles: readonly StaffRole[], explicit: readonly string[] = []): AdminPermission[] {
  const permissions = new Set<AdminPermission>();
  for (const role of roles) for (const permission of rolePermissions[role]) permissions.add(permission);
  for (const permission of explicit) if (isAdminPermission(permission)) permissions.add(permission);
  return [...permissions].sort();
}
