import { getSession, type SessionState } from "@/api-client";
import { getWebAuthState } from "@/supabase/auth-state";
import { EnterAuthPanel } from "./enter-auth-panel";
import { EnterWalletPanel } from "./enter-wallet-panel";
import { ProfileCompletionPanel } from "./profile-completion-panel";

export default async function EnterPage({
  searchParams
}: {
  searchParams?: Promise<{ error?: string; mode?: string; next?: string }>;
}) {
  const emptyParams: { error?: string; mode?: string; next?: string } = {};
  const [authState, params] = await Promise.all([getWebAuthState(), searchParams ?? Promise.resolve(emptyParams)]);
  const nextPath = safeNextPath(params.next);
  const mode = params.mode === "login" ? "login" : "onboarding";
  const session = authState.configured && authState.authenticated ? await getSession() : null;
  const appAccessState = session?.ok ? session.data.appAccessState : null;

  if (mode === "login") {
    return (
      <PublicAuthShell>
        <section className="auth-login-stage">
          <div className="auth-login-card">
            <h1>Log in to VEEL</h1>
            <p>Enter with a verified wallet session, or use email if you added it for recovery.</p>
            <div className="auth-login-grid">
              <EnterWalletPanel authState={authState} compact />
              <EnterAuthPanel authError={params.error ?? null} initialAuthState={authState} nextPath={nextPath} />
            </div>
            <p className="auth-switch">
              New here? <a href={`/enter?mode=onboarding&next=${encodeURIComponent(nextPath)}`}>Start onboarding</a>
            </p>
          </div>
        </section>
      </PublicAuthShell>
    );
  }

  return (
    <PublicAuthShell>
      <section className="auth-onboarding-stage">
        <div className="auth-onboarding-intro">
          <div className="auth-onboarding-heading">
            <div className="auth-chip">Media-first • Privacy-first • Built for creators</div>
            <h1>
              Set up your VEEL profile
              <span> for verified access</span>
            </h1>
            <p>
              Enter starts with a user-controlled Solana wallet, then profile and age verification
              unlock the protected app from the backend.
            </p>
          </div>

          <div className="auth-session-strip">
            <EnterAuthPanel authError={params.error ?? null} initialAuthState={authState} nextPath={nextPath} />
          </div>
        </div>

        <div className="auth-step-grid">
          <article className="auth-step-card">
            <StepNumber value="1" />
            <h2>Create or connect wallet</h2>
            <p>
              Use Phantom, Solflare, wallet adapter, or a configured non-custodial embedded wallet
              provider. Signing proves ownership only.
            </p>
            <EnterWalletPanel authState={authState} compact />
          </article>

          <article className="auth-step-card">
            <StepNumber value="2" />
            <h2>Create your profile</h2>
            <p>This is how the community will find you.</p>
            <ProfileCompletionPanel authState={authState} />
          </article>

          <article className="auth-step-card">
            <StepNumber value="3" />
            <h2>Verify age</h2>
            <p>
              Age providers run outside the browser UI. VEEL stores only safe verification state
              and gates the app from the backend.
            </p>
            <a className="secondary-button auth-step-link" href={`/age?next=${encodeURIComponent(nextPath)}`}>
              Open age verification
            </a>
            <p className="auth-step-note">Verified users continue directly into the app.</p>
          </article>
        </div>

        <div className="auth-bottom-actions">
          <a className="primary-button" href={nextHandoffPath(appAccessState, nextPath)}>
            Continue to age verification
          </a>
          <a className="secondary-button" href="/">
            Save and continue later
          </a>
          <p>Secure setup. We never store your private keys.</p>
        </div>
      </section>
    </PublicAuthShell>
  );
}

function safeNextPath(value?: string) {
  return value?.startsWith("/") && !value.startsWith("//") ? value : "/app/home";
}

function nextHandoffPath(
  appAccessState: SessionState["appAccessState"] | null,
  nextPath: string
) {
  const next = encodeURIComponent(nextPath);

  if (appAccessState?.allowed) {
    return nextPath;
  }

  if (appAccessState?.reason === "wallet_required") {
    return `/app/wallet?next=${next}`;
  }

  if (appAccessState?.reason === "age_required" || appAccessState?.reason === "age_pending") {
    return `/age?next=${next}`;
  }

  return `/enter?mode=onboarding&next=${next}`;
}

function PublicAuthShell({ children }: { children: React.ReactNode }) {
  return (
    <main className="auth-shell">
      <header className="auth-header">
        <a href="/">← Back to landing</a>
        <a className="auth-brand" href="/" aria-label="VEEL">
          <span aria-hidden="true" className="theme-logo theme-logo-dark" />
          <span aria-hidden="true" className="theme-logo theme-logo-light" />
          <span>VEEL</span>
        </a>
        <a className="auth-help" href="/safety" aria-label="Help">
          ?
        </a>
      </header>
      {children}
      <footer className="auth-footer">
        <span>© 2026 VEEL</span>
        <a href="/legal">Legal</a>
        <a href="/privacy">Privacy</a>
        <a href="/cookies">Cookies</a>
        <a href="/community-rules">Community Rules</a>
        <a href="/safety">Safety</a>
        <a href="/contact">Contact</a>
        <span>Built on Solana</span>
      </footer>
    </main>
  );
}

function StepNumber({ value }: { value: string }) {
  return <span className="auth-step-number">{value}</span>;
}
