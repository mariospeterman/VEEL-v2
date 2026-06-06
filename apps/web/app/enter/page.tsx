import type { components } from "@veel/contracts";

type SessionState = components["schemas"]["SessionState"];

const sessionState: SessionState = {
  authenticated: false,
  appAccessState: {
    allowed: false,
    reason: "identity_required"
  }
};

const entryOptions = [
  {
    title: "Email or passkey",
    detail: "Create a Supabase session and load a user-controlled embedded wallet."
  },
  {
    title: "External Solana wallet",
    detail: "Sign the backend challenge and link a wallet before protected app access."
  },
  {
    title: "Age assurance",
    detail: "Continue to provider-backed 18+ verification after identity and wallet readiness."
  }
];

export default function EnterPage() {
  return (
    <main className="grid min-h-screen bg-[var(--background)] text-[var(--foreground)] lg:grid-cols-[minmax(0,1fr)_420px]">
      <section className="flex min-h-[56vh] flex-col justify-between px-5 py-6 lg:min-h-screen lg:px-10">
        <a className="text-lg font-semibold tracking-normal" href="/">
          VEEL
        </a>

        <div className="max-w-2xl">
          <p className="text-sm font-medium text-[var(--accent)]">Enter</p>
          <h1 className="mt-2 text-4xl font-semibold tracking-normal sm:text-5xl">Identity, wallet, then age gate.</h1>
          <p className="mt-4 max-w-xl text-base leading-7 text-[var(--muted)]">
            The browser never decides protected access. It starts the correct backend-owned checks and waits for server state.
          </p>
        </div>

        <div className="grid gap-2 text-sm text-[var(--muted)] sm:grid-cols-3">
          <Fact label="Session" value={sessionState.authenticated ? "active" : "needed"} />
          <Fact label="Access" value={sessionState.appAccessState.reason} />
          <Fact label="Wallet" value="required" />
        </div>
      </section>

      <section className="grid content-center gap-3 border-t border-[var(--line)] bg-[var(--panel)] px-5 py-6 lg:border-l lg:border-t-0">
        {entryOptions.map((option, index) => (
          <article className="rounded border border-[var(--line)] bg-[var(--background)] p-4" key={option.title}>
            <p className="text-xs font-semibold uppercase text-[var(--accent)]">Step {index + 1}</p>
            <h2 className="mt-2 text-base font-semibold tracking-normal">{option.title}</h2>
            <p className="mt-2 text-sm leading-6 text-[var(--muted)]">{option.detail}</p>
          </article>
        ))}

        <a
          className="mt-2 rounded bg-[var(--foreground)] px-4 py-3 text-center text-sm font-semibold text-[var(--background)]"
          href="/age"
        >
          Continue
        </a>
      </section>
    </main>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs uppercase">{label}</p>
      <p className="mt-1 font-medium text-[var(--foreground)]">{value}</p>
    </div>
  );
}
