import type {
  Mutual,
  MutualsFeedItem,
  MutualsInterestResult,
  MutualsProfile
} from "./types.js";
import { MutualsRepositoryConfigurationError } from "./mutuals-errors.js";
import type {
  MutualRow,
  MutualsFeedRow,
  MutualsInterestResultRow,
  MutualsProfileRow
} from "./mutuals-repository-rows.js";

export function toMutualsProfile(row: MutualsProfileRow | undefined): MutualsProfile {
  if (!row) throw new MutualsRepositoryConfigurationError();

  return {
    enabled: row.enabled,
    consentVersion: row.consent_version,
    activeMatchLimit: row.active_match_limit,
    visibleOnMedia: row.visible_on_media,
    safetyState: row.safety_state,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString()
  };
}

export function toMutualsFeedItem(row: MutualsFeedRow): MutualsFeedItem {
  return {
    contentId: row.content_id,
    creatorUserId: row.creator_user_id,
    handle: row.handle,
    displayName: row.display_name,
    avatarUrl: row.avatar_url,
    title: row.title,
    mediaKind: row.media_kind,
    posterUrl: row.poster_url,
    createdAt: row.created_at.toISOString()
  };
}

export function toInterestResult(row: MutualsInterestResultRow): MutualsInterestResult {
  const match = row.match_id
    ? toMutual({
        id: row.match_id,
        user_a_id: row.match_user_a_id ?? "",
        user_b_id: row.match_user_b_id ?? "",
        source_content_item_id: row.match_source_content_item_id,
        conversation_id: row.match_conversation_id,
        state: row.match_state ?? "active",
        stale_at: row.match_stale_at,
        expires_at: row.match_expires_at,
        created_at: row.match_created_at ?? new Date()
      })
    : undefined;

  return {
    interestId: row.swipe_id,
    mutualCreated: Boolean(row.match_id),
    mutualId: row.match_id,
    ...(match ? { mutual: match } : {})
  };
}

export function toMutual(row: MutualRow): Mutual {
  return {
    id: row.id,
    userAId: row.user_a_id,
    userBId: row.user_b_id,
    sourceContentId: row.source_content_item_id,
    conversationId: row.conversation_id,
    state: row.state,
    staleAt: row.stale_at?.toISOString() ?? null,
    expiresAt: row.expires_at?.toISOString() ?? null,
    createdAt: row.created_at.toISOString()
  };
}
