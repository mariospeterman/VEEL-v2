import type { components } from "@veel/contracts";
import { appShellNavItems } from "@veel/ui";

type AiSession = components["schemas"]["AiSession"];
type AiToolCall = components["schemas"]["AiToolCall"];

const session: AiSession = {
  id: "00000000-0000-4000-8000-0000000000a1",
  scope: "creator_helper",
  state: "active",
  allowedTools: ["draft_caption", "suggest_hashtags", "prepare_event_copy", "summarize_creator_metrics"],
  createdAt: "2026-06-04T20:00:00.000Z",
  expiresAt: "2026-06-04T20:30:00.000Z"
};

const calls: AiToolCall[] = [
  {
    id: "00000000-0000-4000-8000-0000000000a2",
    sessionId: session.id,
    toolName: "draft_caption",
    state: "executed",
    confirmationState: "not_required",
    inputSummary: "Structured input keys: contentType, tone",
    outputSummary: "Caption draft prepared from creator-provided context",
    result: {
      draft: "New drop is live. Tap in for the full set and save your favorites."
    },
    affectedResource: {
      type: "content",
      id: "00000000-0000-4000-8000-000000000040"
    },
    createdAt: "2026-06-04T20:01:00.000Z"
  },
  {
    id: "00000000-0000-4000-8000-0000000000a3",
    sessionId: session.id,
    toolName: "prepare_refund_decision",
    state: "prepared",
    confirmationState: "required",
    inputSummary: "Structured input keys: resourceId, resourceType",
    outputSummary: "prepare_refund_decision prepared and awaiting explicit admin confirmation",
    result: {
      status: "confirmation_required"
    },
    affectedResource: {
      type: "payment",
      id: "00000000-0000-4000-8000-000000000050"
    },
    createdAt: "2026-06-04T20:02:00.000Z"
  }
];

export default function AssistantPage() {
  return (
    <main className="min-h-screen bg-[var(--background)] text-[var(--foreground)]">
      <nav className="mx-auto flex w-full max-w-6xl items-center justify-between border-b border-[var(--line)] px-5 py-4">
        <a className="text-lg font-semibold tracking-normal" href="/">
          VEEL
        </a>
        <div className="flex gap-1">
          {appShellNavItems.map((item) => (
            <a
              className="rounded px-3 py-2 text-sm text-[var(--muted)] transition hover:bg-[var(--panel)] hover:text-[var(--foreground)]"
              href={item.href}
              key={item.href}
            >
              {item.label}
            </a>
          ))}
        </div>
      </nav>

      <section className="mx-auto grid w-full max-w-6xl gap-5 px-5 py-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <section className="grid content-start gap-4">
          <div>
            <p className="text-sm font-medium text-[var(--accent)]">AI/MCP</p>
            <h1 className="mt-1 text-2xl font-semibold tracking-normal">Scoped assistant</h1>
          </div>

          <div className="grid gap-3">
            {calls.map((call) => (
              <ToolCallCard call={call} key={call.id} />
            ))}
          </div>
        </section>

        <aside className="grid content-start gap-3">
          <div className="rounded border border-[var(--line)] bg-[var(--panel)] p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-medium text-[var(--muted)]">Session</p>
                <h2 className="mt-1 text-lg font-semibold tracking-normal">{session.scope}</h2>
              </div>
              <span className="rounded bg-[var(--accent-soft)] px-2 py-1 text-xs font-semibold text-[var(--accent-strong)]">
                {session.state}
              </span>
            </div>
            <div className="mt-4 grid gap-2">
              {session.allowedTools.map((tool) => (
                <span
                  className="rounded border border-[var(--line)] bg-[var(--background)] px-3 py-2 text-sm"
                  key={tool}
                >
                  {tool}
                </span>
              ))}
            </div>
          </div>

          <div className="rounded border border-[var(--line)] bg-[var(--panel)] p-4">
            <p className="text-sm font-medium text-[var(--muted)]">Audit</p>
            <div className="mt-4 grid gap-2 text-sm">
              <Fact label="Input storage" value="redacted summaries" />
              <Fact label="Confirmation" value="required for admin actions" />
              <Fact label="Provider calls" value="disabled in launch slice" />
            </div>
          </div>
        </aside>
      </section>
    </main>
  );
}

function ToolCallCard({ call }: { call: AiToolCall }) {
  return (
    <article className="rounded border border-[var(--line)] bg-[var(--panel)] p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-medium">{call.toolName}</p>
          <p className="mt-1 text-sm text-[var(--muted)]">{call.outputSummary}</p>
        </div>
        <span className="rounded bg-[var(--background)] px-2 py-1 text-xs text-[var(--muted)]">
          {call.confirmationState}
        </span>
      </div>
      <div className="mt-4 grid gap-2 text-sm sm:grid-cols-3">
        <Fact label="State" value={call.state} />
        <Fact label="Input" value={call.inputSummary} />
        <Fact label="Resource" value={call.affectedResource?.type ?? "none"} />
      </div>
    </article>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <p className="text-xs uppercase text-[var(--muted)]">{label}</p>
      <p className="mt-1 truncate font-medium">{value}</p>
    </div>
  );
}
