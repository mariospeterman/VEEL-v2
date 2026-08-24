import { Activity, BellRing, Database, Radio, ShieldCheck } from "lucide-react";
import { getAdminAnalyticsHealth, getAdminCurrentStaff, getAdminNotificationHealth, getAdminOpsSummary } from "@/api-client";

export default async function AdminOverviewPage() {
  const access = await getAdminCurrentStaff();
  const permissions = new Set(access.ok ? access.data.permissions : []);
  const [summary, analytics, notifications] = await Promise.all([
    getAdminOpsSummary(),
    permissions.has("admin.analytics.read") ? getAdminAnalyticsHealth() : null,
    permissions.has("admin.queues.read") ? getAdminNotificationHealth() : null
  ]);

  return (
    <div className="grid gap-6">
      <header>
        <p className="text-sm font-semibold text-(--accent-text)">Operations</p>
        <h1 className="mt-1 text-3xl font-semibold tracking-[-0.03em]">Platform overview</h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-(--muted)">Health, queues and provider boundaries for the current release.</p>
      </header>

      {!summary.ok ? <Failure message={summary.message} /> : (
        <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <HealthCard icon={Radio} label="Providers" value={summary.data.providerHealth} />
          <HealthCard icon={Database} label="Queues" value={summary.data.queueHealth} />
          <HealthCard icon={ShieldCheck} label="Open reports" value={String(summary.data.openReports)} />
          <HealthCard icon={Activity} label="Payments" value={String(summary.data.paymentCounts.total)} />
        </section>
      )}

      <section className="grid gap-4 xl:grid-cols-2">
        <article className="rounded-2xl border border-(--line) bg-(--panel) p-5">
          <div className="flex items-center gap-3"><Activity className="size-5" /><h2 className="font-semibold">Analytics projections</h2></div>
          <p className="mt-4 text-sm text-(--muted)">{analytics?.ok ? "Projection health is available and permission-scoped." : analytics?.message ?? "Not included in your role."}</p>
        </article>
        <article className="rounded-2xl border border-(--line) bg-(--panel) p-5">
          <div className="flex items-center gap-3"><BellRing className="size-5" /><h2 className="font-semibold">Notifications</h2></div>
          <p className="mt-4 text-sm text-(--muted)">{notifications?.ok ? `${notifications.data.queuedDeliveryCount} queued · ${notifications.data.failedDeliveryCount} failed` : notifications?.message ?? "Not included in your role."}</p>
        </article>
      </section>

      {summary.ok ? (
        <section className="rounded-2xl border border-(--line) bg-(--panel) p-5">
          <h2 className="font-semibold">Worker queues</h2>
          <div className="mt-4 divide-y divide-(--line)">
            {summary.data.workerQueues.map((queue) => (
              <div className="grid grid-cols-[minmax(0,1fr)_repeat(3,auto)] items-center gap-4 py-3 text-sm" key={queue.name}>
                <span className="min-w-0 truncate font-medium">{queue.name.replaceAll("_", " ")}</span>
                <span className="text-(--muted)">{queue.pendingCount} pending</span>
                <span className="text-(--muted)">{queue.failedCount} failed</span>
                <span className="text-(--muted)">{queue.deadLetterCount} dead</span>
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}

function HealthCard({ icon: Icon, label, value }: { icon: typeof Radio; label: string; value: string }) {
  return (
    <article className="rounded-2xl border border-(--line) bg-(--panel) p-5">
      <Icon aria-hidden="true" className="size-5 text-(--muted)" />
      <p className="mt-5 text-xs font-semibold uppercase tracking-[0.14em] text-(--muted)">{label}</p>
      <p className="mt-1 text-xl font-semibold capitalize">{value}</p>
    </article>
  );
}

function Failure({ message }: { message: string }) {
  return <div className="rounded-2xl border border-(--line) bg-(--panel) p-5 text-sm text-(--muted)">{message}</div>;
}
