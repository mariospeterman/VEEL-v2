import type { components } from "@veel/contracts";
import { appShellNavItems } from "@veel/ui";

type CreateContentRequest = components["schemas"]["CreateContentRequest"];
type UploadSession = components["schemas"]["UploadSession"];

const draft: CreateContentRequest = {
  mediaType: "vod",
  caption: "Studio lighting test with subscriber-ready full playback.",
  visibility: "public",
  nsfwLabel: "adult"
};

const uploadSession: UploadSession = {
  uploadUrl: "https://video.bunnycdn.com/tusupload",
  provider: "bunny",
  headers: {
    "Tus-Resumable": "1.0.0",
    AuthorizationSignature: "server-generated",
    AuthorizationExpire: "upload-session-expiry",
    VideoId: "bunny-video-guid",
    LibraryId: "library-id"
  },
  expiresAt: "2026-06-06T00:00:00.000Z"
};

const steps = [
  { label: "Draft", state: "server-owned", detail: "POST /v1/content" },
  { label: "Upload", state: "provider-ready", detail: "Bunny TUS session" },
  { label: "Policy", state: "required", detail: "age and moderation gates" },
  { label: "Publish", state: "explicit", detail: "creator confirmation" }
];

export default function CreatePage() {
  return (
    <main className="min-h-screen bg-[var(--background)] text-[var(--foreground)]">
      <AppNav />

      <section className="mx-auto grid w-full max-w-6xl gap-6 px-5 py-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <section className="grid content-start gap-5">
          <div>
            <p className="text-sm font-medium text-[var(--accent)]">Create</p>
            <h1 className="mt-1 text-2xl font-semibold tracking-normal">Upload workspace</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--muted)]">
              Create starts with a backend-owned draft, then the browser uploads directly to Bunny
              TUS with safe session headers. Publish remains an explicit creator action.
            </p>
          </div>

          <section className="grid gap-3">
            {steps.map((step) => (
              <article className="rounded border border-[var(--line)] bg-[var(--panel)] p-4" key={step.label}>
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="font-medium">{step.label}</p>
                    <p className="mt-1 text-sm text-[var(--muted)]">{step.detail}</p>
                  </div>
                  <span className="rounded bg-[var(--background)] px-2 py-1 text-xs text-[var(--muted)]">
                    {step.state}
                  </span>
                </div>
              </article>
            ))}
          </section>
        </section>

        <aside className="grid content-start gap-3">
          <section className="rounded border border-[var(--line)] bg-[var(--panel)] p-4">
            <p className="text-sm font-medium">Draft settings</p>
            <div className="mt-4 grid gap-3 text-sm">
              <Fact label="Media" value={draft.mediaType} />
              <Fact label="Visibility" value={draft.visibility} />
              <Fact label="Label" value={draft.nsfwLabel} />
              <Fact label="Caption" value={draft.caption ?? "empty"} />
            </div>
          </section>

          <section className="rounded border border-[var(--line)] bg-[var(--panel)] p-4">
            <p className="text-sm font-medium">Upload session</p>
            <div className="mt-4 grid gap-3 text-sm">
              <Fact label="Provider" value={uploadSession.provider} />
              <Fact label="Upload" value="Bunny TUS" />
              <Fact label="Headers" value="safe session headers only" />
              <Fact label="Expires" value={uploadSession.expiresAt} />
            </div>
          </section>
        </aside>
      </section>
    </main>
  );
}

function AppNav() {
  return (
    <nav className="mx-auto flex w-full max-w-6xl items-center justify-between border-b border-[var(--line)] px-5 py-4">
      <a className="text-lg font-semibold tracking-normal" href="/">
        VEEL
      </a>
      <div className="flex flex-wrap justify-end gap-1">
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
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs uppercase text-[var(--muted)]">{label}</p>
      <p className="mt-1 break-words font-medium">{value}</p>
    </div>
  );
}
