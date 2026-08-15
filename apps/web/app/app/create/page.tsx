import { getVerificationStatus } from "@/api-client";
import { requireAppAccess } from "@/supabase/route-guard";
import { AppShell } from "../../app-shell";
import { PageHeader } from "../../ui";
import { CreateWorkspace } from "../../create/create-workspace";

export const dynamic = "force-dynamic";

export default async function CreatePage() {
  const session = await requireAppAccess("/app/create");
  const verification = await getVerificationStatus();
  const canUpload = verification.ok && verification.data.capabilities.canUploadMedia === true;
  const verificationData = verification.ok ? verification.data : null;

  return (
    <AppShell>
      <section className="mx-auto grid w-full max-w-3xl content-start gap-5">
          <PageHeader eyebrow="Create" title="New post">
            Preview, upload, and follow review from one place.
          </PageHeader>

          {canUpload ? (
            <CreateWorkspace storageScope={session?.user?.id ?? null} verification={verificationData} />
          ) : (
            <section className="rounded border border-(--line) bg-(--panel) p-5">
              <h2 className="font-semibold">Finish age access to post</h2>
              <p className="mt-2 text-sm leading-6 text-(--muted)">Safe-for-work posting does not require earnings setup or creator KYC.</p>
              <a className="mt-4 inline-flex min-h-11 items-center rounded bg-(--foreground) px-4 py-2 text-sm font-semibold text-(--background)" href="/app/age">Continue</a>
            </section>
          )}
      </section>
    </AppShell>
  );
}
