import { getCreatorProfile, getMyContent, getMyCreatorDashboard, type CreatorDashboard, type CreatorProfile } from "@/api-client";
import { requireAppAccess } from "@/supabase/route-guard";
import { AppShell } from "../../app-shell";
import { ErrorState } from "../../ui";
import { ProfileLogoutButton } from "./profile-logout-button";
import { ProfileMediaGrid, type ProfileMediaFilter } from "./profile-media-grid";

export const dynamic = "force-dynamic";

export default async function ProfilePage({
  searchParams
}: {
  searchParams?: Promise<{ media?: string }>;
}) {
  await requireAppAccess("/app/profile");
  const params = await searchParams;
  const mediaFilter: ProfileMediaFilter = params?.media === "bits" || params?.media === "moments"
    ? params.media
    : "posts";
  const [dashboard, media] = await Promise.all([getMyCreatorDashboard(), getMyContent()]);
  const publicProfile = dashboard.ok ? await getCreatorProfile(dashboard.data.creator.handle) : null;

  return (
    <AppShell>
      <section className="mx-auto grid w-full max-w-5xl content-start gap-5">
        {dashboard.ok ? <ProfileHeader dashboard={dashboard.data} stats={publicProfile?.ok ? publicProfile.data.stats : null} /> : (
          <ErrorState result={dashboard} title="Profile unavailable" context="Profile" />
        )}

        <nav aria-label="Your profile media" className="flex border-b border-(--line) text-sm font-semibold">
          <MediaTab active={mediaFilter === "posts"} filter="posts" label="Posts" />
          <MediaTab active={mediaFilter === "bits"} filter="bits" label="Bits" />
          <MediaTab active={mediaFilter === "moments"} filter="moments" label="Moments" />
          <a className="min-h-12 flex-1 px-3 py-3 text-center text-(--muted)" href="/app/create?mode=live">Live</a>
        </nav>

        <section id="media">
          {media.ok ? <ProfileMediaGrid filter={mediaFilter} key={mediaFilter} page={media.data} /> : (
            <ErrorState result={media} title="Your posts are unavailable" context="Profile posts" />
          )}
        </section>

        <details className="group rounded-xl border border-(--line) bg-(--panel)">
          <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between px-4 py-3 text-sm font-semibold">Account menu<span aria-hidden="true">⌄</span></summary>
          <div className="grid gap-2 border-t border-(--line) p-3 sm:grid-cols-2">
            <ProfileLink description="Analytics, content and monetisation" href="/app/studio" label="Creator Studio" />
            <ProfileLink description="Organizations and managed creators" href="/app/enterprise" label="Enterprise" />
            <ProfileLink description="Privacy, notifications and account" href="/app/settings" label="Settings" />
            <ProfileLink description="Plans and creator memberships" href="/app/subscriptions" label="Subscriptions" />
            <div className="sm:col-span-2"><ProfileLogoutButton /></div>
          </div>
        </details>
      </section>
    </AppShell>
  );
}

function ProfileHeader({ dashboard, stats }: { dashboard: CreatorDashboard; stats: CreatorProfile["stats"] | null }) {
  const initials = dashboard.creator.displayName.slice(0, 2).toUpperCase();
  return (
    <header className="grid gap-5 pt-2 sm:grid-cols-[128px_minmax(0,1fr)] sm:items-center">
      <div className="flex items-center gap-4 sm:block">
        <div aria-label={`${dashboard.creator.displayName} profile image`} className="grid size-24 shrink-0 place-items-center overflow-hidden rounded-full bg-[linear-gradient(135deg,var(--brand-purple),var(--brand-cyan))] text-2xl font-bold text-white sm:size-32">
          {dashboard.creator.avatarUrl ? <img alt="" className="size-full object-cover" src={dashboard.creator.avatarUrl} /> : initials}
        </div>
        <div className="sm:hidden"><h1 className="text-xl font-semibold">{dashboard.creator.displayName}</h1><p className="text-sm text-(--muted)">@{dashboard.creator.handle}</p></div>
      </div>
      <div className="grid gap-4">
        <div className="hidden sm:block"><h1 className="text-2xl font-semibold tracking-tight">{dashboard.creator.displayName}</h1><p className="text-sm text-(--muted)">@{dashboard.creator.handle}</p></div>
        <div className="flex gap-6 text-sm"><ProfileStat label="content" value={stats?.contentCount ?? "Unavailable"} /><ProfileStat label="followers" value={stats?.followerCount ?? "Unavailable"} /><ProfileStat label="following" value={stats?.followingCount ?? "Unavailable"} /></div>
        <p className="max-w-2xl text-sm leading-6 text-(--text-soft)">Your public identity and media live here. Creator analytics, verification, pricing, and earnings stay in Studio.</p>
        <div className="flex flex-wrap gap-2"><a className="min-h-11 rounded-lg bg-(--foreground) px-4 py-2.5 text-sm font-semibold text-(--background)" href="/app/settings#profile">Edit profile</a><a className="min-h-11 rounded-lg border border-(--line) px-4 py-2.5 text-sm font-semibold" href="/app/studio">Open Studio</a></div>
      </div>
    </header>
  );
}

function MediaTab({ active, filter, label }: { active: boolean; filter: ProfileMediaFilter; label: string }) {
  return (
    <a
      aria-current={active ? "page" : undefined}
      className={`min-h-12 flex-1 px-3 py-3 text-center ${active ? "border-b-2 border-(--foreground)" : "text-(--muted)"}`}
      href={`/app/profile?media=${filter}#media`}
    >
      {label}
    </a>
  );
}

function ProfileStat({ label, value }: { label: string; value: number | string }) {
  return <span><strong className="block text-base text-(--foreground)">{value}</strong><span className="text-(--muted)">{label}</span></span>;
}

function ProfileLink({ description, href, label }: { description: string; href: string; label: string }) {
  return <a className="flex min-h-14 items-center justify-between rounded-lg px-3 py-2 hover:bg-(--background)" href={href}><span><span className="block text-sm font-semibold">{label}</span><span className="text-xs text-(--muted)">{description}</span></span><span aria-hidden="true">›</span></a>;
}
