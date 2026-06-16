import { getAiCapabilities, type AiCapabilities, type ApiResult } from "@/api-client";
import { requireAppAccess } from "@/supabase/route-guard";
import { AppShell } from "../app-shell";
import { Card, ErrorState, Fact, PageHeader, StatusPill } from "../ui";

export const dynamic = "force-dynamic";

export default async function AssistantPage() {
  await requireAppAccess("/app/assistant");

  const capabilities = await getAiCapabilities();

  return (
    <AppShell>
      <PageHeader action={<StatusPill>No LLM keys</StatusPill>} eyebrow="AI / MCP" title="Scoped assistant access">
        This is a profile/admin capability projection for MCP-connected clients, not a standalone chatbot.
        External clients bring their own AI and every tool remains backend-authorized.
      </PageHeader>

      <section className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
        <CapabilityList capabilities={capabilities} />

        <aside className="grid content-start gap-3">
          <Card className="p-4">
            <p className="text-sm font-medium text-(--muted)">Connection model</p>
            <h2 className="mt-1 text-lg font-semibold tracking-normal">Profile-scoped MCP</h2>
            <div className="mt-4 grid gap-2">
              <Fact label="Read projection" value={capabilities.ok ? "ready" : "unavailable"} />
              <Fact label="Manage connections" value="/app/settings#mcp" />
              <Fact label="Studio/Enterprise" value="profile tier gated" />
            </div>
          </Card>

          <Card className="p-4">
            <p className="text-sm font-medium text-(--muted)">Audit</p>
            <div className="mt-4 grid gap-2 text-sm">
              <Fact label="Input storage" value="redacted summaries" />
              <Fact label="Confirmation" value="required for admin actions" />
              <Fact label="Admin tools" value="staff membership required" />
            </div>
          </Card>
        </aside>
      </section>
    </AppShell>
  );
}

function CapabilityList({ capabilities }: { capabilities: ApiResult<AiCapabilities> }) {
  if (!capabilities.ok) {
    return <ErrorState result={capabilities} title="Assistant capabilities unavailable" context="Assistant capabilities" />;
  }

  return (
    <div className="grid gap-3">
      {capabilities.data.items.map((capability) => (
        <Card className="p-4" key={capability.scope}>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="font-medium">{capability.scope}</p>
              <p className="mt-1 text-sm text-(--muted)">
                {capability.allowedTools.length} backend-authorized tools
              </p>
            </div>
            <StatusPill tone={capability.canStartSession ? "good" : "warn"}>
              {capability.canStartSession ? "available" : "blocked"}
            </StatusPill>
          </div>
          <div className="mt-4 grid gap-2 text-sm sm:grid-cols-3">
            <Fact label="Tools" value={capability.allowedTools.join(", ") || "none"} />
            <Fact label="Confirmation" value={capability.confirmationRequiredTools.join(", ") || "not required"} />
            <Fact label="Connection" value="profile/admin scoped" />
          </div>
        </Card>
      ))}
    </div>
  );
}
