import type { components } from "@veel/contracts";
import type { CreatorProfileResource, UserResource } from "./types.js";
import type { CreatorContentRow, CreatorProfileRow, ProfileRow } from "./profile-repository-rows.js";

export function toUserResource(row: ProfileRow): UserResource {
  return {
    id: row.id,
    handle: row.handle,
    displayName: row.display_name,
    avatarUrl: row.avatar_url,
    badges: []
  };
}

export function toCreatorProfile(
  row: CreatorProfileRow,
  recentContent: CreatorContentRow[]
): CreatorProfileResource {
  return {
    user: toUserResource(row),
    bio: row.bio,
    locationLabel: row.location_label,
    links: toProfileLinks(row.profile_links),
    stats: {
      contentCount: Number(row.content_count),
      liveRoomCount: Number(row.live_room_count),
      confirmedPaymentCount: Number(row.confirmed_payment_count),
      followerCount: Number(row.follower_count),
      followingCount: Number(row.following_count)
    },
    monetisation: {
      supportEnabled: row.support_enabled,
      contentUnlocksEnabled: row.content_unlocks_enabled,
      livePassesEnabled: row.live_passes_enabled,
      paidMessagesEnabled: row.paid_messages_enabled,
      subscriptionsEnabled: row.subscriptions_enabled,
      membershipOffer:
        row.membership_plan_id && row.membership_label && row.membership_provider_state
          ? {
              id: row.membership_plan_id,
              scope: "creator",
              creator: toUserResource(row),
              label: row.membership_label,
              description: row.membership_description,
              benefits: row.membership_benefits ?? [],
              amountMinor: Number(row.membership_amount_minor ?? 0),
              currency: "USDC",
              periodDays: 30,
              billingMode: "delegated_solana_subscription",
              providerState: row.membership_provider_state,
              provider: "official_solana_subscription_program",
              tokenMint: row.membership_token_mint,
              tokenProgram: row.membership_token_program,
              programId: row.membership_program_id,
              planPda: null,
              merchantWallet: row.membership_merchant_wallet,
              amountAtomic: Number(row.membership_amount_atomic ?? 0),
              periodSeconds: 2_592_000
            }
          : null
    },
    recentContent: recentContent.map(toContentItem)
  };
}

function toProfileLinks(value: unknown): components["schemas"]["ProfileLink"][] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter(
      (link): link is components["schemas"]["ProfileLink"] =>
        typeof link === "object" &&
        link !== null &&
        "label" in link &&
        "url" in link &&
        typeof link.label === "string" &&
        typeof link.url === "string"
    )
    .slice(0, 5);
}

export function toContentItem(row: CreatorContentRow): components["schemas"]["ContentItem"] {
  return {
    id: row.id,
    creator: {
      id: row.creator_id,
      handle: row.handle ?? "",
      displayName: row.display_name ?? "",
      avatarUrl: row.avatar_url,
      badges: []
    },
    mediaType: row.media_type,
    caption: row.caption,
    posterUrl: row.poster_url,
    playback: {
      state: "not_ready",
      url: null,
      provider: "none"
    },
    accessState: "free",
    nsfwLabel: row.nsfw_label,
    engagement: {
      liked: false,
      saved: false,
      likeCount: 0,
      commentCount: 0,
      shareCount: 0
    }
  };
}
