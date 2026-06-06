import { appShellNavItems } from "@veel/ui";
import { getEvent, type Event } from "@/api-client";

export default async function EventPage({
  params
}: {
  params: Promise<{ eventId: string }>;
}) {
  const { eventId } = await params;
  const eventResult = await getEvent(eventId);

  return (
    <main className="min-h-screen bg-[var(--background)] text-[var(--foreground)]">
      <AppNav />

      <section className="mx-auto grid w-full max-w-6xl gap-5 px-5 py-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        {eventResult.ok ? (
          <>
            <EventBody event={eventResult.data} />
            <EventState event={eventResult.data} />
          </>
        ) : (
          <UnavailableState
            message={eventResult.message}
            status={eventResult.status}
            title={eventResult.status === 404 ? "Event not found" : "Event unavailable"}
          />
        )}
      </section>
    </main>
  );
}

function EventBody({ event }: { event: Event }) {
  return (
    <section className="grid content-start gap-5">
      <div>
        <p className="text-sm font-medium text-[var(--accent)]">Event Access</p>
        <h1 className="mt-1 text-2xl font-semibold tracking-normal">{event.title}</h1>
        <p className="mt-2 text-sm text-[var(--muted)]">
          {event.description ?? "Backend-owned Event Access pass inventory."}
        </p>
      </div>

      <section className="rounded border border-[var(--line)] bg-[var(--panel)] p-4">
        <h2 className="text-base font-semibold tracking-normal">Access pass sheet</h2>
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
          {event.ticketTypes.length === 0 ? (
            <p className="rounded border border-[var(--line)] bg-[var(--background)] p-4 text-sm text-[var(--muted)]">
              No active pass types are available.
            </p>
          ) : null}
        </div>
      </section>
    </section>
  );
}

function EventState({ event }: { event: Event }) {
  return (
    <aside className="grid content-start gap-3">
      <section className="rounded border border-[var(--line)] bg-[var(--panel)] p-4">
        <p className="text-sm font-medium">Event Access state</p>
        <div className="mt-4 grid gap-3 text-sm">
          <Fact label="Status" value={event.state} />
          <Fact label="Starts" value={new Date(event.startsAt).toISOString()} />
          <Fact label="Location" value={event.location.label ?? event.location.type} />
        </div>
      </section>

      <section className="rounded border border-[var(--line)] bg-[var(--panel)] p-4">
        <p className="text-sm font-medium">Settlement boundary</p>
        <p className="mt-3 text-sm leading-6 text-[var(--muted)]">
          Pass intents and QR/check-in state are created by the backend after age, profile,
          wallet, inventory, and settlement checks.
        </p>
      </section>
    </aside>
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

function UnavailableState({
  message,
  status,
  title
}: {
  message: string;
  status: number;
  title: string;
}) {
  return (
    <section className="grid min-h-[68vh] content-center rounded border border-[var(--line)] bg-[var(--panel)] p-6 lg:col-span-2">
      <div className="max-w-xl">
        <p className="text-sm font-medium text-[var(--accent)]">HTTP {status}</p>
        <h1 className="mt-2 text-2xl font-semibold tracking-normal">{title}</h1>
        <p className="mt-3 text-sm leading-6 text-[var(--muted)]">{message}</p>
      </div>
    </section>
  );
}
