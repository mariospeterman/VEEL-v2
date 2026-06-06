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

export function PaymentRow({ payment }: { payment: AdminPaymentIntent }) {
  return (
    <article className="grid gap-3 rounded border border-[var(--line)] bg-[var(--background)] p-3 text-sm md:grid-cols-[1fr_120px_160px]">
      <div className="min-w-0">
        <p className="font-medium">{payment.productType}</p>
        <p className="mt-1 truncate text-[var(--muted)]">{shorten(payment.referenceAddress)}</p>
      </div>
      <Fact label="State" value={payment.state} />
      <Fact label="Settlement attempts" value={(payment.settlementAttemptCount ?? 0).toString()} />
    </article>
  );
}

export function UnlockRow({ unlock }: { unlock: AdminUnlock }) {
  return (
    <article className="grid gap-3 rounded border border-[var(--line)] bg-[var(--background)] p-3 text-sm md:grid-cols-[1fr_120px_160px]">
      <div className="min-w-0">
        <p className="font-medium">{unlock.productType}</p>
        <p className="mt-1 truncate text-[var(--muted)]">{unlock.targetId}</p>
      </div>
      <Fact label="State" value={unlock.state} />
      <Fact label="Target" value={unlock.targetType} />
    </article>
  );
}

export function UserQueueRow({ user }: { user: AdminUser }) {
  return (
    <article className="grid gap-3 rounded border border-[var(--line)] bg-[var(--background)] p-3 text-sm md:grid-cols-[1fr_130px_190px]">
      <div className="min-w-0">
        <p className="font-medium">@{user.handle}</p>
        <p className="mt-1 truncate text-[var(--muted)]">{user.id}</p>
      </div>
      <Fact label="Age" value={user.ageState} />
      <Fact label="Wallet" value={user.walletState.connected ? "connected" : "missing"} />
    </article>
  );
}

export function ContentQueueRow({ content }: { content: AdminContentItem }) {
  return (
    <article className="grid gap-3 rounded border border-[var(--line)] bg-[var(--background)] p-3 text-sm md:grid-cols-[1fr_130px_190px]">
      <div className="min-w-0">
        <p className="font-medium">@{content.creator.handle}</p>
        <p className="mt-1 truncate text-[var(--muted)]">{content.id}</p>
      </div>
      <Fact label="Moderation" value={content.moderationState} />
      <Fact label="State" value={content.state} />
    </article>
  );
}

export function ReportQueueRow({ report }: { report: AdminReport }) {
  return (
    <article className="grid gap-3 rounded border border-[var(--line)] bg-[var(--background)] p-3 text-sm md:grid-cols-[1fr_130px_190px]">
      <div className="min-w-0">
        <p className="font-medium">{report.subjectType}</p>
        <p className="mt-1 truncate text-[var(--muted)]">{report.reason}</p>
      </div>
      <Fact label="State" value={report.state} />
      <Fact label="Subject" value={report.subjectId ?? "none"} />
    </article>
  );
}

export function EventOpsRow({ event }: { event: Event }) {
  const passCount = event.ticketTypes.reduce((total, ticketType) => total + ticketType.capacity - ticketType.remaining, 0);

  return (
    <article className="grid gap-3 rounded border border-[var(--line)] bg-[var(--background)] p-3 text-sm md:grid-cols-[1fr_130px_190px]">
      <div className="min-w-0">
        <p className="font-medium">{event.title}</p>
        <p className="mt-1 truncate text-[var(--muted)]">{event.id}</p>
      </div>
      <Fact label="State" value={event.state} />
      <Fact label="Issued" value={passCount.toString()} />
    </article>
  );
}

export function TicketOpsRow({ ticket }: { ticket: EventAccessPass }) {
  return (
    <article className="grid gap-3 rounded border border-[var(--line)] bg-[var(--background)] p-3 text-sm md:grid-cols-[1fr_130px_190px]">
      <div className="min-w-0">
        <p className="font-medium">Event Access Pass</p>
        <p className="mt-1 truncate text-[var(--muted)]">{ticket.id}</p>
      </div>
      <Fact label="State" value={ticket.state} />
      <Fact label="Check-in" value={timestampLabel(ticket.checkedInAt ?? null)} />
    </article>
  );
}

export function AuditEventRow({ event }: { event: AuditEvent }) {
  return (
    <article className="grid gap-3 rounded border border-[var(--line)] bg-[var(--background)] p-3 text-sm md:grid-cols-[1fr_130px_180px]">
      <div className="min-w-0">
        <p className="font-medium">{event.action}</p>
        <p className="mt-1 truncate text-[var(--muted)]">{event.id}</p>
      </div>
      <Fact label="Subject" value={event.subjectType} />
      <Fact label="Created" value={timestampLabel(event.createdAt)} />
    </article>
  );
}
