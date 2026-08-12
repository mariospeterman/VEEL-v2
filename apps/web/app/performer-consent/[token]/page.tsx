import { getPerformerInvitation } from "@/api-client";
import { PerformerConsentActions } from "./performer-consent-actions";

export const dynamic = "force-dynamic";

export default async function PerformerConsentPage({ params }: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const invitation = await getPerformerInvitation(token);

  return (
    <main className="min-h-dvh bg-(--background) px-4 py-10 text-(--foreground) sm:py-16">
      <section className="mx-auto grid w-full max-w-lg gap-5">
        <header>
          <p className="text-xs uppercase text-(--muted)">WeVid performer release</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-normal">Review this exact use.</h1>
        </header>

        {invitation.ok ? (
          <>
            <section className="rounded border border-(--line) bg-(--panel) p-4">
              <dl className="grid gap-4 text-sm">
                <Scope label="Content" value={invitation.data.contentCaption ?? "Untitled content"} />
                <Scope label="Media" value={`${invitation.data.mediaType} / ${invitation.data.rating}`} />
                <Scope label="Revision" value={String(invitation.data.contentRevision)} />
                <Scope label="Allowed uses" value={invitation.data.allowedUses.join(", ")} />
                <Scope label="Verification" value={invitation.data.verificationState} />
              </dl>
            </section>
            <p className="text-sm leading-6 text-(--muted)">
              Verification confirms identity and age only. Consent applies only to the content
              revision and uses listed above. No WeVid account is required.
            </p>
            <PerformerConsentActions invitation={invitation.data} token={token} />
          </>
        ) : (
          <section className="rounded border border-(--line) bg-(--panel) p-4">
            <h2 className="text-sm font-semibold">Invitation unavailable</h2>
            <p className="mt-2 text-sm text-(--muted)">{invitation.message}</p>
          </section>
        )}
      </section>
    </main>
  );
}

function Scope({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid gap-1">
      <dt className="text-xs uppercase text-(--muted)">{label}</dt>
      <dd className="break-words">{value}</dd>
    </div>
  );
}
