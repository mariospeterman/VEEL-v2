import { appShellNavItems } from "@veel/ui";
import { getEvent, type Event } from "@/api-client";
import { ErrorState } from "../../ui";
import { EventAccessPassPanel } from "./event-access-pass-panel";

export default async function EventPage({
  params
}: {
  params: Promise<{ eventId: string }>;
}) {
  const { eventId } = await params;
  const eventResult = await getEvent(eventId);

  return (
    <main className="min-h-screen bg-(--background) text-(--foreground)">
      <AppNav />

      <section className="mx-auto grid w-full max-w-6xl gap-5 px-5 py-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        {eventResult.ok ? (
          <>
            <EventBody event={eventResult.data} />
            <EventState event={eventResult.data} />
          </>
        ) : (
          <section className="lg:col-span-2">
            <ErrorState
              context="Event Access"
              result={eventResult}
              title={eventResult.status === 404 ? "Event not found" : "Event unavailable"}
            />
          </section>
        )}
      </section>
    </main>
  );
}

function EventBody({ event }: { event: Event }) {
  return (
    <section className="grid content-start gap-5">
      <div>
        <p className="text-sm font-medium text-(--accent-text)">Event Access</p>
        <h1 className="mt-1 text-2xl font-semibold tracking-normal">{event.title}</h1>
        <p className="mt-2 text-sm text-(--muted)">
          {event.description ?? "Review the available passes and choose how you want to attend."}
        </p>
      </div>

      <EventAccessPassPanel event={event} />
    </section>
  );
}

function EventState({ event }: { event: Event }) {
  return (
    <aside className="grid content-start gap-3">
      <section className="rounded border border-(--line) bg-(--panel) p-4">
        <p className="text-sm font-medium">Event details</p>
        <div className="mt-4 grid gap-3 text-sm">
          <Fact label="Status" value={eventStateLabel(event.state)} />
          <Fact label="Starts" value={new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(event.startsAt))} />
          <Fact label="Location" value={event.location.label ?? (event.location.type === "digital_live_stream" ? "Online" : "To be announced")} />
        </div>
      </section>

      <section className="rounded border border-(--line) bg-(--panel) p-4">
        <p className="text-sm font-medium">Your pass</p>
        <p className="mt-3 text-sm leading-6 text-(--muted)">
          Availability is checked before checkout. Paid passes appear only after payment confirmation.
        </p>
      </section>
    </aside>
  );
}

function eventStateLabel(state: Event["state"]) {
  if (state === "published") return "On sale";
  if (state === "cancelled") return "Cancelled";
  if (state === "completed") return "Complete";
  return "Coming soon";
}

function AppNav() {
  return (
    <nav className="mx-auto flex w-full max-w-6xl items-center justify-between border-b border-(--line) px-5 py-4">
      <a className="text-lg font-semibold tracking-normal" href="/">
        WeVid
      </a>
      <div className="flex gap-1">
        {appShellNavItems.map((item) => (
          <a
            className="rounded px-3 py-2 text-sm text-(--muted) transition hover:bg-(--panel) hover:text-(--foreground)"
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
      <p className="text-xs uppercase text-(--muted)">{label}</p>
      <p className="mt-1 truncate font-medium">{value}</p>
    </div>
  );
}
