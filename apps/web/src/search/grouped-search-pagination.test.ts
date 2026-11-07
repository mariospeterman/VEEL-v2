import { describe, expect, it } from "vitest";
import type { DiscoverPage } from "../api-client-types";
import {
  beginGroupedSearchPage,
  completeGroupedSearchPage,
  createGroupedSearchPagination,
  discoverSearchScopeKey,
  failGroupedSearchPage
} from "./grouped-search-pagination";

describe("grouped Discover search pagination", () => {
  it("binds pagination state to both the normalized query and actor", () => {
    expect(discoverSearchScopeKey("actor-a", "music")).not.toBe(
      discoverSearchScopeKey("actor-a", "gaming")
    );
    expect(discoverSearchScopeKey("actor-a", "music")).not.toBe(
      discoverSearchScopeKey("actor-b", "music")
    );
  });

  it("merges only the requested group with stable identity dedupe", () => {
    const initial = discoverPage({
      content: ["post-1", "post-2"],
      creators: ["creator-1"],
      cursors: { content: "content-page-2", creators: "creator-page-2" }
    });
    const started = beginGroupedSearchPage(
      createGroupedSearchPagination(initial, "scope"),
      "content"
    );
    expect(started).not.toBeNull();

    const completed = completeGroupedSearchPage(
      started!.state,
      started!.request,
      discoverPage({
        content: ["post-2", "post-3"],
        creators: ["creator-from-unrequested-first-page"],
        cursors: { content: "content-page-3", creators: "unrequested-cursor" }
      })
    );

    expect(completed.page.content.map((item) => item.id)).toEqual([
      "post-1",
      "post-2",
      "post-3"
    ]);
    expect(completed.page.creators.map((item) => item.id)).toEqual(["creator-1"]);
    expect(completed.page.nextCursors).toMatchObject({
      content: "content-page-3",
      creators: "creator-page-2"
    });
  });

  it("deduplicates hashtags by their canonical slug", () => {
    const initial = discoverPage({
      hashtags: ["music", "live"],
      cursors: { hashtags: "hashtag-page-2" }
    });
    const started = beginGroupedSearchPage(
      createGroupedSearchPagination(initial, "scope"),
      "hashtags"
    );

    const completed = completeGroupedSearchPage(
      started!.state,
      started!.request,
      discoverPage({ hashtags: ["live", "events"], cursors: { hashtags: null } })
    );

    expect(completed.page.hashtags.map((item) => item.slug)).toEqual([
      "music",
      "live",
      "events"
    ]);
    expect(completed.page.nextCursors.hashtags).toBeNull();
  });

  it("keeps the cursor available after a failure and clears the error on retry", () => {
    const initial = createGroupedSearchPagination(
      discoverPage({ content: ["post-1"], cursors: { content: "content-page-2" } }),
      "scope"
    );
    const started = beginGroupedSearchPage(initial, "content")!;
    const failed = failGroupedSearchPage(
      started.state,
      started.request,
      "More posts could not be loaded. Try again."
    );

    expect(failed.page.nextCursors.content).toBe("content-page-2");
    expect(failed.status.content.error).toContain("could not be loaded");

    const retried = beginGroupedSearchPage(failed, "content")!;
    expect(retried.request.cursor).toBe("content-page-2");
    expect(retried.state.status.content).toEqual({
      error: null,
      pendingRequest: retried.request
    });
  });

  it("ignores a stale response after the query or actor scope resets", () => {
    const started = beginGroupedSearchPage(
      createGroupedSearchPagination(
        discoverPage({ content: ["old"], cursors: { content: "old-page-2" } }),
        "old-scope"
      ),
      "content"
    )!;
    const reset = createGroupedSearchPagination(
      discoverPage({ content: ["new"], cursors: { content: "new-page-2" } }),
      "new-scope"
    );

    expect(
      completeGroupedSearchPage(
        reset,
        started.request,
        discoverPage({ content: ["stale"], cursors: { content: null } })
      )
    ).toBe(reset);
  });

  it("does not let an earlier same-cursor response complete a replacement request", () => {
    const oldRequest = beginGroupedSearchPage(
      createGroupedSearchPagination(
        discoverPage({ content: ["post-1"], cursors: { content: "content-page-2" } }),
        "scope"
      ),
      "content"
    )!;
    const replacement = beginGroupedSearchPage(
      createGroupedSearchPagination(
        discoverPage({ content: ["post-1"], cursors: { content: "content-page-2" } }),
        "scope"
      ),
      "content"
    )!;

    expect(
      completeGroupedSearchPage(
        replacement.state,
        oldRequest.request,
        discoverPage({ content: ["stale"], cursors: { content: null } })
      )
    ).toBe(replacement.state);
  });

  it("stops a non-advancing cursor instead of offering the same page forever", () => {
    const started = beginGroupedSearchPage(
      createGroupedSearchPagination(
        discoverPage({ events: ["event-1"], cursors: { events: "event-page-2" } }),
        "scope"
      ),
      "events"
    )!;
    const completed = completeGroupedSearchPage(
      started.state,
      started.request,
      discoverPage({ events: ["event-2"], cursors: { events: "event-page-2" } })
    );

    expect(completed.page.events.map((event) => event.id)).toEqual(["event-1", "event-2"]);
    expect(completed.page.nextCursors.events).toBeNull();
  });
});

function discoverPage({
  content = [],
  creators = [],
  cursors = {},
  events = [],
  hashtags = [],
  liveRooms = []
}: {
  content?: string[];
  creators?: string[];
  cursors?: Partial<DiscoverPage["nextCursors"]>;
  events?: string[];
  hashtags?: string[];
  liveRooms?: string[];
} = {}): DiscoverPage {
  return {
    content: content.map((id) => ({ id })),
    creators: creators.map((id) => ({ id })),
    events: events.map((id) => ({ id })),
    hashtags: hashtags.map((slug) => ({ slug })),
    liveRooms: liveRooms.map((id) => ({ id })),
    nextCursors: {
      content: null,
      creators: null,
      events: null,
      hashtags: null,
      liveRooms: null,
      ...cursors
    }
  } as unknown as DiscoverPage;
}
