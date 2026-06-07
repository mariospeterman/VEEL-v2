import type { components } from "@veel/contracts";
import { getWebAuthState } from "@/supabase/auth-state";
import { EnterAuthPanel } from "./enter-auth-panel";

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

export default async function EnterPage({
  searchParams
}: {
  searchParams?: Promise<{ error?: string }>;
}) {
  const emptyParams: { error?: string } = {};
  const [authState, params] = await Promise.all([getWebAuthState(), searchParams ?? Promise.resolve(emptyParams)]);
  const sessionAccessReason = authState.authenticated
    ? sessionState.appAccessState.reason
    : "identity_required";

  return (
    <main className="grid min-h-screen bg-(--background) text-(--foreground) lg:grid-cols-[minmax(0,1fr)_420px]">
      <section className="flex min-h-[56vh] flex-col justify-between px-5 py-6 lg:min-h-screen lg:px-10">
        <a className="text-lg font-semibold tracking-normal" href="/">
          VEEL
        </a>

        <div className="max-w-2xl">
          <p className="text-sm font-medium text-(--accent)">Enter</p>
          <h1 className="mt-2 text-4xl font-semibold tracking-normal sm:text-5xl">Identity, wallet, then age gate.</h1>
          <p className="mt-4 max-w-xl text-base leading-7 text-(--muted)">
            The browser never decides protected access. It starts the correct backend-owned checks and waits for server state.
          </p>
        </div>

        <div className="grid gap-2 text-sm text-(--muted) sm:grid-cols-3">
          <Fact label="Session" value={authState.authenticated ? "active" : "needed"} />
          <Fact label="Access" value={sessionAccessReason} />
          <Fact label="Wallet" value="required" />
        </div>
      </section>

      <section className="grid content-center gap-3 border-t border-(--line) bg-(--panel) px-5 py-6 lg:border-l lg:border-t-0">
        <EnterAuthPanel authError={params.error ?? null} initialAuthState={authState} />

        {entryOptions.map((option, index) => (
          <article className="rounded border border-(--line) bg-(--background) p-4" key={option.title}>
            <p className="text-xs font-semibold uppercase text-(--accent)">Step {index + 1}</p>
            <h2 className="mt-2 text-base font-semibold tracking-normal">{option.title}</h2>
            <p className="mt-2 text-sm leading-6 text-(--muted)">{option.detail}</p>
          </article>
        ))}

        <a
          className="mt-2 rounded bg-(--foreground) px-4 py-3 text-center text-sm font-semibold text-(--background)"
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
      <p className="mt-1 font-medium text-(--foreground)">{value}</p>
    </div>
  );
}
