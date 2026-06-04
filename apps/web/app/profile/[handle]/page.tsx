import type { components } from "@veel/contracts";
import { appShellNavItems } from "@veel/ui";

type CreatorProfile = components["schemas"]["CreatorProfile"];

const profile: CreatorProfile = {
  user: {
    id: "00000000-0000-4000-8000-000000000010",
    handle: "maki",
    displayName: "Maki",
    avatarUrl: null,
    badges: []
  },
  bio: "Building the first Veel v2 creator profile with backend-owned monetisation truth.",
  locationLabel: "Belgrade",
  stats: {
    contentCount: 2,
    liveRoomCount: 1,
    confirmedPaymentCount: 3,
    followerCount: 0
  },
  monetisation: {
    tipsEnabled: true,
    contentUnlocksEnabled: true,
    livePassesEnabled: true,
    paidMessagesEnabled: true,
    subscriptionsEnabled: false
  },
  recentContent: [
    {
      id: "00000000-0000-4000-8000-000000000040",
      creator: {
        id: "00000000-0000-4000-8000-000000000010",
        handle: "maki",
        displayName: "Maki",
        avatarUrl: null,
        badges: []
      },
      mediaType: "image",
      caption: "Studio lighting test",
      posterUrl: "https://picsum.photos/seed/veel-profile/900/1200",
      playback: {
        state: "not_ready",
        url: null,
        provider: "none"
      },
      accessState: "free",
      nsfwLabel: "none",
      engagement: {
        liked: false,
        saved: false,
        likeCount: 0,
        commentCount: 0,
        shareCount: 0
      }
    }
  ]
};

export default function PublicCreatorProfilePage() {
  return (
    <main className="min-h-screen bg-[var(--background)] text-[var(--foreground)]">
      <nav className="mx-auto flex w-full max-w-6xl items-center justify-between border-b border-[var(--line)] px-5 py-4">
        <a className="text-lg font-semibold tracking-normal" href="/">
          VEEL
        </a>
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

      <section className="mx-auto grid w-full max-w-6xl gap-6 px-5 py-6 lg:grid-cols-[320px_minmax(0,1fr)]">
        <aside className="grid content-start gap-4">
          <div>
            <p className="text-sm font-medium text-[var(--accent)]">Creator profile</p>
            <h1 className="mt-1 text-2xl font-semibold tracking-normal">{profile.user.displayName}</h1>
            <p className="mt-1 text-sm text-[var(--muted)]">@{profile.user.handle}</p>
          </div>
          {profile.bio ? <p className="text-sm leading-6">{profile.bio}</p> : null}
          <div className="grid grid-cols-2 gap-3 text-sm">
            <Stat label="Content" value={profile.stats.contentCount} />
            <Stat label="Live rooms" value={profile.stats.liveRoomCount} />
            <Stat label="Payments" value={profile.stats.confirmedPaymentCount} />
            <Stat label="Followers" value={profile.stats.followerCount} />
          </div>
        </aside>

        <section className="grid content-start gap-4">
          <div className="flex items-center justify-between gap-4 border-b border-[var(--line)] pb-3">
            <h2 className="text-base font-semibold tracking-normal">Media</h2>
            <span className="rounded bg-[var(--accent-soft)] px-2 py-1 text-xs text-[var(--accent-strong)]">
              tips {profile.monetisation.tipsEnabled ? "enabled" : "disabled"}
            </span>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            {profile.recentContent.map((item) => (
              <article className="overflow-hidden rounded border border-[var(--line)] bg-[var(--panel)]" key={item.id}>
                <div className="aspect-[4/5] bg-[#111827]">
                  {item.posterUrl ? <img alt="" className="h-full w-full object-cover" src={item.posterUrl} /> : null}
                </div>
                <div className="p-4">
                  <p className="font-medium">{item.caption}</p>
                  <p className="mt-1 text-sm text-[var(--muted)]">{item.accessState}</p>
                </div>
              </article>
            ))}
          </div>
        </section>
      </section>
    </main>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded border border-[var(--line)] bg-[var(--panel)] p-3">
      <p className="text-xs uppercase text-[var(--muted)]">{label}</p>
      <p className="mt-1 font-semibold">{value.toLocaleString()}</p>
    </div>
  );
}
