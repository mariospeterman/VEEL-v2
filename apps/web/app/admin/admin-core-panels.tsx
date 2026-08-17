import type {
  AdminContentItem,
  AdminOpsSummary,
  AdminPage,
  AdminPaymentCommercialPolicy,
  AdminReport,
  AdminUser,
  ApiResult,
  Event,
  EventAccessPass
} from "@/api-client";
import { mapApiFailure } from "@/api-errors";
import {
  EmptyState,
  Metric,
  UnavailableState
} from "./admin-ui";
import {
  ContentQueueRow,
  EventOpsRow,
  ReportQueueRow,
  AccessPassOpsRow,
  UserQueueRow
} from "./admin-rows";
import { updatePaymentCommercialPolicyAction } from "./actions";

export function ModerationPanel({
  content,
  reports,
  users
}: {
  content: ApiResult<AdminPage<AdminContentItem>>;
  reports: ApiResult<AdminPage<AdminReport>>;
  users: ApiResult<AdminPage<AdminUser>>;
}) {
  if (!users.ok) {
    return <UnavailableState result={users} />;
  }

  if (!content.ok) {
    return <UnavailableState result={content} />;
  }

  if (!reports.ok) {
    return <UnavailableState result={reports} />;
  }

  if (users.data.items.length === 0 && content.data.items.length === 0 && reports.data.items.length === 0) {
    return <EmptyState label="No users, content, or reports" />;
  }

  return (
    <div className="grid gap-2">
      {reports.data.items.map((report) => (
        <ReportQueueRow key={report.id} report={report} />
      ))}
      {content.data.items.map((item) => (
        <ContentQueueRow content={item} key={item.id} />
      ))}
      {users.data.items.map((user) => (
        <UserQueueRow key={user.id} user={user} />
      ))}
    </div>
  );
}

export function EventAccessPanel({
  events,
  accessPasses
}: {
  events: ApiResult<AdminPage<Event>>;
  accessPasses: ApiResult<AdminPage<EventAccessPass>>;
}) {
  if (!events.ok) {
    return <UnavailableState result={events} />;
  }

  if (!accessPasses.ok) {
    return <UnavailableState result={accessPasses} />;
  }

  if (events.data.items.length === 0 && accessPasses.data.items.length === 0) {
    return <EmptyState label="No events or passes" />;
  }

  return (
    <div className="grid gap-2">
      {events.data.items.map((event) => (
        <EventOpsRow event={event} key={event.id} />
      ))}
      {accessPasses.data.items.map((accessPass) => (
        <AccessPassOpsRow accessPass={accessPass} key={accessPass.id} />
      ))}
    </div>
  );
}

