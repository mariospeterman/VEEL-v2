import { describe, expect, it, vi } from "vitest";
import { toContentItem } from "../src/modules/content/content-repository-mappers";
import { withSignedPlayback } from "../src/modules/content/content-route-shared";
import type { ContentRow } from "../src/modules/content/content-repository-rows";
import type { MediaUploadProviderAdapter } from "../src/modules/content/types";
import type { SubscriptionRepository } from "../src/modules/subscription/types";

const row: ContentRow = {
  id: "00000000-0000-4000-8000-000000000040",
  media_type: "image",
  caption: "private image",
  nsfw_label: "none",
  creator_id: "00000000-0000-4000-8000-000000000010",
  handle: "creator",
  display_name: "Creator",
  avatar_url: null,
  media_assets: [{
    id: "00000000-0000-4000-8000-000000000041",
    kind: "image",
    position: 0,
    provider: "bunny",
    providerState: "stored_private",
    providerPlayable: true,
    providerAssetId: "images/content/private.webp",
    posterUrl: null,
    requiredForRelease: true,
    isCover: true,
    originClassification: "human_created"
  }]
};

const subscriptionRepository = {} as SubscriptionRepository;

describe("authorized private image delivery", () => {
  it("signs the canonical provider reference only after full viewer access", async () => {
    const signer = vi.fn(() => ({
      url: "https://private.example.test/image?token=signed&expires=1",
      expiresAt: "2026-11-04T12:05:00.000Z",
      variants: [{
        widthPixels: 480,
        url: "https://private.example.test/image?token=variant&expires=1&width=480"
      }]
    }));
    const provider = {
      provider: "bunny",
      isConfigured: () => true,
      createUploadSession: async () => { throw new Error("not used"); },
      createImageDeliveryResource: signer
    } satisfies MediaUploadProviderAdapter;
    const content = toContentItem(row, null, "free");

    expect(JSON.stringify(content)).not.toContain("images/content/private.webp");
    const authorized = await withSignedPlayback({
      content,
      mediaUploadProvider: provider,
      subscriptionRepository,
      supabaseUserId: "00000000-0000-4000-8000-000000000001",
      appUserId: "00000000-0000-4000-8000-000000000002"
    });

    expect(signer).toHaveBeenCalledWith({
      providerAssetId: "images/content/private.webp"
    });
    expect(authorized.posterUrl).toContain("token=signed");
    expect(authorized.mediaAssets?.[0]?.imageDelivery?.variants[0]?.widthPixels).toBe(480);
  });

  it("does not issue a delivery capability after viewer access is revoked", async () => {
    const signer = vi.fn();
    const provider = {
      provider: "bunny",
      isConfigured: () => true,
      createUploadSession: async () => { throw new Error("not used"); },
      createImageDeliveryResource: signer
    } satisfies MediaUploadProviderAdapter;
    const revoked = toContentItem(row, null, "locked");
    const projected = await withSignedPlayback({
      content: revoked,
      mediaUploadProvider: provider,
      subscriptionRepository,
      supabaseUserId: "00000000-0000-4000-8000-000000000001",
      appUserId: "00000000-0000-4000-8000-000000000002"
    });

    expect(signer).not.toHaveBeenCalled();
    expect(projected.posterUrl).toBeNull();
    expect(projected.mediaAssets?.[0]?.posterUrl).toBeNull();
    expect(projected.mediaAssets?.[0]?.imageDelivery).toBeUndefined();
  });
});

