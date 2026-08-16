import type {
  AdminContentItem,
  AdminOpsSummary,
  AdminPage,
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
