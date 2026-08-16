"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent, type ReactNode } from "react";
import {
  createVerificationSession,
  inviteManagedCreator,
  inviteOrganizationMember,
  proposeManagedCreatorAgreement,
  respondToManagedCreatorAgreement,
  respondToManagedCreatorRelationship,
  respondToOrganizationMembership,
  terminateManagedCreatorRelationship,
  updateOrganizationMember
} from "@/api-mutations";
import type {
  ManagedCreatorRelationship,
  ManagedCreatorReporting,
  OrganizationMember,
  Wallet
} from "@/api-client";
import type { OrganizationDashboardPage } from "@/api-client";
import { formatAssetAmount } from "@/format-asset-amount";
import { Card, EmptyState, StatusPill } from "../../ui";

type Dashboard = OrganizationDashboardPage["items"][number];

export function EnterpriseManagementPanel({
  dashboards,
  members,
  relationships,
  reporting,
  wallets
}: {
  dashboards: Dashboard[];
  members: Record<string, OrganizationMember[]>;
  relationships: ManagedCreatorRelationship[];
  reporting: Record<string, ManagedCreatorReporting | null>;
  wallets: Wallet[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function run(key: string, action: () => Promise<unknown>, success: string) {
    setBusy(key);
    setMessage(null);
    try {
      await action();
      setMessage(success);
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Enterprise action failed");
    } finally {
      setBusy(null);
    }
  }

  if (dashboards.length === 0 && relationships.length === 0) return null;

  return (
    <section aria-labelledby="enterprise-management" className="grid gap-4">
      <div>
        <p className="text-xs font-medium uppercase tracking-[0.16em] text-(--accent)">Enterprise workspace</p>
        <h2 className="mt-1 text-xl font-semibold tracking-normal" id="enterprise-management">Teams and managed creators</h2>
        <p className="mt-1 max-w-3xl text-sm leading-6 text-(--muted)">
          Invitations, permissions and management shares require explicit acceptance. Confirmed allocation
          reporting is historical evidence only—WeVid never holds a balance or runs a payout queue.
        </p>
      </div>

      {message ? <p aria-live="polite" className="rounded border border-(--line) bg-(--surface) p-3 text-sm">{message}</p> : null}

      {dashboards.map((dashboard) => (
        <OrganizationWorkspace
          busy={busy}
          dashboard={dashboard}
          key={dashboard.organization.organizationId}
          members={members[dashboard.organization.organizationId] ?? []}
          onRun={run}
          wallets={wallets}
        />
      ))}

      <section className="grid gap-3">
        <h3 className="text-base font-semibold tracking-normal">Managed creator agreements</h3>
        {relationships.length === 0 ? (
          <EmptyState title="No managed creators">
            An organization owner or admin can invite a creator after Enterprise entitlement is active.
          </EmptyState>
        ) : relationships.map((relationship) => (
          <RelationshipCard
            busy={busy}
            key={relationship.id}
            onRun={run}
            relationship={relationship}
            reporting={reporting[relationship.id] ?? null}
          />
        ))}
      </section>
    </section>
  );
}

function OrganizationWorkspace({
  busy,
  dashboard,
  members,
  onRun,
  wallets
}: {
  busy: string | null;
  dashboard: Dashboard;
  members: OrganizationMember[];
  onRun: (key: string, action: () => Promise<unknown>, success: string) => Promise<void>;
  wallets: Wallet[];
}) {
  const organizationId = dashboard.organization.organizationId;
  const canManageMembers = dashboard.rolePermissions.some((permission) => permission.key === "manage_members" && permission.allowed);
  const isOwner = dashboard.organization.role === "owner" && dashboard.organization.membershipState === "active";
  const canManageCreators = (dashboard.organization.role === "owner" || dashboard.organization.role === "admin") &&
    dashboard.organization.membershipState === "active" && dashboard.capabilities.rbacEnabled;

  if (dashboard.organization.membershipState === "invited") {
    return (
      <Card className="p-4">
        <h3 className="font-semibold tracking-normal">{dashboard.organization.name}</h3>
        <p className="mt-2 text-sm text-(--muted)">You were invited as {dashboard.organization.role}. Accepting adds this team capability to your existing WeVid account.</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <ActionButton busy={busy} id={`member-accept-${dashboard.organization.id}`} onClick={() => onRun(
            `member-accept-${dashboard.organization.id}`,
            () => respondToOrganizationMembership(dashboard.organization.id, { decision: "accept" }),
            "Team invitation accepted."
          )}>Accept invitation</ActionButton>
          <ActionButton busy={busy} id={`member-decline-${dashboard.organization.id}`} onClick={() => onRun(
            `member-decline-${dashboard.organization.id}`,
            () => respondToOrganizationMembership(dashboard.organization.id, { decision: "decline" }),
            "Team invitation declined."
          )}>Decline</ActionButton>
        </div>
      </Card>
    );
  }

  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="font-semibold tracking-normal">{dashboard.organization.name}</h3>
          <p className="mt-1 text-sm text-(--muted)">{dashboard.organization.role} · KYB {dashboard.governance.kybState ?? "not started"}</p>
        </div>
        <StatusPill tone={dashboard.capabilities.rbacEnabled ? "good" : "warn"}>
          {dashboard.capabilities.rbacEnabled ? "Enterprise active" : "Enterprise approval required"}
        </StatusPill>
      </div>

      {dashboard.governance.kybState !== "verified" && (dashboard.organization.role === "owner" || dashboard.organization.role === "admin") ? (
        <button
          className="mt-3 rounded border border-(--line) px-3 py-2 text-sm font-medium disabled:opacity-50"
          disabled={busy !== null}
          onClick={() => onRun(`kyb-${organizationId}`, async () => {
            const session = await createVerificationSession({
              purpose: "org_kyb",
              providerPreference: "provider_first",
              source: "organization",
              organizationId,
              adultPublisherTermsAccepted: false
            });
            window.location.assign(session.launchUrl);
          }, "Business verification started.")}
          type="button"
        >Start business verification</button>
      ) : null}

      <div className="mt-5 grid gap-4 lg:grid-cols-2">
        <section className="grid content-start gap-3">
          <h4 className="text-sm font-semibold tracking-normal">Team roles</h4>
          {members.map((member) => (
            <div className="rounded border border-(--line) bg-(--background) p-3 text-sm" key={member.id}>
              <div className="flex items-center justify-between gap-3">
                <span className="font-medium">@{member.handle}</span>
                <StatusPill>{member.role} · {member.state}</StatusPill>
              </div>
              {isOwner && member.role !== "owner" ? (
                <MemberUpdateForm busy={busy} member={member} onRun={onRun} />
              ) : null}
            </div>
          ))}
          {canManageMembers ? <TeamInviteForm busy={busy} onRun={onRun} organizationId={organizationId} /> : null}
        </section>

        <section className="grid content-start gap-3">
          <h4 className="text-sm font-semibold tracking-normal">Invite a managed creator</h4>
          {canManageCreators ? (
            <ManagedCreatorInviteForm busy={busy} onRun={onRun} organizationId={organizationId} wallets={wallets} />
          ) : (
            <p className="text-sm leading-6 text-(--muted)">Creator invitations unlock only after the Enterprise entitlement is active. KYB remains a separate allocation gate.</p>
          )}
        </section>
      </div>
    </Card>
  );
}

function TeamInviteForm({ busy, onRun, organizationId }: {
  busy: string | null;
  onRun: (key: string, action: () => Promise<unknown>, success: string) => Promise<void>;
  organizationId: string;
}) {
  return <form className="grid gap-2 rounded border border-(--line) p-3" onSubmit={(event) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const handle = String(data.get("handle") ?? "");
    const role = String(data.get("role") ?? "member") as "admin" | "member" | "viewer";
    void onRun(`team-invite-${organizationId}`, () => inviteOrganizationMember(organizationId, { handle, role }), "Team invitation sent.");
  }}>
    <label className="grid gap-1 text-sm"><span>WeVid handle</span><input className="rounded border border-(--line) bg-(--background) px-3 py-2" name="handle" placeholder="creator_handle" required /></label>
    <label className="grid gap-1 text-sm"><span>Role</span><select className="rounded border border-(--line) bg-(--background) px-3 py-2" defaultValue="member" name="role"><option value="admin">Admin</option><option value="member">Member</option><option value="viewer">Viewer</option></select></label>
    <button className="rounded bg-(--foreground) px-3 py-2 text-sm font-medium text-(--background) disabled:opacity-50" disabled={busy !== null}>Invite team member</button>
  </form>;
}

