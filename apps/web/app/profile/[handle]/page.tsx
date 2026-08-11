import { appShellNavItems } from "@veel/ui";
import { getCreatorProfile, type CreatorProfile } from "@/api-client";
import { ErrorState } from "../../ui";
import { CreatorSupportPanel } from "./creator-support-panel";

export default async function PublicCreatorProfilePage({
  params
}: {
  params: Promise<{ handle: string }>;
}) {
  const { handle } = await params;
  const profileResult = await getCreatorProfile(handle);

  return (
    <main className="min-h-screen bg-(--background) text-(--foreground)">
      <AppNav />

      {profileResult.ok ? (
        <ProfileView profile={profileResult.data} />
      ) : (
        <section className="mx-auto grid w-full max-w-6xl content-center px-5 py-6">
          <ErrorState
            context="Creator profile"
            result={profileResult}
            title={profileResult.status === 404 ? "Creator profile not found" : "Creator profile unavailable"}
          />
        </section>
      )}
    </main>
  );
}

function AppNav() {
  return (
    <nav className="mx-auto flex w-full max-w-6xl items-center justify-between border-b border-(--line) px-5 py-4">
      <a className="text-lg font-semibold tracking-normal" href="/">
        WeVid
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
  );
}

function ProfileView({ profile }: { profile: CreatorProfile }) {
  return (
    <section className="mx-auto grid w-full max-w-6xl gap-6 px-5 py-6 lg:grid-cols-[320px_minmax(0,1fr)]">
      <aside className="grid content-start gap-4">
        <div>
          <p className="text-sm font-medium text-(--accent)">Creator profile</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-normal">{profile.user.displayName}</h1>
          <p className="mt-1 text-sm text-(--muted)">@{profile.user.handle}</p>
        </div>
        {profile.bio ? <p className="text-sm leading-6">{profile.bio}</p> : null}
        <div className="grid grid-cols-2 gap-3 text-sm">
          <Stat label="Content" value={profile.stats.contentCount} />
          <Stat label="Live rooms" value={profile.stats.liveRoomCount} />
          <Stat label="Payments" value={profile.stats.confirmedPaymentCount} />
          <Stat label="Followers" value={profile.stats.followerCount} />
        </div>
        <CreatorSupportPanel profile={profile} />
      </aside>

      <section className="grid content-start gap-4">
        <div className="flex items-center justify-between gap-4 border-b border-(--line) pb-3">
          <h2 className="text-base font-semibold tracking-normal">Media</h2>
          <span className="rounded bg-(--accent-soft) px-2 py-1 text-xs text-(--accent-strong)">
            support {profile.monetisation.supportEnabled ? "enabled" : "disabled"}
          </span>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          {profile.recentContent.map((item) => (
            <article className="overflow-hidden rounded border border-(--line) bg-(--panel)" key={item.id}>
              <div className="aspect-[4/5] bg-[#111827]">
                {item.posterUrl ? <img alt="" className="h-full w-full object-cover" src={item.posterUrl} /> : null}
              </div>
              <div className="p-4">
                <p className="font-medium">{item.caption}</p>
                <p className="mt-1 text-sm text-(--muted)">{item.accessState}</p>
              </div>
            </article>
          ))}
        </div>
      </section>
    </section>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded border border-(--line) bg-(--panel) p-3">
      <p className="text-xs uppercase text-(--muted)">{label}</p>
      <p className="mt-1 font-semibold">{value.toLocaleString()}</p>
    </div>
  );
}
