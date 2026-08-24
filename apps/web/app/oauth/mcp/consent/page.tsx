import { appShellNavItems } from "@veel/ui";
import { getMcpConsentRequest } from "@/api-client";
import { mcpClientTypeLabel, mcpConnectionStateLabel, mcpRoleLabel, mcpScopeLabel } from "@/mcp-display";
import { requireConfiguredSession } from "@/supabase/route-guard";
import { McpConsentDecisionPanel } from "./mcp-consent-decision-panel";

export const dynamic = "force-dynamic";

export default async function McpOAuthConsentPage({
  searchParams
}: {
  searchParams: Promise<{ requestId?: string }>;
}) {
  const params = await searchParams;
  const requestId = params.requestId ?? "";

  await requireConfiguredSession(`/oauth/mcp/consent?requestId=${encodeURIComponent(requestId)}`);

  const consent = requestId ? await getMcpConsentRequest(requestId) : null;

  return (
    <main className="min-h-screen bg-(--background) text-(--foreground)">
      <nav className="mx-auto flex w-full max-w-5xl items-center justify-between border-b border-(--line) px-5 py-4">
        <a className="text-lg font-semibold tracking-normal" href="/">
          WeVid
        </a>
        <div className="flex gap-1 overflow-x-auto">
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

      <section className="mx-auto grid w-full max-w-3xl gap-5 px-5 py-8">
        <header>
          <p className="text-sm font-medium text-(--accent-text)">Connected assistant</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-normal">Choose what this assistant can do</h1>
          <p className="mt-2 text-sm text-(--muted)">Approve only if you started this connection. You can revoke it later in Settings.</p>
        </header>

        {!requestId || !consent ? (
          <UnavailableConsent message="Missing OAuth consent request." />
        ) : consent.ok ? (
          <section className="grid gap-4 rounded border border-(--line) bg-(--panel) p-4">
            <div>
              <p className="text-sm text-(--muted)">Client</p>
              <p className="mt-1 font-medium">{consent.data.clientName}</p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Fact label="Access type" value={mcpRoleLabel(consent.data.roleType)} />
              <Fact label="Assistant" value={mcpClientTypeLabel(consent.data.clientType)} />
              <Fact label="Status" value={mcpConnectionStateLabel(consent.data.status)} />
            </div>
            <div>
              <p className="text-sm text-(--muted)">Requested permissions</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {consent.data.requestedScopes.map((scope) => (
                  <span className="rounded border border-(--line) bg-(--background) px-2 py-1 text-xs" key={scope}>
                    {mcpScopeLabel(scope)}
                  </span>
                ))}
              </div>
              <p className="mt-3 text-xs text-(--muted)">
                Draft permission creates SFW private drafts only. It never grants publishing, payment, wallet signing, messaging, moderation, or account-administration access.
              </p>
            </div>
            <McpConsentDecisionPanel requestId={requestId} />
          </section>
        ) : (
          <UnavailableConsent message={consent.message} />
        )}
      </section>
    </main>
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

function UnavailableConsent({ message }: { message: string }) {
  return (
    <section className="rounded border border-(--line) bg-(--panel) p-4">
      <p className="font-medium">Consent request unavailable</p>
      <p className="mt-1 text-sm text-(--muted)">{message}</p>
    </section>
  );
}
