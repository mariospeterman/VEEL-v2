import { getAgeStatus, type AgeStatus } from "@/api-client";
import { getWebAuthState } from "@/supabase/auth-state";
import { Card, ErrorState, PageHeader, StatusPill } from "../ui";
import { AgeSessionPanel } from "./age-session-panel";

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

      <section className="mx-auto grid w-full max-w-2xl gap-5 px-5 py-6">
        <section className="grid content-start gap-4">
          <PageHeader eyebrow="Age assurance" title="Confirm you're 18+">
            Verify your age to enter WeVid. We keep only the normalized result needed for access.
          </PageHeader>

          <Card className="p-4">
            {ageStatus.ok ? <AgeStatusCard ageStatus={ageStatus.data} /> : <ErrorState result={ageStatus} title="Age status unavailable" context="Age status" />}
          </Card>

          <AgeSessionPanel authState={authState} />
        </section>

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
        <p className="mt-2 text-sm text-(--muted)">Verification is enforced by the server.</p>
      </div>
      <StatusPill>server-owned</StatusPill>
    </div>
  );
}
