"use client";

import type { DiscoverPage } from "@/api-client";
import { getDiscoverSearchPage } from "@/api-mutations";
import {
  beginGroupedSearchPage,
  completeGroupedSearchPage,
  createGroupedSearchPagination,
  discoverSearchGroups,
  discoverSearchScopeKey,
  failGroupedSearchPage,
  type DiscoverSearchGroup,
  type DiscoverSearchGroupStatus,
  type GroupedSearchPageRequest
} from "@/search/grouped-search-pagination";
import {
  claimRecentSearches,
  clearRecentSearchesForActor,
  recordRecentSearch
} from "@/search/recent-searches";
import { CalendarDays, Hash, Radio, Search, UserRound, Video } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";

type SearchExperienceProps = {
  actorUserId: string | null;
  initialResults: DiscoverPage;
  query: string;
};

export function SearchExperience(props: SearchExperienceProps) {
  const scopeKey = discoverSearchScopeKey(props.actorUserId, props.query);
  return <SearchExperienceSession {...props} key={scopeKey} scopeKey={scopeKey} />;
}

function SearchExperienceSession({
  actorUserId,
  initialResults,
  query,
  scopeKey
}: SearchExperienceProps & { scopeKey: string }) {
  const [recent, setRecent] = useState<string[]>([]);
  const [pagination, setPagination] = useState(() =>
    createGroupedSearchPagination(initialResults, scopeKey)
  );
  const inFlightRequest = useRef<GroupedSearchPageRequest | null>(null);

  useEffect(() => {
    inFlightRequest.current = null;
    setPagination(createGroupedSearchPagination(initialResults, scopeKey));
  }, [initialResults, scopeKey]);

  useEffect(() => {
    if (!actorUserId) {
      setRecent([]);
      return;
    }

    try {
      setRecent(
        query
          ? recordRecentSearch(
              window.sessionStorage,
              actorUserId,
              query,
              new Date(),
              window.localStorage
            )
          : claimRecentSearches(
              window.sessionStorage,
              actorUserId,
              new Date(),
              window.localStorage
            )
      );
    } catch {
      setRecent([]);
    }
  }, [actorUserId, query]);

  function clearRecent() {
    if (actorUserId) {
      try {
        clearRecentSearchesForActor(window.sessionStorage, actorUserId, window.localStorage);
      } catch {
        // The visible list still clears when browser storage is unavailable.
      }
    }
    setRecent([]);
  }

  async function loadMore(group: DiscoverSearchGroup, resultLabel: string) {
    if (inFlightRequest.current) return;

    const started = beginGroupedSearchPage(pagination, group);
    if (!started) return;

    inFlightRequest.current = started.request;
    setPagination(started.state);

    try {
      const nextPage = await getDiscoverSearchPage(query, {
        [started.request.group]: started.request.cursor
      });
      setPagination((current) =>
        completeGroupedSearchPage(current, started.request, nextPage)
      );
    } catch {
      setPagination((current) =>
        failGroupedSearchPage(
          current,
          started.request,
          `More ${resultLabel} could not be loaded. Try again.`
        )
      );
    } finally {
      if (inFlightRequest.current === started.request) {
        inFlightRequest.current = null;
      }
    }
  }

  const page = pagination.page;
  const resultCount =
    page.content.length +
    page.creators.length +
    page.hashtags.length +
    page.events.length +
    page.liveRooms.length;
  const paginationPending = discoverSearchGroups.some(
    (group) => pagination.status[group].pendingRequest !== null
  );

  return (
    <section className="mx-auto grid w-full max-w-5xl gap-6">
      <div>
        <p className="eyebrow">Search</p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">Find your next watch</h1>
      </div>
      <form action="/app/search" className="flex gap-2" method="get" role="search">
        <label className="sr-only" htmlFor="wevid-search">
          Search creators, posts, topics, live, and events
        </label>
        <div className="flex min-h-12 flex-1 items-center gap-2 rounded-full border border-(--line) bg-(--panel) px-4 focus-within:border-(--accent)">
          <Search aria-hidden="true" size={18} />
          <input
            autoComplete="off"
            className="min-w-0 flex-1 bg-transparent py-3 outline-none"
            defaultValue={query}
            id="wevid-search"
            maxLength={120}
            name="q"
            placeholder="Creators, posts, #topics, live, events"
            type="search"
          />
        </div>
        <button className="primary-button" type="submit">
          Search
        </button>
      </form>

      {!query && recent.length > 0 ? (
        <section aria-labelledby="recent-searches">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-sm font-semibold" id="recent-searches">
              Recent searches
            </h2>
            <button className="ghost-button min-h-9 px-3 text-sm" onClick={clearRecent} type="button">
              Clear
            </button>
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            {recent.map((item) => (
              <a
                className="rounded-full border border-(--line) px-3 py-2 text-sm"
                href={`/app/search?q=${encodeURIComponent(item)}`}
                key={item}
              >
                {item}
              </a>
            ))}
          </div>
        </section>
      ) : null}

      {query && resultCount === 0 ? (
        <div className="rounded-2xl border border-(--line) bg-(--panel) p-6">
          <h2 className="font-semibold">No matches for “{query}”</h2>
          <p className="mt-1 text-sm text-(--muted)">
            Try a creator handle, a shorter phrase, or a topic.
          </p>
        </div>
      ) : null}

      <ResultSection
        group="creators"
        icon={UserRound}
        nextCursor={page.nextCursors.creators}
        onLoadMore={loadMore}
        paginationDisabled={paginationPending}
        resultLabel="creators"
        status={pagination.status.creators}
        title={query ? "Creators" : "Creators to explore"}
        visible={page.creators.length > 0}
      >
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {page.creators.map((creator) => (
            <a
              className="rounded-2xl border border-(--line) bg-(--panel) p-4 transition hover:border-(--accent)"
              href={`/profile/${creator.handle}`}
              key={creator.id}
            >
              <strong>{creator.displayName}</strong>
              <span className="mt-1 block text-sm text-(--muted)">@{creator.handle}</span>
            </a>
          ))}
        </div>
      </ResultSection>

      <ResultSection
        group="content"
        icon={Video}
        nextCursor={page.nextCursors.content}
        onLoadMore={loadMore}
        paginationDisabled={paginationPending}
        resultLabel="posts"
        status={pagination.status.content}
        title={query ? "Posts" : "Trending now"}
        visible={page.content.length > 0}
      >
        <div className="grid gap-3 sm:grid-cols-2">
          {page.content.map((item) => (
            <a
              className="rounded-2xl border border-(--line) bg-(--panel) p-4 transition hover:border-(--accent)"
              href={`/content/${item.id}`}
              key={item.id}
            >
              <span className="text-xs font-semibold uppercase tracking-wide text-(--muted)">
                {friendlyMediaType(item.mediaType)}
              </span>
              <strong className="mt-2 block">
                {item.caption || item.bodyText || `${item.creator.displayName} post`}
              </strong>
              <span className="mt-1 block text-sm text-(--muted)">@{item.creator.handle}</span>
            </a>
          ))}
        </div>
      </ResultSection>

      <ResultSection
        group="hashtags"
        icon={Hash}
        nextCursor={page.nextCursors.hashtags}
        onLoadMore={loadMore}
        paginationDisabled={paginationPending}
        resultLabel="topics"
        status={pagination.status.hashtags}
        title="Topics"
        visible={page.hashtags.length > 0}
      >
        <div className="flex flex-wrap gap-2">
          {page.hashtags.map((tag) => (
            <a
              className="rounded-full border border-(--line) bg-(--panel) px-4 py-2 font-semibold"
              href={`/app/search?q=${encodeURIComponent(`#${tag.slug}`)}`}
              key={tag.slug}
            >
              #{tag.displayName}
            </a>
          ))}
        </div>
      </ResultSection>

      <ResultSection
        group="liveRooms"
        icon={Radio}
        nextCursor={page.nextCursors.liveRooms}
        onLoadMore={loadMore}
        paginationDisabled={paginationPending}
        resultLabel="live rooms"
        status={pagination.status.liveRooms}
        title="Live now"
        visible={page.liveRooms.length > 0}
      >
        <div className="grid gap-3 sm:grid-cols-2">
          {page.liveRooms.map((room) => (
            <a
              className="rounded-2xl border border-(--line) bg-(--panel) p-4"
              href={`/live/${room.id}`}
              key={room.id}
            >
              <strong>{room.title}</strong>
              <span className="mt-1 block text-sm text-(--muted)">
                @{room.creator.handle} · {room.state === "live" ? "Live now" : "Replay"}
              </span>
            </a>
          ))}
        </div>
      </ResultSection>

      <ResultSection
        group="events"
        icon={CalendarDays}
        nextCursor={page.nextCursors.events}
        onLoadMore={loadMore}
        paginationDisabled={paginationPending}
        resultLabel="events"
        status={pagination.status.events}
        title="Events"
        visible={page.events.length > 0}
      >
        <div className="grid gap-3 sm:grid-cols-2">
          {page.events.map((event) => (
            <a
              className="rounded-2xl border border-(--line) bg-(--panel) p-4"
              href={`/event-access/${event.id}`}
              key={event.id}
            >
              <strong>{event.title}</strong>
              <span className="mt-1 block text-sm text-(--muted)">
                {new Intl.DateTimeFormat(undefined, {
                  dateStyle: "medium",
                  timeStyle: "short"
                }).format(new Date(event.startsAt))}
              </span>
            </a>
          ))}
        </div>
      </ResultSection>
    </section>
  );
}

function ResultSection({
  children,
  group,
  icon: Icon,
  nextCursor,
  onLoadMore,
  paginationDisabled,
  resultLabel,
  status,
  title,
  visible
}: {
  children: ReactNode;
  group: DiscoverSearchGroup;
  icon: typeof Search;
  nextCursor: string | null;
  onLoadMore: (group: DiscoverSearchGroup, resultLabel: string) => Promise<void>;
  paginationDisabled: boolean;
  resultLabel: string;
  status: DiscoverSearchGroupStatus;
  title: string;
  visible: boolean;
}) {
  if (!visible) return null;

  const errorId = `search-${group}-pagination-error`;
  const pending = status.pendingRequest !== null;

  return (
    <section aria-busy={pending}>
      <h2 className="mb-3 flex items-center gap-2 text-base font-semibold">
        <Icon aria-hidden="true" size={18} />
        {title}
      </h2>
      {children}
      {nextCursor ? (
        <button
          aria-describedby={status.error ? errorId : undefined}
          className="secondary-button mt-4"
          disabled={paginationDisabled}
          onClick={() => void onLoadMore(group, resultLabel)}
          type="button"
        >
          {pending ? "Loading more…" : status.error ? "Try again" : `Load more ${resultLabel}`}
        </button>
      ) : null}
      <p aria-live="polite" className="sr-only">
        {pending ? `Loading more ${resultLabel}.` : ""}
      </p>
      {status.error ? (
        <p className="mt-2 text-sm text-(--danger)" id={errorId} role="alert">
          {status.error}
        </p>
      ) : null}
    </section>
  );
}

function friendlyMediaType(type: string) {
  if (type === "live_replay") return "Replay";
  if (type === "vod") return "Video";
  return type.charAt(0).toUpperCase() + type.slice(1);
}