function MemberUpdateForm({ busy, member, onRun }: {
  busy: string | null;
  member: OrganizationMember;
  onRun: (key: string, action: () => Promise<unknown>, success: string) => Promise<void>;
}) {
  return <form className="mt-3 flex flex-wrap gap-2" onSubmit={(event) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const role = String(data.get("role")) as "admin" | "member" | "viewer";
    const state = String(data.get("state")) as "active" | "suspended" | "removed";
    void onRun(`member-update-${member.id}`, () => updateOrganizationMember(member.organizationId, member.id, { role, state }), "Team role updated.");
  }}>
    <select className="rounded border border-(--line) bg-(--background) px-2 py-1" defaultValue={member.role} name="role"><option value="admin">Admin</option><option value="member">Member</option><option value="viewer">Viewer</option></select>
    <select className="rounded border border-(--line) bg-(--background) px-2 py-1" defaultValue={member.state === "invited" ? "active" : member.state} name="state"><option value="active">Active</option><option value="suspended">Suspended</option><option value="removed">Removed</option></select>
    <button className="rounded border border-(--line) px-2 py-1 font-medium disabled:opacity-50" disabled={busy !== null}>Update</button>
  </form>;
}

function ManagedCreatorInviteForm({ busy, onRun, organizationId, wallets }: {
  busy: string | null;
  onRun: (key: string, action: () => Promise<unknown>, success: string) => Promise<void>;
  organizationId: string;
  wallets: Wallet[];
}) {
  return <form className="grid gap-2 rounded border border-(--line) p-3" onSubmit={(event) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const permissions = data.getAll("permissions").map(String) as Array<"profile_readiness_view" | "monetisation_settings_manage" | "content_manage" | "analytics_view" | "revenue_allocation">;
    void onRun(`creator-invite-${organizationId}`, () => inviteManagedCreator(organizationId, {
      creatorHandle: String(data.get("creatorHandle") ?? ""),
      enterpriseManagementShareBps: Math.round(Number(data.get("sharePercent") ?? 0) * 100),
      permissions,
      settlementWalletId: String(data.get("settlementWalletId") ?? "") || null
    }), "Creator management invitation sent.");
  }}>
    <label className="grid gap-1 text-sm"><span>Creator handle</span><input className="rounded border border-(--line) bg-(--background) px-3 py-2" name="creatorHandle" required /></label>
    <label className="grid gap-1 text-sm"><span>Management share (%)</span><input className="rounded border border-(--line) bg-(--background) px-3 py-2" max="99.99" min="0" name="sharePercent" required step="0.01" type="number" /></label>
    <label className="grid gap-1 text-sm"><span>Organization settlement wallet</span><select className="rounded border border-(--line) bg-(--background) px-3 py-2" name="settlementWalletId"><option value="">Configure later</option>{wallets.map((wallet) => <option key={wallet.id} value={wallet.id}>{wallet.chain} · {wallet.address.slice(0, 6)}…{wallet.address.slice(-4)}</option>)}</select></label>
    <fieldset className="grid gap-1 text-sm"><legend className="mb-1">Creator-approved permissions</legend>{permissionOptions.map(([value, label]) => <label className="flex items-center gap-2" key={value}><input defaultChecked={value === "analytics_view" || value === "revenue_allocation"} name="permissions" type="checkbox" value={value} />{label}</label>)}</fieldset>
    <button className="rounded bg-(--foreground) px-3 py-2 text-sm font-medium text-(--background) disabled:opacity-50" disabled={busy !== null}>Invite creator</button>
  </form>;
}

