import { getAgeStatus, type AgeStatus } from "@/api-client";
import { getWebAuthState } from "@/supabase/auth-state";
import { Card, ErrorState, Fact, PageHeader, StatusPill } from "../ui";
import { AgeSessionPanel } from "./age-session-panel";

const providerRows = [
  { label: "Reusable first", value: "Yoti / portable proof" },
  { label: "Fallback", value: "Sumsub / Veriff / Persona" },
  { label: "Storage", value: "normalized result only" },
  { label: "Webhook", value: "signature verified" }
];

export default async function AgePage() {
  const [authState, ageStatus] = await Promise.all([getWebAuthState(), getAgeStatus()]);

  return (
    <main className="min-h-screen bg-(--background) text-(--foreground)">
      <nav className="mx-auto flex w-full max-w-5xl items-center justify-between border-b border-(--line) px-5 py-4">
        <a className="text-lg font-semibold tracking-normal" href="/">
          WeVid
        </a>
        <a className="rounded px-3 py-2 text-sm text-(--muted) transition hover:bg-(--panel)" href="/?mode=login">
          Enter
        </a>
      </nav>

      <section className="mx-auto grid w-full max-w-5xl gap-5 px-5 py-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <section className="grid content-start gap-4">
          <PageHeader eyebrow="Age assurance" title="Provider-backed 18+ gate">
              Protected app access changes only after the backend receives and verifies provider evidence.
          </PageHeader>

          <Card className="p-4">
            {ageStatus.ok ? <AgeStatusCard ageStatus={ageStatus.data} /> : <ErrorState result={ageStatus} title="Age status unavailable" context="Age status" />}
          </Card>

          <AgeSessionPanel authState={authState} />
        </section>

        <aside className="grid content-start gap-3">
          {providerRows.map((row) => (
            <Card className="p-4" key={row.label}>
              <Fact label={row.label} value={row.value} />
            </Card>
          ))}
        </aside>
      </section>
    </main>
  );
}

function AgeStatusCard({ ageStatus }: { ageStatus: AgeStatus }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div>
        <p className="text-sm font-medium">Current status</p>
        <p className="mt-2 text-3xl font-semibold tracking-normal">{ageStatus.state}</p>
        <p className="mt-2 text-sm text-(--muted)">{ageStatus.provider ?? "provider not selected"}</p>
      </div>
      <StatusPill>server-owned</StatusPill>
    </div>
  );
}
