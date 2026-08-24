"use client";

import type { DiscoverPage } from "@/api-client";
import { CalendarDays, Hash, Radio, Search, UserRound, Video } from "lucide-react";
import { useEffect, useState } from "react";
import type { ReactNode } from "react";

const recentKey = "wevid:search:recent";

export function SearchExperience({ initialResults, query }: { initialResults: DiscoverPage; query: string }) {
  const [recent, setRecent] = useState<string[]>([]);

  useEffect(() => {
    try {
      const stored = JSON.parse(localStorage.getItem(recentKey) ?? "[]") as unknown;
      if (Array.isArray(stored)) setRecent(stored.filter((item): item is string => typeof item === "string").slice(0, 6));
      if (query) {
        const next = [query, ...(Array.isArray(stored) ? stored.filter((item) => item !== query) : [])]
          .filter((item): item is string => typeof item === "string")
          .slice(0, 6);
        localStorage.setItem(recentKey, JSON.stringify(next));
        setRecent(next);
      }
    } catch {
      setRecent(query ? [query] : []);
    }
  }, [query]);

  const resultCount = initialResults.content.length + initialResults.creators.length + initialResults.hashtags.length + initialResults.events.length + initialResults.liveRooms.length;

  return (
    <section className="mx-auto grid w-full max-w-5xl gap-6">
      <div>
        <p className="eyebrow">Search</p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">Find your next watch</h1>
      </div>
      <form action="/app/search" className="flex gap-2" method="get" role="search">
        <label className="sr-only" htmlFor="wevid-search">Search creators, posts, topics, live, and events</label>
        <div className="flex min-h-12 flex-1 items-center gap-2 rounded-full border border-(--line) bg-(--panel) px-4 focus-within:border-(--accent)">
          <Search aria-hidden="true" size={18} />
          <input autoComplete="off" className="min-w-0 flex-1 bg-transparent py-3 outline-none" defaultValue={query} id="wevid-search" maxLength={120} name="q" placeholder="Creators, posts, #topics, live, events" type="search" />
        </div>
        <button className="primary-button" type="submit">Search</button>
      </form>

      {!query && recent.length > 0 ? (
        <section aria-labelledby="recent-searches">
          <h2 className="text-sm font-semibold" id="recent-searches">Recent searches</h2>
          <div className="mt-2 flex flex-wrap gap-2">{recent.map((item) => <a className="rounded-full border border-(--line) px-3 py-2 text-sm" href={`/app/search?q=${encodeURIComponent(item)}`} key={item}>{item}</a>)}</div>
        </section>
      ) : null}

      {query && resultCount === 0 ? <div className="rounded-2xl border border-(--line) bg-(--panel) p-6"><h2 className="font-semibold">No matches for “{query}”</h2><p className="mt-1 text-sm text-(--muted)">Try a creator handle, a shorter phrase, or a topic.</p></div> : null}

      <ResultSection icon={UserRound} title={query ? "Creators" : "Creators to explore"} visible={initialResults.creators.length > 0}>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{initialResults.creators.map((creator) => <a className="rounded-2xl border border-(--line) bg-(--panel) p-4 transition hover:border-(--accent)" href={`/profile/${creator.handle}`} key={creator.id}><strong>{creator.displayName}</strong><span className="mt-1 block text-sm text-(--muted)">@{creator.handle}</span></a>)}</div>
      </ResultSection>

      <ResultSection icon={Video} title={query ? "Posts" : "Trending now"} visible={initialResults.content.length > 0}>
        <div className="grid gap-3 sm:grid-cols-2">{initialResults.content.map((item) => <a className="rounded-2xl border border-(--line) bg-(--panel) p-4 transition hover:border-(--accent)" href={`/content/${item.id}`} key={item.id}><span className="text-xs font-semibold uppercase tracking-wide text-(--muted)">{friendlyMediaType(item.mediaType)}</span><strong className="mt-2 block">{item.caption || item.bodyText || `${item.creator.displayName} post`}</strong><span className="mt-1 block text-sm text-(--muted)">@{item.creator.handle}</span></a>)}</div>
      </ResultSection>

      <ResultSection icon={Hash} title="Topics" visible={initialResults.hashtags.length > 0}>
        <div className="flex flex-wrap gap-2">{initialResults.hashtags.map((tag) => <a className="rounded-full border border-(--line) bg-(--panel) px-4 py-2 font-semibold" href={`/app/search?q=${encodeURIComponent(`#${tag.slug}`)}`} key={tag.slug}>#{tag.displayName}</a>)}</div>
      </ResultSection>

      <ResultSection icon={Radio} title="Live now" visible={initialResults.liveRooms.length > 0}>
        <div className="grid gap-3 sm:grid-cols-2">{initialResults.liveRooms.map((room) => <a className="rounded-2xl border border-(--line) bg-(--panel) p-4" href={`/live/${room.id}`} key={room.id}><strong>{room.title}</strong><span className="mt-1 block text-sm text-(--muted)">@{room.creator.handle} · {room.state === "live" ? "Live now" : "Replay"}</span></a>)}</div>
      </ResultSection>

      <ResultSection icon={CalendarDays} title="Events" visible={initialResults.events.length > 0}>
        <div className="grid gap-3 sm:grid-cols-2">{initialResults.events.map((event) => <a className="rounded-2xl border border-(--line) bg-(--panel) p-4" href={`/event-access/${event.id}`} key={event.id}><strong>{event.title}</strong><span className="mt-1 block text-sm text-(--muted)">{new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(event.startsAt))}</span></a>)}</div>
      </ResultSection>
    </section>
  );
}

function ResultSection({ children, icon: Icon, title, visible }: { children: ReactNode; icon: typeof Search; title: string; visible: boolean }) {
  if (!visible) return null;
  return <section><h2 className="mb-3 flex items-center gap-2 text-base font-semibold"><Icon aria-hidden="true" size={18} />{title}</h2>{children}</section>;
}

function friendlyMediaType(type: string) {
  if (type === "live_replay") return "Replay";
  if (type === "vod") return "Video";
  return type.charAt(0).toUpperCase() + type.slice(1);
}
