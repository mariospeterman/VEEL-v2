import { getMyContent, getMyCreatorDashboard, type CreatorDashboard } from "@/api-client";
import { requireAppAccess } from "@/supabase/route-guard";
import { AppShell } from "../../app-shell";
import { ErrorState } from "../../ui";
import { ProfileLogoutButton } from "./profile-logout-button";
import { ProfileMediaGrid } from "./profile-media-grid";

export const dynamic = "force-dynamic";

export default async function ProfilePage() {
  await requireAppAccess("/app/profile");
  const [dashboard, media] = await Promise.all([getMyCreatorDashboard(), getMyContent()]);

  return (
    <AppShell>
      <section className="mx-auto grid w-full max-w-5xl content-start gap-5">
        {dashboard.ok ? <ProfileHeader dashboard={dashboard.data} postCount={media.ok ? media.data.items.filter((item) => item.publicationState === "published" && item.distributionMode === "post").length : 0} /> : (
          <ErrorState result={dashboard} title="Profile unavailable" context="Profile" />
        )}

        <nav aria-label="Profile media" className="flex border-b border-(--line) text-sm font-semibold">
          <a className="min-h-12 flex-1 border-b-2 border-(--foreground) px-3 py-3 text-center" href="#posts">Posts</a>
          <a className="min-h-12 flex-1 px-3 py-3 text-center text-(--muted)" href="/app/bits">Bits</a>
          <a className="min-h-12 flex-1 px-3 py-3 text-center text-(--muted)" href="/app/moments">Moments</a>
          <a className="min-h-12 flex-1 px-3 py-3 text-center text-(--muted)" href="/app/create?mode=live">Live</a>
        </nav>

        <section id="posts">
          {media.ok ? <ProfileMediaGrid page={media.data} /> : (
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

function ProfileHeader({ dashboard, postCount }: { dashboard: CreatorDashboard; postCount: number }) {
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
        <div className="flex gap-6 text-sm"><ProfileStat label="posts" value={postCount} /><ProfileStat label="followers" value="—" /><ProfileStat label="following" value="—" /></div>
        <p className="max-w-2xl text-sm leading-6 text-(--text-soft)">Your public identity and media live here. Creator analytics, verification, pricing, and earnings stay in Studio.</p>
        <div className="flex flex-wrap gap-2"><a className="min-h-11 rounded-lg bg-(--foreground) px-4 py-2.5 text-sm font-semibold text-(--background)" href="/app/settings#profile">Edit profile</a><a className="min-h-11 rounded-lg border border-(--line) px-4 py-2.5 text-sm font-semibold" href="/app/studio">Open Studio</a></div>
      </div>
    </header>
  );
}

function ProfileStat({ label, value }: { label: string; value: number | string }) {
  return <span><strong className="block text-base text-(--foreground)">{value}</strong><span className="text-(--muted)">{label}</span></span>;
}

function ProfileLink({ description, href, label }: { description: string; href: string; label: string }) {
  return <a className="flex min-h-14 items-center justify-between rounded-lg px-3 py-2 hover:bg-(--background)" href={href}><span><span className="block text-sm font-semibold">{label}</span><span className="text-xs text-(--muted)">{description}</span></span><span aria-hidden="true">›</span></a>;
}
