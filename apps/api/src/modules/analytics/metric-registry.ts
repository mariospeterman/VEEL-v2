import type { AnalyticsDimensions, AnalyticsScope } from "./types.js";

export const analyticsDefinitionVersion = 1;
export const analyticsProjectionKey = "analytics_core";

export type AnalyticsMetricSource =
  | "viewer_daily"
  | "creator_daily"
  | "creator_content_daily"
  | "creator_product_daily"
  | "organization_creator_daily"
  | "platform_commerce_daily"
  | "platform_operations_daily"
  | "retention_daily"
  | "onboarding_daily";

export interface AnalyticsMetricDefinition {
  key: string;
  definitionVersion: number;
  label: string;
  description: string;
  unit: "count" | "seconds" | "ratio" | "minor_units";
  source: AnalyticsMetricSource;
  valueColumn?: string;
  numeratorColumn?: string;
  denominatorColumn?: string;
  numeratorEvent?: string;
  denominatorEvent?: string;
  supportedScopes: AnalyticsScope["type"][];
  dimensions: (keyof AnalyticsDimensions)[];
  minimumCohortSize: number;
  freshnessTargetSeconds: number;
  privacyClass: "personal" | "audience" | "operational";
}

function metric(input: Omit<AnalyticsMetricDefinition, "definitionVersion" | "privacyClass"> & {
  privacyClass?: AnalyticsMetricDefinition["privacyClass"];
}): AnalyticsMetricDefinition {
  const privacyClass = input.privacyClass
    ?? (input.supportedScopes.length === 1 && input.supportedScopes[0] === "viewer"
      ? "personal"
      : input.key.startsWith("platform.lifecycle.") || input.key.startsWith("platform.onboarding.")
        ? "audience"
        : input.supportedScopes.includes("platform")
          ? "operational"
          : input.minimumCohortSize >= 5
            ? "audience"
            : "operational");
  return { ...input, privacyClass, definitionVersion: analyticsDefinitionVersion };
}

