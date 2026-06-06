import { appShellNavItems } from "@veel/ui";
import { getAiCapabilities, type AiCapabilities, type ApiResult } from "@/api-client";

export default async function AssistantPage() {
  const capabilities = await getAiCapabilities();

  return (
    <main className="min-h-screen bg-(--background) text-(--foreground)">
      <nav className="mx-auto flex w-full max-w-6xl items-center justify-between border-b border-(--line) px-5 py-4">
        <a className="text-lg font-semibold tracking-normal" href="/">
          VEEL
        </a>
        <div className="flex gap-1">
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

      <section className="mx-auto grid w-full max-w-6xl gap-5 px-5 py-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <section className="grid content-start gap-4">
          <div>
            <p className="text-sm font-medium text-(--accent)">AI/MCP</p>
            <h1 className="mt-1 text-2xl font-semibold tracking-normal">Scoped assistant</h1>
          </div>

          <CapabilityList capabilities={capabilities} />
        </section>

        <aside className="grid content-start gap-3">
          <div className="rounded border border-(--line) bg-(--panel) p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-medium text-(--muted)">Session</p>
                <h2 className="mt-1 text-lg font-semibold tracking-normal">explicit start only</h2>
              </div>
              <span className="rounded bg-(--accent-soft) px-2 py-1 text-xs font-semibold text-(--accent-strong)">
                explicit start
              </span>
            </div>
            <div className="mt-4 grid gap-2">
              <Fact label="Read projection" value={capabilities.ok ? "ready" : `HTTP ${capabilities.status}`} />
              <Fact label="Session mutation" value="POST /v1/ai/sessions" />
              <Fact label="Tool mutation" value="explicit idempotent action" />
            </div>
          </div>

          <div className="rounded border border-(--line) bg-(--panel) p-4">
            <p className="text-sm font-medium text-(--muted)">Audit</p>
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

function CapabilityList({ capabilities }: { capabilities: ApiResult<AiCapabilities> }) {
  if (!capabilities.ok) {
    return <UnavailableState result={capabilities} />;
  }

  return (
    <div className="grid gap-3">
      {capabilities.data.items.map((capability) => (
        <article className="rounded border border-(--line) bg-(--panel) p-4" key={capability.scope}>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="font-medium">{capability.scope}</p>
              <p className="mt-1 text-sm text-(--muted)">
                {capability.allowedTools.length} backend-authorized tools
              </p>
            </div>
            <span className="rounded bg-(--background) px-2 py-1 text-xs text-(--muted)">
              {capability.canStartSession ? "available" : "blocked"}
            </span>
          </div>
          <div className="mt-4 grid gap-2 text-sm sm:grid-cols-3">
            <Fact label="Tools" value={capability.allowedTools.join(", ")} />
            <Fact label="Confirmation" value={capability.confirmationRequiredTools.join(", ") || "not required"} />
            <Fact label="Session" value="explicit start" />
          </div>
        </article>
      ))}
    </div>
  );
}

function UnavailableState<T>({ result }: { result: Extract<ApiResult<T>, { ok: false }> }) {
  return (
    <div className="rounded border border-(--line) bg-(--panel) p-4">
      <p className="font-medium">Assistant API unavailable</p>
      <p className="mt-1 text-sm text-(--muted)">HTTP {result.status}</p>
      <p className="mt-1 text-sm text-(--muted)">{result.message}</p>
      <div className="mt-4 grid gap-2 text-sm sm:grid-cols-3">
        <Fact label="Session" value="explicit start only" />
        <Fact label="Tool calls" value="disabled until API ready" />
        <Fact label="Provider calls" value="disabled in launch slice" />
      </div>
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