function RelationshipCard({ busy, onRun, relationship, reporting }: {
  busy: string | null;
  onRun: (key: string, action: () => Promise<unknown>, success: string) => Promise<void>;
  relationship: ManagedCreatorRelationship;
  reporting: ManagedCreatorReporting | null;
}) {
  const actions = new Set(relationship.availableActions);
  return <Card className="p-4">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="font-semibold">@{relationship.creatorHandle}</p><p className="mt-1 text-sm text-(--muted)">{relationship.organizationName} · agreement v{relationship.agreementVersion}</p></div><StatusPill>{relationship.state} · {relationship.agreementState}</StatusPill></div>
    <div className="mt-3 grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-4"><Readiness label="Creator share" value={`${relationship.creatorShareBps / 100}%`} /><Readiness label="Management share" value={`${relationship.enterpriseManagementShareBps / 100}%`} /><Readiness label="KYB" value={relationship.organizationKybReady ? "ready" : "required"} /><Readiness label="Enterprise wallet" value={relationship.settlementWalletReady ? "ready" : "required"} /></div>
    <p className="mt-3 text-xs text-(--muted)">Permissions: {relationship.permissions.map((permission) => permission.replaceAll("_", " ")).join(", ")}</p>
    <div className="mt-3 flex flex-wrap gap-2">
      {actions.has("accept_relationship") ? <ActionButton busy={busy} id={`relationship-accept-${relationship.id}`} onClick={() => onRun(`relationship-accept-${relationship.id}`, () => respondToManagedCreatorRelationship(relationship.id, "accept"), "Management relationship accepted.")}>Accept relationship</ActionButton> : null}
      {actions.has("decline_relationship") ? <ActionButton busy={busy} id={`relationship-decline-${relationship.id}`} onClick={() => onRun(`relationship-decline-${relationship.id}`, () => respondToManagedCreatorRelationship(relationship.id, "decline"), "Management relationship declined.")}>Decline</ActionButton> : null}
      {actions.has("accept_agreement") ? <ActionButton busy={busy} id={`agreement-accept-${relationship.id}`} onClick={() => onRun(`agreement-accept-${relationship.id}`, () => respondToManagedCreatorAgreement(relationship.id, relationship.agreementId, { decision: "accept" }), "New management terms accepted.")}>Accept new terms</ActionButton> : null}
      {actions.has("reject_agreement") ? <ActionButton busy={busy} id={`agreement-reject-${relationship.id}`} onClick={() => onRun(`agreement-reject-${relationship.id}`, () => respondToManagedCreatorAgreement(relationship.id, relationship.agreementId, { decision: "reject" }), "New management terms rejected.")}>Reject terms</ActionButton> : null}
    </div>
    {actions.has("propose_agreement") ? <AgreementForm busy={busy} onRun={onRun} relationship={relationship} /> : null}
    {actions.has("terminate_relationship") ? <TerminationForm busy={busy} onRun={onRun} relationship={relationship} /> : null}
    {reporting ? <div className="mt-4 border-t border-(--line) pt-3"><p className="text-sm font-semibold">Confirmed allocation reporting</p>{reporting.totals.length === 0 ? <p className="mt-1 text-sm text-(--muted)">No confirmed managed allocations yet.</p> : reporting.totals.map((total) => <p className="mt-1 text-sm text-(--muted)" key={total.currency}>{total.confirmedPaymentCount} payments · creator {formatAssetAmount(total.creatorNetMinor, total.currency)} · management {formatAssetAmount(total.enterpriseManagementMinor, total.currency)}</p>)}</div> : null}
  </Card>;
}

