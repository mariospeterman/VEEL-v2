import { getEventAccessPassActivity, type EventAccessPassPage } from "@/api-client";
import { requireAppAccess } from "@/supabase/route-guard";
import { AppShell } from "../app-shell";
import { Card, EmptyState, ErrorState, Fact, PageHeader, StatusPill } from "../ui";

export const dynamic = "force-dynamic";

export default async function PassesPage() {
  await requireAppAccess("/passes");

  const passesResult = await getEventAccessPassActivity();

  return (
    <AppShell>
      <section className="grid gap-5">
        <PageHeader eyebrow="Passes" title="My Event Access">
          Backend-issued passes and check-in state for events.
        </PageHeader>

        {passesResult.ok ? (
          <PassGrid passes={passesResult.data} />
        ) : (
          <ErrorState result={passesResult} title="Passes unavailable" context="Passes" />
        )}
      </section>
    </AppShell>
  );
}

function PassGrid({ passes }: { passes: EventAccessPassPage }) {
  if (passes.items.length === 0) {
    return (
      <EmptyState title="No passes yet">
          Backend-issued Event Access passes and QR tokens will appear here after confirmed
          settlement or creator approval.
      </EmptyState>
    );
  }

  return (
    <div className="grid gap-3 md:grid-cols-2">
      {passes.items.map((pass) => (
        <Card className="p-4" key={pass.id}>
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="font-medium">Event Access Pass</p>
              <p className="mt-1 truncate text-sm text-(--muted)">{pass.eventId}</p>
            </div>
            <StatusPill>{pass.state}</StatusPill>
          </div>
          <div className="mt-4 rounded border border-(--line) bg-(--background) p-4 text-center">
            <p className="text-xs uppercase text-(--muted)">QR token</p>
            <p className="mt-2 break-all font-mono text-sm">{pass.qrToken}</p>
          </div>
          <div className="mt-4 grid gap-2 text-sm sm:grid-cols-3">
            <Fact label="Pass" value={pass.id} />
            <Fact label="Payment" value={pass.paymentIntentId ?? "free"} />
            <Fact label="Check-in" value={pass.checkedInAt ?? "not checked in"} />
          </div>
        </Card>
      ))}
    </div>
  );
}
