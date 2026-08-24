import {
  getAiCapabilities,
  getMcpTools,
  type AiCapabilities,
  type ApiResult,
  type McpToolList
} from "@/api-client";
import { mcpToolLabel } from "@/mcp-display";
import { requireAppAccess } from "@/supabase/route-guard";
import { AppShell } from "../../app-shell";
import { Card, ErrorState, Fact, PageHeader, StatusPill } from "../../ui";

export const dynamic = "force-dynamic";

export default async function AssistantPage() {
  await requireAppAccess("/app/assistant");

  const [capabilities, tools] = await Promise.all([getAiCapabilities(), getMcpTools()]);

  return (
    <AppShell>
      <PageHeader action={<StatusPill>No model keys stored</StatusPill>} eyebrow="Connected assistants" title="Your assistant, your choice">
        Connect a supported assistant to a narrow set of WeVid capabilities. Your assistant brings its own AI; WeVid never stores your model keys.
      </PageHeader>

      <section className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
        <ToolList tools={tools} />

        <aside className="grid content-start gap-3">
          <Card className="p-4">
            <p className="text-sm font-medium text-(--muted)">You stay in control</p>
            <h2 className="mt-1 text-lg font-semibold tracking-normal">Review in WeVid</h2>
            <p className="mt-2 text-sm text-(--muted)">
              An assistant can prepare an SFW private draft, but it cannot publish, pay, sign a wallet transaction, message someone, or change moderation decisions.
            </p>
            <div className="mt-4 grid gap-2">
              <Fact label="Draft visibility" value="Private only" />
              <Fact label="Publishing" value="You do it in WeVid" />
              <Fact label="Access" value="Permission by permission" />
            </div>
          </Card>

          <ReadinessCard capabilities={capabilities} />

          <Card className="p-4">
            <p className="text-sm font-medium text-(--muted)">Connections</p>
            <p className="mt-2 text-sm text-(--muted)">
              Approve a connector only when you started the connection. You can review or revoke it at any time.
            </p>
            <a className="mt-4 inline-flex rounded border border-(--line) px-3 py-2 text-sm font-medium" href="/app/settings#mcp">
              Manage connected assistants
            </a>
          </Card>
        </aside>
      </section>
    </AppShell>
  );
}

function ToolList({ tools }: { tools: ApiResult<McpToolList> }) {
  if (!tools.ok) {
    return <ErrorState result={tools} title="Assistant capabilities unavailable" context="Connected assistant capabilities" />;
  }

  return (
    <div className="grid gap-3">
      <Card className="p-4">
        <p className="text-sm font-medium text-(--muted)">Available with your account</p>
        <h2 className="mt-1 text-xl font-semibold tracking-normal">Safe, bounded capabilities</h2>
        <p className="mt-2 text-sm text-(--muted)">
          Every request is authorized against your WeVid account and written to a redacted audit trail.
        </p>
      </Card>

      {tools.data.items.map((tool) => {
        const copy = mcpToolLabel(tool.name);
        return (
          <Card className="p-4" key={tool.name}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <h3 className="font-medium">{copy.title}</h3>
                <p className="mt-1 max-w-2xl text-sm text-(--muted)">{copy.description}</p>
              </div>
              <StatusPill tone={tool.annotations.readOnlyHint ? "neutral" : "warn"}>
                {tool.annotations.readOnlyHint ? "Read only" : "Private draft only"}
              </StatusPill>
            </div>
          </Card>
        );
      })}
    </div>
  );
}

function ReadinessCard({ capabilities }: { capabilities: ApiResult<AiCapabilities> }) {
  const ready = capabilities.ok && capabilities.data.items.some((capability) => capability.canStartSession);
  return (
    <Card className="p-4">
      <p className="text-sm font-medium text-(--muted)">Account readiness</p>
      <div className="mt-3 flex items-center justify-between gap-3">
        <p className="text-sm">Connected assistant access</p>
        <StatusPill tone={ready ? "good" : "warn"}>{ready ? "Ready" : "Setup needed"}</StatusPill>
      </div>
      <p className="mt-3 text-sm text-(--muted)">
        Creator access requires an active profile, age verification, and a ready wallet before permissions can be approved.
      </p>
    </Card>
  );
}
