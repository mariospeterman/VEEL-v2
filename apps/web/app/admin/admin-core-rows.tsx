import type {
  AuditEvent,
  AdminContentItem,
  AdminPaymentIntent,
  AdminReport,
  AdminUnlock,
  AdminUser,
  Event,
  EventAccessPass
} from "@/api-client";
import {
  Fact,
  shorten,
  timestampLabel
} from "./admin-ui";
import { updateContentModerationAction } from "./actions";

export function PaymentRow({ payment }: { payment: AdminPaymentIntent }) {
  return (
    <article className="grid gap-3 rounded border border-(--line) bg-(--background) p-3 text-sm md:grid-cols-[1fr_120px_160px]">
      <div className="min-w-0">
        <p className="font-medium">{payment.productType}</p>
        <p className="mt-1 truncate text-(--muted)">{shorten(payment.referenceAddress)}</p>
      </div>
      <Fact label="State" value={payment.state} />
      <Fact label="Settlement attempts" value={(payment.settlementAttemptCount ?? 0).toString()} />
    </article>
  );
}

export function UnlockRow({ unlock }: { unlock: AdminUnlock }) {
  return (
    <article className="grid gap-3 rounded border border-(--line) bg-(--background) p-3 text-sm md:grid-cols-[1fr_120px_160px]">
      <div className="min-w-0">
        <p className="font-medium">{unlock.productType}</p>
        <p className="mt-1 truncate text-(--muted)">{unlock.targetId}</p>
      </div>
      <Fact label="State" value={unlock.state} />
      <Fact label="Target" value={unlock.targetType} />
    </article>
  );
}

export function UserQueueRow({ user }: { user: AdminUser }) {
  return (
    <article className="grid gap-3 rounded border border-(--line) bg-(--background) p-3 text-sm md:grid-cols-[1fr_130px_190px]">
      <div className="min-w-0">
        <p className="font-medium">@{user.handle}</p>
        <p className="mt-1 truncate text-(--muted)">{user.id}</p>
      </div>
      <Fact label="Age" value={user.ageState} />
      <Fact label="Wallet" value={user.walletState.connected ? "connected" : "missing"} />
    </article>
  );
}

export function ContentQueueRow({ content }: { content: AdminContentItem }) {
  return (
    <article className="grid gap-3 rounded border border-(--line) bg-(--background) p-3 text-sm">
      <div className="grid gap-3 md:grid-cols-[1fr_130px_190px]">
      <div className="min-w-0">
        <p className="font-medium">@{content.creator.handle}</p>
        <p className="mt-1 truncate text-(--muted)">{content.id}</p>
      </div>
      <Fact label="Moderation" value={content.moderationState} />
      <Fact label="State" value={content.state} />
      </div>
      <form action={updateContentModerationAction} className="grid gap-2 border-t border-(--line) pt-3 sm:grid-cols-[180px_minmax(0,1fr)_auto]">
        <input name="contentId" type="hidden" value={content.id} />
        <label className="grid gap-1">
          <span className="text-xs text-(--muted)">Decision</span>
          <select className="rounded border border-(--line) bg-(--panel) px-3 py-2" defaultValue="approve" name="action">
            <option value="approve">Approve</option>
            <option value="request_changes">Request changes</option>
            <option value="restrict">Keep in review</option>
            <option value="block">Reject and block</option>
          </select>
        </label>
        <label className="grid gap-1">
          <span className="text-xs text-(--muted)">Uploader-safe message (no PII or provider evidence)</span>
          <input className="rounded border border-(--line) bg-(--panel) px-3 py-2" maxLength={500} minLength={3} name="reason" placeholder="Clear reason or requested change" required />
        </label>
        <button className="self-end rounded bg-(--foreground) px-3 py-2 font-semibold text-(--background)" type="submit">Save decision</button>
      </form>
    </article>
  );
}

export function ReportQueueRow({ report }: { report: AdminReport }) {
  return (
    <article className="grid gap-3 rounded border border-(--line) bg-(--background) p-3 text-sm md:grid-cols-[1fr_130px_190px]">
      <div className="min-w-0">
        <p className="font-medium">{report.subjectType}</p>
        <p className="mt-1 truncate text-(--muted)">{report.reason}</p>
      </div>
      <Fact label="State" value={report.state} />
      <Fact label="Subject" value={report.subjectId ?? "none"} />
    </article>
  );
}

export function EventOpsRow({ event }: { event: Event }) {
  const passCount = event.accessPassTypes.reduce((total, accessPassType) => total + accessPassType.capacity - accessPassType.remaining, 0);

  return (
    <article className="grid gap-3 rounded border border-(--line) bg-(--background) p-3 text-sm md:grid-cols-[1fr_130px_190px]">
      <div className="min-w-0">
        <p className="font-medium">{event.title}</p>
        <p className="mt-1 truncate text-(--muted)">{event.id}</p>
      </div>
      <Fact label="State" value={event.state} />
      <Fact label="Issued" value={passCount.toString()} />
    </article>
  );
}

export function AccessPassOpsRow({ accessPass }: { accessPass: EventAccessPass }) {
  return (
    <article className="grid gap-3 rounded border border-(--line) bg-(--background) p-3 text-sm md:grid-cols-[1fr_130px_190px]">
      <div className="min-w-0">
        <p className="font-medium">Event Access Pass</p>
        <p className="mt-1 truncate text-(--muted)">{accessPass.id}</p>
      </div>
      <Fact label="State" value={accessPass.state} />
      <Fact label="Check-in" value={timestampLabel(accessPass.checkedInAt ?? null)} />
    </article>
  );
}

export function AuditEventRow({ event }: { event: AuditEvent }) {
  return (
    <article className="grid gap-3 rounded border border-(--line) bg-(--background) p-3 text-sm md:grid-cols-[1fr_130px_180px]">
      <div className="min-w-0">
        <p className="font-medium">{event.action}</p>
        <p className="mt-1 truncate text-(--muted)">{event.id}</p>
      </div>
      <Fact label="Subject" value={event.subjectType} />
      <Fact label="Created" value={timestampLabel(event.createdAt)} />
    </article>
  );
}
