import { appShellNavItems } from "@veel/ui";

const statusItems = [
  "OpenAPI-first API boundary",
  "Server-owned business truth",
  "Provider integrations deferred to approved slices"
] as const;

export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-6xl flex-col px-5 py-6">
      <nav className="flex items-center justify-between border-b border-[var(--line)] pb-4">
        <span className="text-lg font-semibold tracking-normal">VEEL</span>
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

      <section className="grid flex-1 content-center gap-8 py-12 md:grid-cols-[1.1fr_0.9fr] md:items-center">
        <div>
          <p className="mb-3 text-sm font-medium text-[var(--accent)]">Foundation slice</p>
          <h1 className="max-w-3xl text-5xl font-semibold leading-tight tracking-normal md:text-7xl">
            VEEL v2 app shell
          </h1>
          <p className="mt-5 max-w-2xl text-base leading-7 text-[var(--muted)]">
            The PWA shell is wired to the shared packages and contract boundary. Product flows come
            next as vertical slices from the build plan.
          </p>
        </div>

        <div className="rounded border border-[var(--line)] bg-[var(--panel)] p-5">
          <h2 className="text-base font-semibold">Build boundary</h2>
          <ul className="mt-4 grid gap-3">
            {statusItems.map((item) => (
              <li className="rounded border border-[var(--line)] bg-[var(--background)] p-3 text-sm text-[var(--muted)]" key={item}>
                {item}
              </li>
            ))}
          </ul>
        </div>
      </section>
    </main>
  );
}
