import type { components } from "@veel/contracts";
import type { CreatorProfileResource, UserResource } from "./types.js";
import type { CreatorContentRow, CreatorProfileRow, ProfileRow } from "./profile-repository-rows.js";
import {
  accessStateForRule,
  toContentItem as toCanonicalContentItem
} from "../content/content-repository-mappers.js";
import { toSubscriptionPlan } from "../subscription/subscription-repository-mappers.js";

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
      membershipOffer: toPublicMembershipOffer(row)
    },
    recentContent: recentContent.map(toContentItem)
  };
}

function toPublicMembershipOffer(
  row: CreatorProfileRow
): components["schemas"]["SubscriptionPlan"] | null {
  if (
    !row.membership_plan_id ||
    !row.membership_label ||
    !row.membership_currency ||
    !row.membership_period_days ||
    !row.membership_billing_mode ||
    !row.membership_provider_state
  ) {
    return null;
  }

  return toSubscriptionPlan({
    id: row.membership_plan_id,
    scope: "creator",
    creator_user_id: row.id,
    creator_handle: row.handle,
    creator_display_name: row.display_name,
    creator_avatar_url: row.avatar_url,
    label: row.membership_label,
    description: row.membership_description,
    benefits: row.membership_benefits ?? [],
    amount_minor: row.membership_amount_minor ?? 0,
    amount_atomic: row.membership_amount_atomic,
    currency: row.membership_currency,
    period_days: row.membership_period_days,
    period_seconds: row.membership_period_seconds,
    billing_mode: row.membership_billing_mode,
    provider_state: row.membership_provider_state,
    provider: row.membership_provider,
    token_mint: row.membership_token_mint,
    token_program: row.membership_token_program,
    program_id: row.membership_program_id,
    plan_pda: row.membership_plan_pda,
    merchant_wallet: row.membership_merchant_wallet
  });
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
  return toCanonicalContentItem(row, row.poster_url, accessStateForRule(row));
}
