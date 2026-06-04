import type { components } from "@veel/contracts";
import { appShellNavItems } from "@veel/ui";

type Event = components["schemas"]["Event"];

const event: Event = {
  id: "00000000-0000-4000-8000-0000000000e1",
  title: "Studio meetup",
  description: "Creator-hosted event with backend-owned ticket inventory.",
  startsAt: "2026-07-01T20:00:00.000Z",
  endsAt: null,
  accessRule: "public_sale",
  location: { type: "physical", label: "Belgrade studio" },
  state: "published",
  ticketTypes: [
    {
      id: "00000000-0000-4000-8000-0000000000e2",
      label: "General admission",
      priceMinor: 10000000,
      currency: "SOL",
      capacity: 25,
      remaining: 18,
      state: "active",
      saleStartsAt: null,
      saleEndsAt: null,
      perUserLimit: 1
    }
  ]
};

export default function EventPage() {
  return (
    <main className="min-h-screen bg-[var(--background)] text-[var(--foreground)]">
      <AppNav />

      <section className="mx-auto grid w-full max-w-6xl gap-5 px-5 py-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <section className="grid content-start gap-5">
          <div>
            <p className="text-sm font-medium text-[var(--accent)]">Event</p>
            <h1 className="mt-1 text-2xl font-semibold tracking-normal">{event.title}</h1>
            <p className="mt-2 text-sm text-[var(--muted)]">{event.description}</p>
          </div>

          <section className="rounded border border-[var(--line)] bg-[var(--panel)] p-4">
            <h2 className="text-base font-semibold tracking-normal">Ticket sheet</h2>
            <div className="mt-4 grid gap-3">
              {event.ticketTypes.map((ticketType) => (
                <article className="rounded border border-[var(--line)] bg-[var(--background)] p-4" key={ticketType.id}>
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="font-medium">{ticketType.label}</p>
                      <p className="mt-1 text-sm text-[var(--muted)]">{ticketType.remaining} remaining</p>
                    </div>
                    <span className="rounded bg-[var(--accent-soft)] px-2 py-1 text-xs font-medium text-[var(--accent-strong)]">
                      {ticketType.state}
                    </span>
                  </div>
                  <div className="mt-4 grid gap-2 text-sm sm:grid-cols-3">
                    <Fact label="Price" value={`${ticketType.priceMinor?.toLocaleString() ?? "free"} ${ticketType.currency}`} />
                    <Fact label="Capacity" value={ticketType.capacity.toString()} />
                    <Fact label="Access" value={event.accessRule} />
                  </div>
                </article>
              ))}
            </div>
          </section>
        </section>

        <aside className="grid content-start gap-3">
          <section className="rounded border border-[var(--line)] bg-[var(--panel)] p-4">
            <p className="text-sm font-medium">Event state</p>
            <div className="mt-4 grid gap-3 text-sm">
              <Fact label="Status" value={event.state} />
              <Fact label="Starts" value={new Date(event.startsAt).toISOString()} />
              <Fact label="Location" value={event.location.label ?? event.location.type} />
            </div>
          </section>
        </aside>
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
