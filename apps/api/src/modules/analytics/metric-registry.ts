import type { AnalyticsDimensions, AnalyticsScope } from "./types.js";

export const analyticsDefinitionVersion = 1;
export const analyticsProjectionKey = "analytics_core";

export type AnalyticsMetricSource = "creator_daily" | "creator_content_daily" | "creator_product_daily" | "organization_creator_daily";

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
  supportedScopes: AnalyticsScope["type"][];
  dimensions: (keyof AnalyticsDimensions)[];
  minimumCohortSize: number;
  freshnessTargetSeconds: number;
}

function metric(input: Omit<AnalyticsMetricDefinition, "definitionVersion">): AnalyticsMetricDefinition {
  return { ...input, definitionVersion: analyticsDefinitionVersion };
}

export const analyticsMetricRegistry = new Map<string, AnalyticsMetricDefinition>([
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
  metric({ key: "creator.commerce.confirmed_purchases", label: "Confirmed purchases", description: "Backend-confirmed payment intents, grouped without combining currencies.", unit: "count", source: "creator_product_daily", valueColumn: "confirmed_purchase_count", supportedScopes: ["creator"], dimensions: ["currency", "productType"], minimumCohortSize: 1, freshnessTargetSeconds: 60 }),
  metric({ key: "creator.commerce.confirmed_gross_minor", label: "Confirmed gross", description: "Backend-confirmed gross amount in native minor units; never a balance.", unit: "minor_units", source: "creator_product_daily", valueColumn: "confirmed_gross_minor", supportedScopes: ["creator"], dimensions: ["currency", "productType"], minimumCohortSize: 1, freshnessTargetSeconds: 60 }),
  metric({ key: "creator.commerce.earnings_minor", label: "Confirmed creator earnings", description: "Posted creator-earning ledger entries in native minor units; never withdrawable balance state.", unit: "minor_units", source: "creator_product_daily", valueColumn: "creator_earnings_minor", supportedScopes: ["creator"], dimensions: ["currency", "productType"], minimumCohortSize: 1, freshnessTargetSeconds: 60 }),
  metric({ key: "creator.commerce.platform_fee_minor", label: "Posted platform fee", description: "Posted platform-fee ledger entries associated with creator transactions.", unit: "minor_units", source: "creator_product_daily", valueColumn: "platform_fee_minor", supportedScopes: ["creator"], dimensions: ["currency", "productType"], minimumCohortSize: 1, freshnessTargetSeconds: 60 }),
  metric({ key: "organization.commerce.confirmed_allocations", label: "Confirmed managed allocations", description: "Confirmed managed-creator allocation records.", unit: "count", source: "organization_creator_daily", valueColumn: "confirmed_allocation_count", supportedScopes: ["organization"], dimensions: ["creatorUserId", "currency"], minimumCohortSize: 1, freshnessTargetSeconds: 120 }),
  metric({ key: "organization.commerce.creator_net_minor", label: "Creator net allocation", description: "Confirmed creator-net allocation in native minor units.", unit: "minor_units", source: "organization_creator_daily", valueColumn: "creator_net_minor", supportedScopes: ["organization"], dimensions: ["creatorUserId", "currency"], minimumCohortSize: 1, freshnessTargetSeconds: 120 }),
  metric({ key: "organization.commerce.management_minor", label: "Management allocation", description: "Confirmed enterprise-management allocation in native minor units.", unit: "minor_units", source: "organization_creator_daily", valueColumn: "enterprise_management_minor", supportedScopes: ["organization"], dimensions: ["creatorUserId", "currency"], minimumCohortSize: 1, freshnessTargetSeconds: 120 })
].map((definition) => [definition.key, definition]));

export function getMetricDefinition(metricKey: string): AnalyticsMetricDefinition | null {
  return analyticsMetricRegistry.get(metricKey) ?? null;
}
