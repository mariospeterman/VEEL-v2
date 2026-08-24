import type { ReactNode } from "react";
import { getAdminCurrentStaff, getAdminStaffDirectory } from "@/api-client";
import { inviteStaffAction, updateStaffMembershipAction } from "../actions";

const roles = [
  "owner", "admin", "trust_safety", "finance", "ops", "support", "creator_success",
  "event_ops", "ai_ops", "compliance", "readonly_auditor"
] as const;
const fieldClass = "min-h-11 min-w-0 rounded-xl border border-(--line) bg-(--background) px-3 text-sm outline-none focus:border-(--accent)";

export default async function AdminStaffPage() {
  const [access, directory] = await Promise.all([getAdminCurrentStaff(), getAdminStaffDirectory()]);
  if (!access.ok || !directory.ok) {
    return <div className="rounded-2xl border border-(--line) bg-(--panel) p-6 text-sm text-(--muted)">{!access.ok ? access.message : directory.ok ? "Staff unavailable" : directory.message}</div>;
  }
  const permissions = new Set(access.data.permissions);
  const canChangeRole = permissions.has("admin.staff.change_role");
  const canRevoke = permissions.has("admin.staff.revoke");

  return (
    <div className="grid gap-6">
      <header>
        <p className="text-sm font-semibold text-(--accent-text)">Access governance</p>
        <h1 className="mt-1 text-3xl font-semibold tracking-[-0.03em]">Staff</h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-(--muted)">Invite existing WeVid users, assign bounded roles, and revoke access with audited owner protection.</p>
      </header>

      {permissions.has("admin.staff.invite") ? (
        <section className="rounded-2xl border border-(--line) bg-(--panel) p-5">
          <h2 className="font-semibold">Invite coworker</h2>
          <form action={inviteStaffAction} className="mt-4 grid gap-3 lg:grid-cols-[minmax(220px,1fr)_220px_120px_minmax(220px,1fr)_auto]">
            <Field label="Existing WeVid user ID"><input className={fieldClass} name="targetUserId" placeholder="UUID" required /></Field>
            <Field label="Role"><select className={fieldClass} defaultValue="support" name="role">{roles.map((role) => <option key={role}>{role}</option>)}</select></Field>
            <Field label="Expires"><select className={fieldClass} defaultValue="72" name="expiresInHours"><option value="24">24 hours</option><option value="72">3 days</option><option value="168">7 days</option></select></Field>
            <Field label="Reason"><input className={fieldClass} minLength={3} name="reason" placeholder="Why access is required" required /></Field>
            <button className="min-h-11 self-end rounded-xl bg-(--accent) px-4 text-sm font-semibold text-white" type="submit">Confirm invite</button>
          </form>
        </section>
      ) : null}

      <section className="overflow-hidden rounded-2xl border border-(--line) bg-(--panel)">
        <div className="border-b border-(--line) px-5 py-4"><h2 className="font-semibold">Active directory</h2></div>
        <div className="divide-y divide-(--line)">
          {directory.data.memberships.map((member) => (
            <article className="grid gap-4 px-5 py-4 xl:grid-cols-[minmax(220px,1fr)_160px_120px_minmax(380px,1.4fr)] xl:items-center" key={member.membershipId}>
              <div className="min-w-0"><p className="truncate font-medium">{member.displayName}</p><p className="truncate text-xs text-(--muted)">@{member.handle} · {member.userId}</p></div>
              <p className="text-sm">{member.role.replaceAll("_", " ")}</p>
              <p className="text-sm capitalize text-(--muted)">{member.state}</p>
              {(canChangeRole || canRevoke) ? (
                <form action={updateStaffMembershipAction} className="grid gap-2 sm:grid-cols-[140px_150px_minmax(160px,1fr)_auto]">
                  <input name="membershipId" type="hidden" value={member.membershipId} />
                  <select className={fieldClass} defaultValue={canChangeRole ? "change_role" : "suspend"} name="action">{canChangeRole ? <option value="change_role">Change role</option> : null}{canRevoke ? <><option value="suspend">Suspend</option><option value="revoke">Revoke</option></> : null}</select>
                  <select className={fieldClass} defaultValue={member.role} name="role">{roles.map((role) => <option key={role}>{role}</option>)}</select>
                  <input className={fieldClass} minLength={3} name="reason" placeholder="Required reason" required />
                  <button className="min-h-11 rounded-xl border border-(--line) px-3 text-sm font-semibold" type="submit">Confirm</button>
                </form>
              ) : null}
            </article>
          ))}
          {!directory.data.memberships.length ? <p className="p-5 text-sm text-(--muted)">No staff memberships.</p> : null}
        </div>
      </section>

      <section className="overflow-hidden rounded-2xl border border-(--line) bg-(--panel)">
        <div className="border-b border-(--line) px-5 py-4"><h2 className="font-semibold">Invitations</h2></div>
        <div className="divide-y divide-(--line)">
          {directory.data.invitations.map((invitation) => (
            <div className="grid gap-2 px-5 py-4 text-sm sm:grid-cols-[minmax(0,1fr)_180px_120px_220px]" key={invitation.id}>
              <span className="font-medium">@{invitation.targetHandle}</span><span>{invitation.role.replaceAll("_", " ")}</span><span className="capitalize text-(--muted)">{invitation.state}</span><span className="text-(--muted)">Expires {new Date(invitation.expiresAt).toLocaleString()}</span>
            </div>
          ))}
          {!directory.data.invitations.length ? <p className="p-5 text-sm text-(--muted)">No staff invitations.</p> : null}
        </div>
      </section>
    </div>
  );
}

function Field({ children, label }: { children: ReactNode; label: string }) {
  return <label className="grid gap-1.5"><span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-(--muted)">{label}</span>{children}</label>;
}
