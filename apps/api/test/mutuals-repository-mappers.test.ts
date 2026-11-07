import { describe, expect, it } from "vitest";
import { mutualsMediaKind } from "../src/modules/mutuals/mutuals-repository-mappers.js";

describe("Mutuals repository mappers", () => {
  it.each([
    ["image", "image", "image"],
    ["bit", "video", "video"],
    ["clip", "video", "video"],
    ["vod", "video", "video"],
    ["live_replay", "video", "replay"],
    ["carousel", "image", "image"],
    ["carousel", "video", "video"]
  ] as const)("maps %s with a %s cover to %s", (mediaType, coverAssetKind, expected) => {
    expect(mutualsMediaKind(mediaType, coverAssetKind)).toBe(expected);
  });
});
