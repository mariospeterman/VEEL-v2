import type { DiscoverPage } from "../api-client-types";

export const discoverSearchGroups = [
  "content",
  "creators",
  "hashtags",
  "events",
  "liveRooms"
] as const;

export type DiscoverSearchGroup = (typeof discoverSearchGroups)[number];

export type GroupedSearchPageRequest = {
  cursor: string;
  group: DiscoverSearchGroup;
  scopeKey: string;
};

export type DiscoverSearchGroupStatus = {
  error: string | null;
  pendingRequest: GroupedSearchPageRequest | null;
};

export type GroupedSearchPaginationState = {
  page: DiscoverPage;
  scopeKey: string;
  status: Record<DiscoverSearchGroup, DiscoverSearchGroupStatus>;
};

export function discoverSearchScopeKey(actorUserId: string | null, query: string): string {
  return JSON.stringify([actorUserId, query]);
}

export function createGroupedSearchPagination(
  page: DiscoverPage,
  scopeKey: string
): GroupedSearchPaginationState {
  return {
    page,
    scopeKey,
    status: createGroupStatus()
  };
}

export function beginGroupedSearchPage(
  state: GroupedSearchPaginationState,
  group: DiscoverSearchGroup
): { request: GroupedSearchPageRequest; state: GroupedSearchPaginationState } | null {
  if (discoverSearchGroups.some((candidate) => state.status[candidate].pendingRequest !== null)) {
    return null;
  }

  const cursor = state.page.nextCursors[group];
  if (!cursor) return null;

  const request = { cursor, group, scopeKey: state.scopeKey };
  return {
    request,
    state: {
      ...state,
      status: {
        ...state.status,
        [group]: { error: null, pendingRequest: request }
      }
    }
  };
}

export function completeGroupedSearchPage(
  state: GroupedSearchPaginationState,
  request: GroupedSearchPageRequest,
  incoming: DiscoverPage
): GroupedSearchPaginationState {
  if (!isCurrentRequest(state, request)) return state;

  const nextCursor = incoming.nextCursors[request.group];
  const safeNextCursor = nextCursor === request.cursor ? null : nextCursor;

  return {
    ...state,
    page: mergeRequestedGroup(state.page, incoming, request.group, safeNextCursor),
    status: {
      ...state.status,
      [request.group]: { error: null, pendingRequest: null }
    }
  };
}

export function failGroupedSearchPage(
  state: GroupedSearchPaginationState,
  request: GroupedSearchPageRequest,
  error: string
): GroupedSearchPaginationState {
  if (!isCurrentRequest(state, request)) return state;

  return {
    ...state,
    status: {
      ...state.status,
      [request.group]: { error, pendingRequest: null }
    }
  };
}

function createGroupStatus(): Record<DiscoverSearchGroup, DiscoverSearchGroupStatus> {
  return {
    content: { error: null, pendingRequest: null },
    creators: { error: null, pendingRequest: null },
    hashtags: { error: null, pendingRequest: null },
    events: { error: null, pendingRequest: null },
    liveRooms: { error: null, pendingRequest: null }
  };
}

function isCurrentRequest(
  state: GroupedSearchPaginationState,
  request: GroupedSearchPageRequest
): boolean {
  return (
    state.scopeKey === request.scopeKey &&
    state.status[request.group].pendingRequest === request
  );
}

function mergeRequestedGroup(
  current: DiscoverPage,
  incoming: DiscoverPage,
  group: DiscoverSearchGroup,
  nextCursor: string | null
): DiscoverPage {
  const nextCursors = { ...current.nextCursors, [group]: nextCursor };

  switch (group) {
    case "content":
      return {
        ...current,
        content: appendUnique(current.content, incoming.content, (item) => item.id),
        nextCursors
      };
    case "creators":
      return {
        ...current,
        creators: appendUnique(current.creators, incoming.creators, (item) => item.id),
        nextCursors
      };
    case "hashtags":
      return {
        ...current,
        hashtags: appendUnique(current.hashtags, incoming.hashtags, (item) => item.slug),
        nextCursors
      };
    case "events":
      return {
        ...current,
        events: appendUnique(current.events, incoming.events, (item) => item.id),
        nextCursors
      };
    case "liveRooms":
      return {
        ...current,
        liveRooms: appendUnique(current.liveRooms, incoming.liveRooms, (item) => item.id),
        nextCursors
      };
  }
}

function appendUnique<T>(current: T[], incoming: T[], identity: (item: T) => string): T[] {
  const seen = new Set(current.map(identity));
  const merged = [...current];

  for (const item of incoming) {
    const key = identity(item);
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(item);
  }

  return merged;
}
