import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DiscoverPage } from "../api-client-types";

const transport = vi.hoisted(() => ({
  anonymousEmptyMutation: vi.fn(),
  authenticatedBinaryMutation: vi.fn(),
  authenticatedEmptyMutation: vi.fn(),
  authenticatedGet: vi.fn(),
  authenticatedMutation: vi.fn(),
  publicCapabilityMutation: vi.fn(),
  publicMutation: vi.fn()
}));

vi.mock("../api-mutation-transport", () => transport);

import { getDiscoverSearchPage } from "../api-mutations";

describe("browser Discover search continuation", () => {
  beforeEach(() => {
    transport.authenticatedGet.mockReset();
    transport.authenticatedGet.mockResolvedValue({} as DiscoverPage);
  });

  it("sends only the selected group's opaque cursor with the search scope", async () => {
    await getDiscoverSearchPage("music & live", { creators: "opaque/+=cursor" });

    expect(transport.authenticatedGet).toHaveBeenCalledWith(
      "/v1/discover/search?q=music+%26+live&creatorCursor=opaque%2F%2B%3Dcursor"
    );
  });

  it("uses the first-page route when neither a query nor cursor is present", async () => {
    await getDiscoverSearchPage();

    expect(transport.authenticatedGet).toHaveBeenCalledWith("/v1/discover/search");
  });
});