export function PaymentCommercialPolicyPanel({
  policies
}: {
  policies: ApiResult<AdminPage<AdminPaymentCommercialPolicy>>;
}) {
  if (!policies.ok) return <UnavailableState result={policies} />;

  return (
    <div className="grid gap-3">
      <p className="text-sm text-(--muted)">
        Overrides apply only to new quotes. Existing intents keep their stored policy revision and expiry.
      </p>
      <details className="rounded border border-(--line) bg-(--background) p-3 text-sm">
        <summary className="cursor-pointer font-medium">Create an override</summary>
        <form action={updatePaymentCommercialPolicyAction} className="mt-3 grid gap-2">
          <div className="grid gap-2 sm:grid-cols-2">
            <PolicySelect
              label="Product"
              name="productType"
              options={["support", "content_unlock", "paid_message", "live_pass", "event_access_pass"]}
            />
            <PolicySelect label="Asset" name="currency" options={["SOL", "USDC"]} />
            <PolicyNumber label="Minimum atomic amount" min={1} name="minimumAmountMinor" />
            <PolicyNumber label="Platform fee bps" max={9_999} min={0} name="platformFeeBps" />
            <PolicyNumber
              label="Referral share bps"
              max={10_000}
              min={0}
              name="referralShareOfPlatformFeeBps"
            />
            <PolicyNumber label="Quote lifetime seconds" max={1_800} min={60} name="quoteTtlSeconds" />
          </div>
          <input name="state" type="hidden" value="active" />
          <label className="grid gap-1">
            <span className="text-xs text-(--muted)">Audit reason</span>
            <input
              className="rounded border border-(--line) bg-(--panel) px-3 py-2"
              maxLength={500}
              minLength={3}
              name="reason"
              placeholder="Why this override is required"
              required
            />
          </label>
          <button className="justify-self-start rounded bg-(--foreground) px-3 py-2 font-semibold text-(--background)" type="submit">
            Create active override
          </button>
        </form>
      </details>
      {policies.data.items.map((policy) => (
        <form action={updatePaymentCommercialPolicyAction} className="grid gap-2 rounded border border-(--line) bg-(--background) p-3 text-sm" key={policy.id}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="font-medium">{policy.productType} · {policy.currency}</p>
            <p className="text-xs text-(--muted)">Revision {policy.revision}</p>
          </div>
          <input name="productType" type="hidden" value={policy.productType} />
          <input name="currency" type="hidden" value={policy.currency} />
          <div className="grid gap-2 sm:grid-cols-2">
            <PolicyNumber label="Minimum atomic amount" min={1} name="minimumAmountMinor" value={policy.minimumAmountMinor} />
            <PolicyNumber label="Platform fee bps" max={9_999} min={0} name="platformFeeBps" value={policy.platformFeeBps} />
            <PolicyNumber label="Referral share bps" max={10_000} min={0} name="referralShareOfPlatformFeeBps" value={policy.referralShareOfPlatformFeeBps} />
            <PolicyNumber label="Quote lifetime seconds" max={1_800} min={60} name="quoteTtlSeconds" value={policy.quoteTtlSeconds} />
          </div>
          <label className="grid gap-1">
            <span className="text-xs text-(--muted)">State</span>
            <select className="rounded border border-(--line) bg-(--panel) px-3 py-2" defaultValue={policy.state} name="state">
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>
          </label>
          <label className="grid gap-1">
            <span className="text-xs text-(--muted)">Audit reason</span>
            <input className="rounded border border-(--line) bg-(--panel) px-3 py-2" defaultValue={policy.reason} maxLength={500} minLength={3} name="reason" required />
          </label>
          <button className="justify-self-start rounded bg-(--foreground) px-3 py-2 font-semibold text-(--background)" type="submit">Save policy</button>
        </form>
      ))}
      {policies.data.items.length === 0 ? <EmptyState label="No commercial overrides; environment defaults are active" /> : null}
    </div>
  );
}

function PolicyNumber({
  label,
  max,
  min,
  name,
  value
}: {
  label: string;
  max?: number;
  min: number;
  name: string;
  value?: number;
}) {
  return (
    <label className="grid gap-1">
      <span className="text-xs text-(--muted)">{label}</span>
      <input
        className="rounded border border-(--line) bg-(--panel) px-3 py-2"
        defaultValue={value}
        max={max}
        min={min}
        name={name}
        required
        step={1}
        type="number"
      />
    </label>
  );
}

function PolicySelect({ label, name, options }: { label: string; name: string; options: string[] }) {
  return (
    <label className="grid gap-1">
      <span className="text-xs text-(--muted)">{label}</span>
      <select className="rounded border border-(--line) bg-(--panel) px-3 py-2" name={name}>
        {options.map((option) => <option key={option} value={option}>{option}</option>)}
      </select>
    </label>
  );
}

export function SummaryMetrics({ summary }: { summary: ApiResult<AdminOpsSummary> }) {
  if (!summary.ok) {
    const mapped = mapApiFailure(summary, "Ops summary");
    return (
      <div className="rounded border border-(--line) bg-(--panel) px-3 py-2 text-sm">
        <p className="text-xs uppercase text-(--muted)">Ops summary</p>
        <p className="mt-1 font-semibold tracking-normal">{mapped.title}</p>
        <p className="mt-1 text-xs text-(--muted)">{mapped.message}</p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
      <Metric label="Provider" value={summary.data.providerHealth} />
      <Metric label="Queue" value={summary.data.queueHealth} />
      <Metric label="Payments" value={summary.data.paymentCounts.total.toString()} />
      <Metric label="Memberships" value={summary.data.subscriptionCounts.total.toString()} />
      <Metric label="Enterprise orgs" value={summary.data.organizationCounts.total.toString()} />
      <Metric label="Managed creators" value={summary.data.managedCreatorCounts.total.toString()} />
      <Metric label="Managed allocations" value={summary.data.enterpriseAllocationCounts.confirmed.toString()} />
      <Metric label="Unlocks" value={summary.data.unlockCounts.total.toString()} />
    </div>
  );
}
