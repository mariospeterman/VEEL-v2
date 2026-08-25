import { getPlatformAccess, getVerificationStatus } from "@/api-client";
import { requireAppAccess } from "@/supabase/route-guard";
import { AppShell } from "../../app-shell";
import { UniversalComposer } from "../../create/universal-composer";

export const dynamic = "force-dynamic";

export default async function CreatePage({ searchParams }: { searchParams: Promise<{ distribution?: string; mode?: string }> }) {
  const session = await requireAppAccess("/app/create");
  const params = await searchParams;
  const [verification, platformAccess] = await Promise.all([getVerificationStatus(), getPlatformAccess()]);
  const canUpload = verification.ok && verification.data.capabilities.canUploadMedia === true;
  const verificationData = verification.ok ? verification.data : null;
  const canSchedule = platformAccess.ok && platformAccess.data.currentTier.capabilities.includes("scheduling");

  return (
    <AppShell>
      <section className="mx-auto grid w-full max-w-3xl content-start gap-5">
          <h1 className="text-2xl font-semibold tracking-tight">Create</h1>

          {canUpload ? (
            <UniversalComposer
              initialDistributionMode={params.distribution === "moment" ? "moment" : "post"}
              initialFormat={params.mode === "live" ? "live" : params.distribution === "moment" ? "media" : null}
              canSchedule={canSchedule}
              storageScope={session?.user?.id ?? null}
              verification={verificationData}
            />
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