function AgreementForm({ busy, onRun, relationship }: { busy: string | null; onRun: (key: string, action: () => Promise<unknown>, success: string) => Promise<void>; relationship: ManagedCreatorRelationship }) {
  return <form className="mt-4 grid gap-2 rounded border border-(--line) p-3" onSubmit={(event: FormEvent<HTMLFormElement>) => { event.preventDefault(); const data = new FormData(event.currentTarget); const permissions = data.getAll("permissions").map(String) as ManagedCreatorRelationship["permissions"]; void onRun(`agreement-propose-${relationship.id}`, () => proposeManagedCreatorAgreement(relationship.id, { permissions, enterpriseManagementShareBps: Math.round(Number(data.get("sharePercent")) * 100) }), "New terms sent for creator acceptance."); }}><p className="text-sm font-semibold">Propose changed terms</p><input className="rounded border border-(--line) bg-(--background) px-3 py-2 text-sm" defaultValue={relationship.enterpriseManagementShareBps / 100} max="99.99" min="0" name="sharePercent" step="0.01" type="number" />{permissionOptions.map(([value, label]) => <label className="flex items-center gap-2 text-sm" key={value}><input defaultChecked={relationship.permissions.includes(value)} name="permissions" type="checkbox" value={value} />{label}</label>)}<button className="rounded border border-(--line) px-3 py-2 text-sm font-medium disabled:opacity-50" disabled={busy !== null}>Send changed terms</button></form>;
}

function TerminationForm({ busy, onRun, relationship }: { busy: string | null; onRun: (key: string, action: () => Promise<unknown>, success: string) => Promise<void>; relationship: ManagedCreatorRelationship }) {
  return <form className="mt-3 flex flex-col gap-2 sm:flex-row" onSubmit={(event) => { event.preventDefault(); const reason = String(new FormData(event.currentTarget).get("reason") ?? ""); void onRun(`terminate-${relationship.id}`, () => terminateManagedCreatorRelationship(relationship.id, { reason }), "Management relationship ended. Historical allocations were preserved."); }}><input className="min-w-0 flex-1 rounded border border-(--line) bg-(--background) px-3 py-2 text-sm" maxLength={240} name="reason" placeholder="Reason for ending management" required /><button className="rounded border border-(--line) px-3 py-2 text-sm font-medium disabled:opacity-50" disabled={busy !== null}>End relationship</button></form>;
}

function ActionButton({ busy, children, id, onClick }: { busy: string | null; children: ReactNode; id: string; onClick: () => void }) { return <button className="rounded border border-(--line) px-3 py-2 text-sm font-medium disabled:opacity-50" disabled={busy !== null} onClick={onClick} type="button">{busy === id ? "Working…" : children}</button>; }
function Readiness({ label, value }: { label: string; value: string }) { return <div className="rounded border border-(--line) bg-(--background) p-2"><span className="block text-xs text-(--muted)">{label}</span><span className="font-medium">{value}</span></div>; }

const permissionOptions = [
  ["profile_readiness_view", "Profile readiness"],
  ["monetisation_settings_manage", "Monetisation settings"],
  ["content_manage", "Content management"],
  ["analytics_view", "Analytics and allocation reporting"],
  ["revenue_allocation", "Creator-approved management allocation"]
] as const;
