import { appShellNavItems } from "@veel/ui";
import { getEventAccessPassActivity, type EventAccessPassPage } from "@/api-client";

export default async function PassesPage() {
  const passesResult = await getEventAccessPassActivity();

  return (
    <main className="min-h-screen bg-[var(--background)] text-[var(--foreground)]">
      <AppNav />

      <section className="mx-auto grid w-full max-w-6xl gap-5 px-5 py-6">
        <div>
          <p className="text-sm font-medium text-[var(--accent)]">Passes</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-normal">My passes</h1>
        </div>

        {passesResult.ok ? (
          <PassGrid passes={passesResult.data} />
        ) : (
          <UnavailableState
            message={passesResult.message}
            status={passesResult.status}
            title="Passes unavailable"
          />
        )}
      </section>
    </main>
  );
}

function PassGrid({ passes }: { passes: EventAccessPassPage }) {
  if (passes.items.length === 0) {
    return (
      <section className="rounded border border-[var(--line)] bg-[var(--panel)] p-5">
        <h2 className="text-base font-semibold tracking-normal">No passes yet</h2>
        <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
          Backend-issued Event Access passes and QR tokens will appear here after confirmed
          settlement or creator approval.
        </p>
      </section>
    );
  }

  return (
    <div className="grid gap-3 md:grid-cols-2">
      {passes.items.map((pass) => (
        <article className="rounded border border-[var(--line)] bg-[var(--panel)] p-4" key={pass.id}>
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="font-medium">Event Access Pass</p>
              <p className="mt-1 truncate text-sm text-[var(--muted)]">{pass.eventId}</p>
            </div>
            <span className="rounded bg-[var(--accent-soft)] px-2 py-1 text-xs font-medium text-[var(--accent-strong)]">
              {pass.state}
            </span>
          </div>
          <div className="mt-4 rounded border border-[var(--line)] bg-[var(--background)] p-4 text-center">
            <p className="text-xs uppercase text-[var(--muted)]">QR token</p>
            <p className="mt-2 break-all font-mono text-sm">{pass.qrToken}</p>
          </div>
          <div className="mt-4 grid gap-2 text-sm sm:grid-cols-3">
            <Fact label="Pass" value={pass.id} />
            <Fact label="Payment" value={pass.paymentIntentId ?? "free"} />
            <Fact label="Check-in" value={pass.checkedInAt ?? "not checked in"} />
          </div>
        </article>
      ))}
    </div>
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
    <section className="rounded border border-[var(--line)] bg-[var(--panel)] p-5">
      <p className="text-sm font-medium text-[var(--accent)]">HTTP {status}</p>
      <h2 className="mt-2 text-base font-semibold tracking-normal">{title}</h2>
      <p className="mt-2 text-sm leading-6 text-[var(--muted)]">{message}</p>
    </section>
  );
}
