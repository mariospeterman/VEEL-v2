import type { components } from "@veel/contracts";
import { appShellNavItems } from "@veel/ui";

type Ticket = components["schemas"]["Ticket"];

const tickets: Ticket[] = [
  {
    id: "00000000-0000-4000-8000-0000000000f1",
    eventId: "00000000-0000-4000-8000-0000000000e1",
    ticketTypeId: "00000000-0000-4000-8000-0000000000e2",
    holderUserId: "00000000-0000-4000-8000-000000000001",
    paymentIntentId: "00000000-0000-4000-8000-000000000050",
    state: "active",
    qrToken: "veel_ticket_fixture",
    checkedInAt: null,
    createdAt: "2026-07-01T20:00:00.000Z"
  }
];

export default function TicketsPage() {
  return (
    <main className="min-h-screen bg-[var(--background)] text-[var(--foreground)]">
      <AppNav />

      <section className="mx-auto grid w-full max-w-6xl gap-5 px-5 py-6">
        <div>
          <p className="text-sm font-medium text-[var(--accent)]">Tickets</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-normal">My tickets</h1>
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          {tickets.map((ticket) => (
            <article className="rounded border border-[var(--line)] bg-[var(--panel)] p-4" key={ticket.id}>
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <p className="font-medium">Studio meetup</p>
                  <p className="mt-1 truncate text-sm text-[var(--muted)]">{ticket.eventId}</p>
                </div>
                <span className="rounded bg-[var(--accent-soft)] px-2 py-1 text-xs font-medium text-[var(--accent-strong)]">
                  {ticket.state}
                </span>
              </div>
              <div className="mt-4 rounded border border-[var(--line)] bg-[var(--background)] p-4 text-center">
                <p className="text-xs uppercase text-[var(--muted)]">QR token</p>
                <p className="mt-2 break-all font-mono text-sm">{ticket.qrToken}</p>
              </div>
              <div className="mt-4 grid gap-2 text-sm sm:grid-cols-3">
                <Fact label="Ticket" value={ticket.id} />
                <Fact label="Payment" value={ticket.paymentIntentId ?? "free"} />
                <Fact label="Check-in" value={ticket.checkedInAt ?? "not checked in"} />
              </div>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}

function AppNav() {
  return (
    <nav className="mx-auto flex w-full max-w-6xl items-center justify-between border-b border-[var(--line)] px-5 py-4">
      <a className="text-lg font-semibold tracking-normal" href="/">
        VEEL
      </a>
      <div className="flex gap-1">
        {appShellNavItems.map((item) => (
          <a
            className="rounded px-3 py-2 text-sm text-[var(--muted)] transition hover:bg-[var(--panel)] hover:text-[var(--foreground)]"
            href={item.href}
            key={item.href}
          >
            {item.label}
          </a>
        ))}
      </div>
    </nav>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <p className="text-xs uppercase text-[var(--muted)]">{label}</p>
      <p className="mt-1 truncate font-medium">{value}</p>
    </div>
  );
}
