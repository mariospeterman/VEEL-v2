import { getAgeStatus, type AgeStatus, type ApiResult } from "@/api-client";
import { getWebAuthState } from "@/supabase/auth-state";
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
          VEEL
        </a>
        <a className="rounded px-3 py-2 text-sm text-(--muted) transition hover:bg-(--panel)" href="/enter">
          Enter
        </a>
      </nav>

      <section className="mx-auto grid w-full max-w-5xl gap-5 px-5 py-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <section className="grid content-start gap-4">
          <header>
            <p className="text-sm font-medium text-(--accent)">Age assurance</p>
            <h1 className="mt-1 text-2xl font-semibold tracking-normal">Provider-backed 18+ gate</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-(--muted)">
              Protected app access changes only after the backend receives and verifies provider evidence.
            </p>
          </header>

          <section className="rounded border border-(--line) bg-(--panel) p-4">
            {ageStatus.ok ? <AgeStatusCard ageStatus={ageStatus.data} /> : <UnavailableState result={ageStatus} />}
          </section>

          <AgeSessionPanel authState={authState} />
        </section>

        <aside className="grid content-start gap-3">
          {providerRows.map((row) => (
            <article className="rounded border border-(--line) bg-(--panel) p-4" key={row.label}>
              <Fact label={row.label} value={row.value} />
            </article>
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
      <span className="rounded bg-(--background) px-2 py-1 text-xs text-(--muted)">server-owned</span>
    </div>
  );
}

function UnavailableState({ result }: { result: ApiResult<AgeStatus> }) {
  if (result.ok) {
    return null;
  }

  return (
    <div>
      <p className="text-sm font-medium text-(--accent)">HTTP {result.status}</p>
      <h2 className="mt-2 text-base font-semibold tracking-normal">Age status unavailable</h2>
      <p className="mt-2 text-sm leading-6 text-(--muted)">{result.message}</p>
    </div>
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
