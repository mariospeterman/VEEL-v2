import { getVerificationStatus } from "@/api-client";
import { requireAppAccess } from "@/supabase/route-guard";
import { AppShell } from "../../app-shell";
import { PageHeader } from "../../ui";
import { CreateWorkspace } from "../../create/create-workspace";

export const dynamic = "force-dynamic";

export default async function CreatePage() {
  await requireAppAccess("/app/create");
  const verification = await getVerificationStatus();
  const canUpload = verification.ok && verification.data.capabilities.canUploadMedia === true;
  const verificationData = verification.ok ? verification.data : null;

  return (
    <AppShell>
      <section className="mx-auto grid w-full max-w-3xl content-start gap-5">
          <PageHeader eyebrow="Create" title="New post">
            Add your media, choose who can see it, then submit it for review.
          </PageHeader>

          {canUpload ? <CreateWorkspace verification={verificationData} /> : null}
      </section>
    </AppShell>
  );
}