export const analyticsMetricRegistry = new Map<string, AnalyticsMetricDefinition>([
  metric({ key: "viewer.feed.impressions", label: "Feed impressions", description: "The current viewer's canonical feed impression receipts.", unit: "count", source: "viewer_daily", valueColumn: "feed_impression_count", supportedScopes: ["viewer"], dimensions: [], minimumCohortSize: 1, freshnessTargetSeconds: 60 }),
  metric({ key: "viewer.content.qualified_views", label: "Qualified views", description: "The current viewer's playback sessions with at least two credited seconds.", unit: "count", source: "viewer_daily", valueColumn: "qualified_view_count", supportedScopes: ["viewer"], dimensions: [], minimumCohortSize: 1, freshnessTargetSeconds: 60 }),
  metric({ key: "viewer.content.watch_seconds", label: "Credited watch time", description: "The current viewer's server-credited bounded playback seconds.", unit: "seconds", source: "viewer_daily", valueColumn: "credited_watch_seconds", supportedScopes: ["viewer"], dimensions: [], minimumCohortSize: 1, freshnessTargetSeconds: 60 }),
  metric({ key: "viewer.content.completion_rate", label: "Completion rate", description: "The current viewer's completed views divided by qualified views.", unit: "ratio", source: "viewer_daily", numeratorColumn: "completed_view_count", denominatorColumn: "qualified_view_count", supportedScopes: ["viewer"], dimensions: [], minimumCohortSize: 1, freshnessTargetSeconds: 60 }),
  metric({ key: "viewer.content.early_skips", label: "Early skips", description: "The current viewer's playback sessions below two credited seconds.", unit: "count", source: "viewer_daily", valueColumn: "early_skip_count", supportedScopes: ["viewer"], dimensions: [], minimumCohortSize: 1, freshnessTargetSeconds: 60 }),
  metric({ key: "viewer.content.replays", label: "Replays", description: "The current viewer's additional qualified sessions.", unit: "count", source: "viewer_daily", valueColumn: "replay_count", supportedScopes: ["viewer"], dimensions: [], minimumCohortSize: 1, freshnessTargetSeconds: 60 }),
  metric({ key: "viewer.engagement.saves", label: "Saves", description: "The current viewer's active saves attributed to creation day.", unit: "count", source: "viewer_daily", valueColumn: "save_count", supportedScopes: ["viewer"], dimensions: [], minimumCohortSize: 1, freshnessTargetSeconds: 60 }),
  metric({ key: "viewer.engagement.shares", label: "Shares", description: "The current viewer's canonical share records.", unit: "count", source: "viewer_daily", valueColumn: "share_count", supportedScopes: ["viewer"], dimensions: [], minimumCohortSize: 1, freshnessTargetSeconds: 60 }),
  metric({ key: "viewer.safety.hides", label: "Hidden creators", description: "The current viewer's canonical creator-hide actions.", unit: "count", source: "viewer_daily", valueColumn: "hide_count", supportedScopes: ["viewer"], dimensions: [], minimumCohortSize: 1, freshnessTargetSeconds: 120 }),
  metric({ key: "viewer.safety.reports", label: "Reports", description: "The current viewer's submitted canonical reports without report content.", unit: "count", source: "viewer_daily", valueColumn: "report_count", supportedScopes: ["viewer"], dimensions: [], minimumCohortSize: 1, freshnessTargetSeconds: 120 }),
  metric({ key: "viewer.lifecycle.return_sessions", label: "Return sessions", description: "Application sessions after the account creation date.", unit: "count", source: "viewer_daily", valueColumn: "return_session_count", supportedScopes: ["viewer"], dimensions: [], minimumCohortSize: 1, freshnessTargetSeconds: 120 }),
  metric({ key: "creator.content.published", label: "Published content", description: "Content first published in the selected window.", unit: "count", source: "creator_daily", valueColumn: "published_content_count", supportedScopes: ["creator"], dimensions: [], minimumCohortSize: 1, freshnessTargetSeconds: 120 }),
  metric({ key: "creator.content.impressions", label: "Feed impressions", description: "Idempotent canonical feed impression receipts.", unit: "count", source: "creator_content_daily", valueColumn: "impression_count", supportedScopes: ["creator"], dimensions: ["contentId", "mediaType"], minimumCohortSize: 5, freshnessTargetSeconds: 60 }),
  metric({ key: "creator.content.qualified_views", label: "Qualified views", description: "Playback sessions with at least two credited seconds.", unit: "count", source: "creator_content_daily", valueColumn: "qualified_view_count", supportedScopes: ["creator"], dimensions: ["contentId", "mediaType"], minimumCohortSize: 5, freshnessTargetSeconds: 60 }),
  metric({ key: "creator.content.watch_seconds", label: "Credited watch time", description: "Server-credited bounded playback heartbeat seconds.", unit: "seconds", source: "creator_content_daily", valueColumn: "credited_watch_seconds", supportedScopes: ["creator"], dimensions: ["contentId", "mediaType"], minimumCohortSize: 5, freshnessTargetSeconds: 60 }),
  metric({ key: "creator.content.completed_views", label: "Completed views", description: "Qualified sessions reaching at least ninety percent of known media duration.", unit: "count", source: "creator_content_daily", valueColumn: "completed_view_count", supportedScopes: ["creator"], dimensions: ["contentId", "mediaType"], minimumCohortSize: 5, freshnessTargetSeconds: 60 }),
  metric({ key: "creator.content.completion_rate", label: "Completion rate", description: "Completed views divided by qualified views; zero denominators return zero without disclosure.", unit: "ratio", source: "creator_content_daily", numeratorColumn: "completed_view_count", denominatorColumn: "qualified_view_count", supportedScopes: ["creator"], dimensions: ["contentId", "mediaType"], minimumCohortSize: 5, freshnessTargetSeconds: 60 }),
  metric({ key: "creator.content.early_skips", label: "Early skips", description: "Playback sessions with fewer than two credited seconds.", unit: "count", source: "creator_content_daily", valueColumn: "early_skip_count", supportedScopes: ["creator"], dimensions: ["contentId", "mediaType"], minimumCohortSize: 5, freshnessTargetSeconds: 60 }),
  metric({ key: "creator.content.replays", label: "Replays", description: "Additional qualified sessions by the same viewer and content on a UTC day.", unit: "count", source: "creator_content_daily", valueColumn: "replay_count", supportedScopes: ["creator"], dimensions: ["contentId", "mediaType"], minimumCohortSize: 5, freshnessTargetSeconds: 60 }),
  metric({ key: "creator.engagement.likes", label: "Likes", description: "Active canonical content likes attributed to their creation day.", unit: "count", source: "creator_content_daily", valueColumn: "like_count", supportedScopes: ["creator"], dimensions: ["contentId", "mediaType"], minimumCohortSize: 5, freshnessTargetSeconds: 60 }),
  metric({ key: "creator.engagement.comments", label: "Comments", description: "Visible canonical comments attributed to their creation day.", unit: "count", source: "creator_content_daily", valueColumn: "comment_count", supportedScopes: ["creator"], dimensions: ["contentId", "mediaType"], minimumCohortSize: 5, freshnessTargetSeconds: 60 }),
  metric({ key: "creator.engagement.saves", label: "Saves", description: "Active canonical saves attributed to their creation day.", unit: "count", source: "creator_content_daily", valueColumn: "save_count", supportedScopes: ["creator"], dimensions: ["contentId", "mediaType"], minimumCohortSize: 5, freshnessTargetSeconds: 60 }),
  metric({ key: "creator.engagement.shares", label: "Shares", description: "Created canonical content shares.", unit: "count", source: "creator_content_daily", valueColumn: "share_count", supportedScopes: ["creator"], dimensions: ["contentId", "mediaType"], minimumCohortSize: 5, freshnessTargetSeconds: 60 }),
  metric({ key: "creator.social.follower_starts", label: "New followers", description: "Canonical follow relationships first created in the selected window.", unit: "count", source: "creator_daily", valueColumn: "follower_start_count", supportedScopes: ["creator"], dimensions: [], minimumCohortSize: 5, freshnessTargetSeconds: 120 }),
  metric({ key: "creator.social.profile_opens", label: "Profile opens", description: "Bounded idempotent profile-open receipts without viewer disclosure.", unit: "count", source: "creator_daily", valueColumn: "profile_open_count", supportedScopes: ["creator"], dimensions: [], minimumCohortSize: 5, freshnessTargetSeconds: 120 }),
  metric({ key: "creator.social.follow_after_view", label: "Follows after view", description: "Follows preceded by a same-day canonical content impression.", unit: "count", source: "creator_daily", valueColumn: "follow_after_view_count", supportedScopes: ["creator"], dimensions: [], minimumCohortSize: 5, freshnessTargetSeconds: 120 }),
  metric({ key: "creator.social.follow_conversion", label: "Follow conversion", description: "Follows after view divided by canonical feed impressions.", unit: "ratio", source: "creator_daily", numeratorColumn: "follow_after_view_count", denominatorColumn: "feed_impression_count", supportedScopes: ["creator"], dimensions: [], minimumCohortSize: 5, freshnessTargetSeconds: 120 }),
  metric({ key: "creator.commerce.confirmed_purchases", label: "Confirmed purchases", description: "Backend-confirmed payment intents, grouped without combining currencies.", unit: "count", source: "creator_product_daily", valueColumn: "confirmed_purchase_count", supportedScopes: ["creator"], dimensions: ["currency", "productType"], minimumCohortSize: 1, freshnessTargetSeconds: 60 }),
  metric({ key: "creator.commerce.confirmed_gross_minor", label: "Confirmed gross", description: "Backend-confirmed gross amount in native minor units; never a balance.", unit: "minor_units", source: "creator_product_daily", valueColumn: "confirmed_gross_minor", supportedScopes: ["creator"], dimensions: ["currency", "productType"], minimumCohortSize: 1, freshnessTargetSeconds: 60 }),
  metric({ key: "creator.commerce.earnings_minor", label: "Confirmed creator earnings", description: "Posted creator-earning ledger entries in native minor units; never withdrawable balance state.", unit: "minor_units", source: "creator_product_daily", valueColumn: "creator_earnings_minor", supportedScopes: ["creator"], dimensions: ["currency", "productType"], minimumCohortSize: 1, freshnessTargetSeconds: 60 }),
  metric({ key: "creator.commerce.platform_fee_minor", label: "Posted platform fee", description: "Posted platform-fee ledger entries associated with creator transactions.", unit: "minor_units", source: "creator_product_daily", valueColumn: "platform_fee_minor", supportedScopes: ["creator"], dimensions: ["currency", "productType"], minimumCohortSize: 1, freshnessTargetSeconds: 60 }),
  metric({ key: "creator.commerce.offer_impressions", label: "Offer impressions", description: "Bounded idempotent monetisation-offer impression receipts.", unit: "count", source: "creator_product_daily", valueColumn: "offer_impression_count", supportedScopes: ["creator"], dimensions: ["currency", "productType"], minimumCohortSize: 5, freshnessTargetSeconds: 60 }),
  metric({ key: "creator.commerce.unlock_conversion", label: "Offer conversion", description: "Confirmed purchases divided by offer impressions for one product and native currency.", unit: "ratio", source: "creator_product_daily", numeratorColumn: "confirmed_purchase_count", denominatorColumn: "offer_impression_count", supportedScopes: ["creator"], dimensions: ["currency", "productType"], minimumCohortSize: 5, freshnessTargetSeconds: 60 }),
  metric({ key: "creator.membership.starts", label: "Membership starts", description: "Creator membership periods that started in the selected window.", unit: "count", source: "creator_product_daily", valueColumn: "membership_start_count", supportedScopes: ["creator"], dimensions: ["currency", "productType"], minimumCohortSize: 1, freshnessTargetSeconds: 120 }),
  metric({ key: "creator.membership.cancellations", label: "Membership cancellations", description: "Creator memberships cancelled in the selected window.", unit: "count", source: "creator_product_daily", valueColumn: "membership_cancel_count", supportedScopes: ["creator"], dimensions: ["currency", "productType"], minimumCohortSize: 1, freshnessTargetSeconds: 120 }),
  metric({ key: "organization.commerce.confirmed_allocations", label: "Confirmed managed allocations", description: "Confirmed managed-creator allocation records.", unit: "count", source: "organization_creator_daily", valueColumn: "confirmed_allocation_count", supportedScopes: ["organization"], dimensions: ["creatorUserId", "currency"], minimumCohortSize: 1, freshnessTargetSeconds: 120 }),
  metric({ key: "organization.commerce.creator_net_minor", label: "Creator net allocation", description: "Confirmed creator-net allocation in native minor units.", unit: "minor_units", source: "organization_creator_daily", valueColumn: "creator_net_minor", supportedScopes: ["organization"], dimensions: ["creatorUserId", "currency"], minimumCohortSize: 1, freshnessTargetSeconds: 120 }),
  metric({ key: "organization.commerce.management_minor", label: "Management allocation", description: "Confirmed enterprise-management allocation in native minor units.", unit: "minor_units", source: "organization_creator_daily", valueColumn: "enterprise_management_minor", supportedScopes: ["organization"], dimensions: ["creatorUserId", "currency"], minimumCohortSize: 1, freshnessTargetSeconds: 120 }),
  metric({ key: "platform.commerce.confirmed_purchases", label: "Confirmed purchases", description: "All backend-confirmed payment intents in one native currency.", unit: "count", source: "platform_commerce_daily", valueColumn: "confirmed_purchase_count", supportedScopes: ["platform"], dimensions: ["currency"], minimumCohortSize: 1, freshnessTargetSeconds: 120 }),
  metric({ key: "platform.commerce.confirmed_gross_minor", label: "Confirmed gross", description: "Backend-confirmed gross amount in one native currency; never a balance.", unit: "minor_units", source: "platform_commerce_daily", valueColumn: "confirmed_gross_minor", supportedScopes: ["platform"], dimensions: ["currency"], minimumCohortSize: 1, freshnessTargetSeconds: 120 }),
  metric({ key: "platform.commerce.platform_fee_minor", label: "Posted platform fee", description: "Posted platform-fee ledger entries in one native currency.", unit: "minor_units", source: "platform_commerce_daily", valueColumn: "posted_platform_fee_minor", supportedScopes: ["platform"], dimensions: ["currency"], minimumCohortSize: 1, freshnessTargetSeconds: 120 }),
  metric({ key: "platform.commerce.referral_minor", label: "Posted referral commissions", description: "Posted referral-commission ledger entries in one native currency.", unit: "minor_units", source: "platform_commerce_daily", valueColumn: "posted_referral_commission_minor", supportedScopes: ["platform"], dimensions: ["currency"], minimumCohortSize: 1, freshnessTargetSeconds: 120 }),
  metric({ key: "platform.commerce.management_minor", label: "Confirmed management allocation", description: "Confirmed management allocation in one native currency.", unit: "minor_units", source: "platform_commerce_daily", valueColumn: "confirmed_management_allocation_minor", supportedScopes: ["platform"], dimensions: ["currency"], minimumCohortSize: 1, freshnessTargetSeconds: 120 }),
  metric({ key: "platform.operations.moderation_jobs", label: "Moderation jobs", description: "Canonical media moderation jobs created in the selected window.", unit: "count", source: "platform_operations_daily", valueColumn: "moderation_job_count", supportedScopes: ["platform"], dimensions: [], minimumCohortSize: 1, freshnessTargetSeconds: 120 }),
  metric({ key: "platform.operations.moderation_decision_seconds", label: "Moderation decision time", description: "Total bounded seconds from moderation job creation to terminal review state.", unit: "seconds", source: "platform_operations_daily", valueColumn: "moderation_decision_seconds", supportedScopes: ["platform"], dimensions: [], minimumCohortSize: 1, freshnessTargetSeconds: 120 }),
  metric({ key: "platform.operations.provider_failures", label: "Provider failures", description: "Canonical provider events normalized to failed.", unit: "count", source: "platform_operations_daily", valueColumn: "provider_failure_count", supportedScopes: ["platform"], dimensions: [], minimumCohortSize: 1, freshnessTargetSeconds: 120 }),
  metric({ key: "platform.operations.worker_retries", label: "Worker retries", description: "Retry attempts beyond the first lease across canonical worker queues.", unit: "count", source: "platform_operations_daily", valueColumn: "worker_retry_count", supportedScopes: ["platform"], dimensions: [], minimumCohortSize: 1, freshnessTargetSeconds: 120 }),
  metric({ key: "platform.operations.worker_dead_letters", label: "Worker dead letters", description: "Canonical queue jobs in dead-letter state.", unit: "count", source: "platform_operations_daily", valueColumn: "worker_dead_letter_count", supportedScopes: ["platform"], dimensions: [], minimumCohortSize: 1, freshnessTargetSeconds: 120 }),
  metric({ key: "platform.lifecycle.retained_users", label: "Retained active users", description: "Distinct application-session users in one explicit account-creation cohort.", unit: "count", source: "retention_daily", valueColumn: "active_user_count", supportedScopes: ["platform"], dimensions: ["cohortStartDate"], minimumCohortSize: 5, freshnessTargetSeconds: 120 }),
  metric({ key: "platform.onboarding.completed", label: "Completed onboarding", description: "Distinct typed journeys that entered the protected app.", unit: "count", source: "onboarding_daily", valueColumn: "distinct_journey_count", numeratorEvent: "protected_app_entered", supportedScopes: ["platform"], dimensions: [], minimumCohortSize: 5, freshnessTargetSeconds: 120 }),
  metric({ key: "platform.onboarding.step_events", label: "Onboarding step events", description: "Typed onboarding events for one allowlisted event key.", unit: "count", source: "onboarding_daily", valueColumn: "distinct_journey_count", supportedScopes: ["platform"], dimensions: ["onboardingEvent"], minimumCohortSize: 5, freshnessTargetSeconds: 120 }),
  metric({ key: "platform.onboarding.completion_rate", label: "Onboarding completion rate", description: "Protected-app entry journeys divided by onboarding-opened journeys.", unit: "ratio", source: "onboarding_daily", numeratorEvent: "protected_app_entered", denominatorEvent: "onboarding_opened", supportedScopes: ["platform"], dimensions: [], minimumCohortSize: 5, freshnessTargetSeconds: 120 })
].map((definition) => [definition.key, definition]));

export function getMetricDefinition(metricKey: string): AnalyticsMetricDefinition | null {
  return analyticsMetricRegistry.get(metricKey) ?? null;
}
