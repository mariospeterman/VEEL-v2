import { requireAppAccess } from "@/supabase/route-guard";
import { AppShell } from "../../app-shell";
import { Card, Fact, PageHeader, StatusPill } from "../../ui";
import { CreateWorkspace } from "../../create/create-workspace";

export const dynamic = "force-dynamic";

const steps = [
  { label: "Draft", state: "server-owned", detail: "POST /v1/content" },
  { label: "Upload", state: "provider-ready", detail: "Bunny TUS session" },
  { label: "Provider sync", state: "backend-truth", detail: "POST /v1/media/assets/:id/sync" },
  { label: "Policy", state: "required", detail: "age and moderation gates" },
  { label: "Publish", state: "explicit", detail: "creator confirmation" }
];

export default async function CreatePage() {
  await requireAppAccess("/app/create");

  return (
    <AppShell>
      <section className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <section className="grid content-start gap-5">
          <PageHeader eyebrow="Create" title="Upload workspace">
              Create starts with a backend-owned draft, then the browser uploads directly to Bunny
              TUS with safe session headers. Publish remains an explicit creator action.
          </PageHeader>

          <section className="grid gap-3">
            <CreateWorkspace />
            {steps.map((step) => (
              <Card className="p-4" key={step.label}>
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="font-medium">{step.label}</p>
                    <p className="mt-1 text-sm text-(--muted)">{step.detail}</p>
                  </div>
                  <StatusPill>{step.state}</StatusPill>
                </div>
              </Card>
            ))}
          </section>
        </section>

        <aside className="grid content-start gap-3">
          <Card className="p-4">
            <p className="text-sm font-medium">Draft settings</p>
            <div className="mt-4 grid gap-3 text-sm">
              <Fact label="Media" value="chosen by creator" />
              <Fact label="Visibility" value="backend validated" />
              <Fact label="Label" value="age and moderation required" />
              <Fact label="Caption" value="draft text only until submitted" />
            </div>
          </Card>

          <Card className="p-4">
            <p className="text-sm font-medium">Upload session</p>
            <div className="mt-4 grid gap-3 text-sm">
              <Fact label="Provider" value="Bunny" />
              <Fact label="Upload" value="Bunny TUS" />
              <Fact label="Headers" value="safe session headers only" />
              <Fact label="Expires" value="server issued per explicit action" />
            </div>
          </Card>
        </aside>
      </section>
    </AppShell>
  );
}
