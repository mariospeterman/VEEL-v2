import { appShellNavItems } from "@veel/ui";

const creatorTools = [
  {
    confirmation: "not_required",
    input: "creator-provided context",
    name: "draft_caption",
    output: "Caption draft prepared from creator-provided context",
    resource: "content",
    state: "available"
  },
  {
    confirmation: "not_required",
    input: "creator-provided event details",
    name: "prepare_event_copy",
    output: "Event copy draft prepared for creator review",
    resource: "event",
    state: "available"
  }
];

const adminTools = [
  {
    confirmation: "required",
    input: "safe payment/support context",
    name: "prepare_refund_decision",
    output: "Prepared decision only; no refund mutation without explicit admin confirmation",
    resource: "payment",
    state: "confirmation_required"
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
            {[...creatorTools, ...adminTools].map((tool) => (
              <ToolCard key={tool.name} tool={tool} />
            ))}
          </div>
        </section>

        <aside className="grid content-start gap-3">
          <div className="rounded border border-[var(--line)] bg-[var(--panel)] p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-medium text-[var(--muted)]">Session</p>
                <h2 className="mt-1 text-lg font-semibold tracking-normal">creator_helper</h2>
              </div>
              <span className="rounded bg-[var(--accent-soft)] px-2 py-1 text-xs font-semibold text-[var(--accent-strong)]">
                explicit start
              </span>
            </div>
            <div className="mt-4 grid gap-2">
              {creatorTools.map((tool) => (
                <span
                  className="rounded border border-[var(--line)] bg-[var(--background)] px-3 py-2 text-sm"
                  key={tool.name}
                >
                  {tool.name}
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

function ToolCard({
  tool
}: {
  tool: {
    confirmation: string;
    input: string;
    name: string;
    output: string;
    resource: string;
    state: string;
  };
}) {
  return (
    <article className="rounded border border-[var(--line)] bg-[var(--panel)] p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-medium">{tool.name}</p>
          <p className="mt-1 text-sm text-[var(--muted)]">{tool.output}</p>
        </div>
        <span className="rounded bg-[var(--background)] px-2 py-1 text-xs text-[var(--muted)]">
          {tool.confirmation}
        </span>
      </div>
      <div className="mt-4 grid gap-2 text-sm sm:grid-cols-3">
        <Fact label="State" value={tool.state} />
        <Fact label="Input" value={tool.input} />
        <Fact label="Resource" value={tool.resource} />
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
