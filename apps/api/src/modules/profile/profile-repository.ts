import postgres from "postgres";
import type { components } from "@veel/contracts";
import type {
  CreatorMonetisationDashboardResource,
  CreatorOnboardingResource,
  CreatorProfileResource,
  ProfileRepository,
  UserResource
} from "./types.js";

export class ProfileRepositoryConfigurationError extends Error {
  constructor() {
    super("DATABASE_URL_NOT_CONFIGURED");
    this.name = "ProfileRepositoryConfigurationError";
  }
}

export class ProfileHandleConflictError extends Error {
  constructor() {
    super("PROFILE_HANDLE_CONFLICT");
    this.name = "ProfileHandleConflictError";
  }
}

interface ProfileRow {
  id: string;
  handle: string;
  display_name: string;
  avatar_url: string | null;
}

interface CreatorProfileRow extends ProfileRow {
  bio: string | null;
  location_label: string | null;
  content_count: string | number;
  live_room_count: string | number;
  confirmed_payment_count: string | number;
  tips_enabled: boolean;
  content_unlocks_enabled: boolean;
  live_passes_enabled: boolean;
  paid_messages_enabled: boolean;
  subscriptions_enabled: boolean;
}

interface CreatorContentRow {
  id: string;
  media_type: components["schemas"]["ContentItem"]["mediaType"];
  caption: string | null;
  poster_url: string | null;
  nsfw_label: NonNullable<components["schemas"]["ContentItem"]["nsfwLabel"]>;
  creator_id: string;
  handle: string | null;
  display_name: string | null;
  avatar_url: string | null;
}

interface DashboardRow extends ProfileRow {
  state: "active" | "paused" | "blocked";
  earning_state: "not_configured" | "ready" | "review_required" | "held";
  kyc_state: "not_required" | "required" | "pending" | "verified" | "failed";
  tax_profile_state: "not_required" | "required" | "pending" | "verified";
  recipient_wallet_state: "missing" | "linked";
  tips_enabled: boolean;
  content_unlocks_enabled: boolean;
  live_passes_enabled: boolean;
  paid_messages_enabled: boolean;
  subscriptions_enabled: boolean;
}

interface CreatorOnboardingRow {
  id: string;
  handle: string | null;
  display_name: string | null;
  age_state: "not_required" | "required" | "pending" | "verified" | "failed" | null;
  primary_wallet_id: string | null;
  wallet_count: string | number;
  state: "active" | "paused" | "blocked";
  earning_state: "not_configured" | "ready" | "review_required" | "held";
  kyc_state: "not_required" | "required" | "pending" | "verified" | "failed";
  tax_profile_state: "not_required" | "required" | "pending" | "verified";
  earnings_recipient_wallet_id: string | null;
  tips_enabled: boolean;
  content_unlocks_enabled: boolean;
  live_passes_enabled: boolean;
  paid_messages_enabled: boolean;
  subscriptions_enabled: boolean;
}

interface EarningsRow {
  creator_earnings_minor: string | number | null;
  platform_fees_minor: string | number | null;
  referral_commissions_minor: string | number | null;
  confirmed_payment_count: string | number | null;
}

interface ProductRow {
  product_type: components["schemas"]["ProductType"];
  amount_minor: string | number;
  confirmed_payment_count: string | number;
}

interface RecentPaymentRow {
  id: string;
  product_type: components["schemas"]["ProductType"];
  target_id: string;
  amount_minor: string | number;
  currency: components["schemas"]["Currency"];
  state: components["schemas"]["ActivityItem"]["state"];
  confirmed_signature: string | null;
  reference_address: string;
  created_at: Date;
  confirmed_at: Date | null;
}

export function createPostgresProfileRepository(databaseUrl?: string): ProfileRepository {
  if (!databaseUrl) {
    return {
      async upsertMyProfile() {
        throw new ProfileRepositoryConfigurationError();
      },
      async findCreatorProfileByHandle() {
        throw new ProfileRepositoryConfigurationError();
      },
      async getMyCreatorDashboard() {
        throw new ProfileRepositoryConfigurationError();
      },
      async getMyCreatorOnboarding() {
        throw new ProfileRepositoryConfigurationError();
      }
    };
  }

  const sql = postgres(databaseUrl, {
    max: 5,
    idle_timeout: 20,
    prepare: false
  });

  return {
    async upsertMyProfile(supabaseUserId, input): Promise<UserResource> {
      try {
        const rows = await sql<ProfileRow[]>`
          with target_user as (
            select id
            from users
            where supabase_user_id = ${supabaseUserId}
            limit 1
          ),
          upserted_profile as (
            insert into profiles (
              user_id,
              handle,
              display_name,
              bio,
              location_label,
              updated_at
            )
            select
              id,
              ${input.handle},
              ${input.displayName},
              ${input.bio ?? null},
              ${input.locationLabel ?? null},
              now()
            from target_user
            on conflict (user_id) do update set
              handle = excluded.handle,
              display_name = excluded.display_name,
              bio = excluded.bio,
              location_label = excluded.location_label,
              updated_at = now()
            returning user_id, handle, display_name, avatar_url
          )
          select
            up.user_id as id,
            up.handle,
            up.display_name,
            up.avatar_url
          from upserted_profile up
          limit 1
        `;

        const row = rows[0];

        if (!row) {
          throw new ProfileRepositoryConfigurationError();
        }

        return toUserResource(row);
      } catch (error) {
        if (isUniqueViolation(error)) {
          throw new ProfileHandleConflictError();
        }

        throw error;
      }
    },
    async findCreatorProfileByHandle(handle): Promise<CreatorProfileResource | null> {
      const rows = await sql<CreatorProfileRow[]>`
        select
          u.id,
          p.handle,
          p.display_name,
          p.avatar_url,
          p.bio,
          p.location_label,
          coalesce(cms.tips_enabled, true) as tips_enabled,
          coalesce(cms.content_unlocks_enabled, true) as content_unlocks_enabled,
          coalesce(cms.live_passes_enabled, true) as live_passes_enabled,
          coalesce(cms.paid_messages_enabled, true) as paid_messages_enabled,
          coalesce(cms.subscriptions_enabled, false) as subscriptions_enabled,
          (
            select count(*)
            from content_items ci
            where ci.creator_user_id = u.id
              and ci.state = 'ready'
              and ci.visibility = 'public'
              and ci.moderation_state = 'approved'
          ) as content_count,
          (
            select count(*)
            from live_rooms lr
            where lr.creator_user_id = u.id
              and lr.state <> 'deleted'
          ) as live_room_count,
          (
            select count(distinct pi.id)
            from payment_intents pi
            left join content_items ci on ci.id = pi.target_id
            left join live_rooms lr on lr.id = pi.target_id
            where pi.state = 'confirmed'
              and (
                pi.target_id = u.id
                or ci.creator_user_id = u.id
                or lr.creator_user_id = u.id
              )
          ) as confirmed_payment_count
        from profiles p
        join users u on u.id = p.user_id
        left join creator_monetisation_settings cms on cms.user_id = u.id
        where lower(p.handle) = lower(${handle})
          and p.visibility = 'public'
          and u.state = 'active'
        limit 1
      `;
      const row = rows[0];

      if (!row) {
        return null;
      }

      const recentContent = await sql<CreatorContentRow[]>`
        select
          ci.id,
          ci.media_type,
          ci.caption,
          ci.nsfw_label,
          ma.poster_url,
          u.id as creator_id,
          p.handle,
          p.display_name,
          p.avatar_url
        from content_items ci
        join users u on u.id = ci.creator_user_id
        join profiles p on p.user_id = u.id
        left join lateral (
          select poster_url
          from media_assets
          where content_item_id = ci.id
          order by created_at asc
          limit 1
        ) ma on true
        where ci.creator_user_id = ${row.id}
          and ci.state = 'ready'
          and ci.visibility = 'public'
          and ci.moderation_state = 'approved'
        order by ci.created_at desc
        limit 12
      `;

      return toCreatorProfile(row, recentContent);
    },
    async getMyCreatorDashboard(supabaseUserId): Promise<CreatorMonetisationDashboardResource | null> {
      const dashboardRows = await sql<DashboardRow[]>`
        with target_user as (
          select u.id
          from users u
          where u.supabase_user_id = ${supabaseUserId}
          limit 1
        ),
        ensured_settings as (
          insert into creator_monetisation_settings (user_id)
          select id from target_user
          on conflict (user_id) do update set updated_at = creator_monetisation_settings.updated_at
          returning *
        )
        select
          u.id,
          p.handle,
          p.display_name,
          p.avatar_url,
          es.state,
          es.earning_state,
          es.kyc_state,
          es.tax_profile_state,
          case when es.earnings_recipient_wallet_id is null then 'missing' else 'linked' end as recipient_wallet_state,
          es.tips_enabled,
          es.content_unlocks_enabled,
          es.live_passes_enabled,
          es.paid_messages_enabled,
          es.subscriptions_enabled
        from ensured_settings es
        join users u on u.id = es.user_id
        join profiles p on p.user_id = u.id
        limit 1
      `;
      const dashboard = dashboardRows[0];

      if (!dashboard) {
        return null;
      }

      const [earningsRows, productRows, recentPaymentRows] = await Promise.all([
        sql<EarningsRow[]>`
          with creator_payments as (
            select distinct payment_intent_id
            from payment_ledger_entries
            where account_user_id = ${dashboard.id}
              and account_kind = 'creator_earning'
          )
          select
            (
              select coalesce(sum(amount_minor), 0)
              from payment_ledger_entries
              where account_user_id = ${dashboard.id}
                and account_kind = 'creator_earning'
                and state = 'posted'
            ) as creator_earnings_minor,
            (
              select coalesce(sum(ple.amount_minor), 0)
              from payment_ledger_entries ple
              join creator_payments cp on cp.payment_intent_id = ple.payment_intent_id
              where ple.account_kind = 'platform_fee'
                and ple.state = 'posted'
            ) as platform_fees_minor,
            (
              select coalesce(sum(amount_minor), 0)
              from referral_commissions
              where referrer_user_id = ${dashboard.id}
                and state in ('pending', 'posted', 'earned')
            ) as referral_commissions_minor,
            (
              select count(*)
              from creator_payments
            ) as confirmed_payment_count
        `,
        sql<ProductRow[]>`
          with creator_targets as (
            select id from content_items where creator_user_id = ${dashboard.id}
            union
            select id from live_rooms where creator_user_id = ${dashboard.id}
            union
            select ${dashboard.id}::uuid as id
          )
          select
            pi.product_type,
            coalesce(sum(pi.amount_minor), 0) as amount_minor,
            count(*) as confirmed_payment_count
          from payment_intents pi
          join creator_targets ct on ct.id = pi.target_id
          where pi.state = 'confirmed'
          group by pi.product_type
          order by pi.product_type
        `,
        sql<RecentPaymentRow[]>`
          with creator_targets as (
            select id from content_items where creator_user_id = ${dashboard.id}
            union
            select id from live_rooms where creator_user_id = ${dashboard.id}
            union
            select ${dashboard.id}::uuid as id
          )
          select
            pi.id,
            pi.product_type,
            pi.target_id,
            pi.amount_minor,
            pi.currency,
            pi.state,
            pi.confirmed_signature,
            pi.reference_address,
            pi.created_at,
            pi.confirmed_at
          from payment_intents pi
          join creator_targets ct on ct.id = pi.target_id
          order by pi.created_at desc
          limit 10
        `
      ]);

      return toCreatorDashboard(dashboard, earningsRows[0], productRows, recentPaymentRows);
    },
    async getMyCreatorOnboarding(supabaseUserId): Promise<CreatorOnboardingResource | null> {
      const rows = await sql<CreatorOnboardingRow[]>`
        with target_user as (
          select u.id
          from users u
          where u.supabase_user_id = ${supabaseUserId}
          limit 1
        ),
        ensured_settings as (
          insert into creator_monetisation_settings (user_id)
          select id from target_user
          on conflict (user_id) do update set updated_at = creator_monetisation_settings.updated_at
          returning *
        )
        select
          u.id,
          p.handle,
          p.display_name,
          latest_age.state as age_state,
          primary_wallet.id as primary_wallet_id,
          (
            select count(*)
            from wallets w
            where w.user_id = u.id
          ) as wallet_count,
          es.state,
          es.earning_state,
          es.kyc_state,
          es.tax_profile_state,
          es.earnings_recipient_wallet_id,
          es.tips_enabled,
          es.content_unlocks_enabled,
          es.live_passes_enabled,
          es.paid_messages_enabled,
          es.subscriptions_enabled
        from ensured_settings es
        join users u on u.id = es.user_id
        left join profiles p on p.user_id = u.id
        left join lateral (
          select av.state
          from age_verifications av
          where av.user_id = u.id
          order by av.created_at desc
          limit 1
        ) latest_age on true
        left join lateral (
          select w.id
          from wallets w
          where w.user_id = u.id
          order by w.is_primary desc, w.created_at asc
          limit 1
        ) primary_wallet on true
        limit 1
      `;
      const row = rows[0];

      return row ? toCreatorOnboarding(row) : null;
    },
    async close() {
      await sql.end({ timeout: 5 });
    }
  };
}

function toUserResource(row: ProfileRow): UserResource {
  return {
    id: row.id,
    handle: row.handle,
    displayName: row.display_name,
    avatarUrl: row.avatar_url,
    badges: []
  };
}

function toCreatorProfile(
  row: CreatorProfileRow,
  recentContent: CreatorContentRow[]
): CreatorProfileResource {
  return {
    user: toUserResource(row),
    bio: row.bio,
    locationLabel: row.location_label,
    stats: {
      contentCount: Number(row.content_count),
      liveRoomCount: Number(row.live_room_count),
      confirmedPaymentCount: Number(row.confirmed_payment_count),
      followerCount: 0
    },
    monetisation: {
      tipsEnabled: row.tips_enabled,
      contentUnlocksEnabled: row.content_unlocks_enabled,
      livePassesEnabled: row.live_passes_enabled,
      paidMessagesEnabled: row.paid_messages_enabled,
      subscriptionsEnabled: row.subscriptions_enabled
    },
    recentContent: recentContent.map(toContentItem)
  };
}

function toCreatorDashboard(
  row: DashboardRow,
  earnings: EarningsRow | undefined,
  products: ProductRow[],
  recentPayments: RecentPaymentRow[]
): CreatorMonetisationDashboardResource {
  const blockedReasons: string[] = [];

  if (row.recipient_wallet_state === "missing") {
    blockedReasons.push("earnings_recipient_wallet_required");
  }
  if (row.state !== "active") {
    blockedReasons.push(`creator_state_${row.state}`);
  }
  if (row.earning_state !== "ready") {
    blockedReasons.push(`earning_state_${row.earning_state}`);
  }
  const canMonetize = blockedReasons.length === 0;

  return {
    creator: toUserResource(row),
    readiness: {
      state: row.state,
      earningState: row.earning_state,
      kycState: row.kyc_state,
      taxProfileState: row.tax_profile_state,
      recipientWalletState: row.recipient_wallet_state,
      readinessScore: readinessScoreForDashboard(row),
      canMonetize,
      nextAction: canMonetize ? null : nextActionForDashboard(row),
      policyBoundary: "creator_records_only_no_balances_payout_queue_or_social_priority",
      blockedReasons
    },
    earnings: {
      currency: "SOL",
      creatorEarningsMinor: Number(earnings?.creator_earnings_minor ?? 0),
      platformFeesMinor: Number(earnings?.platform_fees_minor ?? 0),
      referralCommissionsMinor: Number(earnings?.referral_commissions_minor ?? 0),
      confirmedPaymentCount: Number(earnings?.confirmed_payment_count ?? 0)
    },
    products: productSummaries(row, products),
    recentActivity: recentPayments.map(toActivityItem)
  };
}

function toCreatorOnboarding(row: CreatorOnboardingRow): CreatorOnboardingResource {
  const hasProfile = Boolean(row.handle && row.display_name);
  const hasWallet = Boolean(row.primary_wallet_id) || Number(row.wallet_count) > 0;
  const productsEnabled = [
    row.tips_enabled,
    row.content_unlocks_enabled,
    row.live_passes_enabled,
    row.paid_messages_enabled,
    row.subscriptions_enabled
  ].some(Boolean);

  const steps: CreatorOnboardingResource["steps"] = [
    {
      key: "profile",
      label: "Profile",
      state: hasProfile ? "complete" : "action_required",
      required: true,
      actionHref: hasProfile ? null : "/settings"
    },
    {
      key: "age",
      label: "Age verification",
      state: stateForAge(row.age_state),
      required: true,
      actionHref: row.age_state === "verified" ? null : "/age"
    },
    {
      key: "wallet",
      label: "Wallet",
      state: hasWallet ? "complete" : "action_required",
      required: true,
      actionHref: hasWallet ? null : "/wallet"
    },
    {
      key: "kyc",
      label: "Creator verification",
      state: stateForKyc(row.kyc_state),
      required: row.kyc_state !== "not_required",
      actionHref: hrefForComplianceState(row.kyc_state, "/settings")
    },
    {
      key: "tax_profile",
      label: "Tax profile",
      state: stateForTax(row.tax_profile_state),
      required: row.tax_profile_state !== "not_required",
      actionHref: hrefForComplianceState(row.tax_profile_state, "/settings")
    },
    {
      key: "recipient_wallet",
      label: "Earnings wallet",
      state: row.earnings_recipient_wallet_id ? "complete" : "action_required",
      required: true,
      actionHref: row.earnings_recipient_wallet_id ? null : "/wallet"
    },
    {
      key: "products",
      label: "Products",
      state: productsEnabled ? "complete" : "action_required",
      required: true,
      actionHref: productsEnabled ? null : "/profile"
    }
  ];

  const requiredStepsReady = steps
    .filter((step) => step.required)
    .every((step) => step.state === "complete" || step.state === "not_required");
  const hasBlockedStep = steps.some((step) => step.state === "blocked");
  const hasReviewStep = steps.some((step) => step.state === "review_required");

  const state: CreatorOnboardingResource["state"] =
    row.state === "blocked" || row.earning_state === "held" || hasBlockedStep
      ? "blocked"
      : row.earning_state === "review_required" || hasReviewStep
        ? "review_required"
        : row.state === "active" && row.earning_state === "ready" && requiredStepsReady
          ? "ready"
          : "action_required";

  const nextStep = steps.find(
    (step) =>
      step.state === "action_required" ||
      step.state === "review_required" ||
      step.state === "blocked"
  );

  return {
    state,
    canStartEarning: state === "ready",
    readinessScore: readinessScoreForSteps(steps),
    nextAction: nextStep?.actionHref ?? null,
    policyBoundary: "creator_records_only_no_balances_payout_queue_or_social_priority",
    steps
  };
}

function readinessScoreForDashboard(row: DashboardRow): number {
  const checks = [
    row.state === "active",
    row.earning_state === "ready",
    row.kyc_state === "not_required" || row.kyc_state === "verified",
    row.tax_profile_state === "not_required" || row.tax_profile_state === "verified",
    row.recipient_wallet_state === "linked"
  ];

  return Math.round((checks.filter(Boolean).length / checks.length) * 100);
}

function nextActionForDashboard(row: DashboardRow): string | null {
  if (row.state !== "active") {
    return "/profile";
  }
  if (row.earning_state !== "ready") {
    return "/profile";
  }
  if (row.kyc_state === "required" || row.kyc_state === "failed") {
    return "/settings";
  }
  if (row.tax_profile_state === "required") {
    return "/settings";
  }
  if (row.recipient_wallet_state === "missing") {
    return "/wallet";
  }

  return null;
}

function readinessScoreForSteps(steps: CreatorOnboardingResource["steps"]): number {
  const requiredSteps = steps.filter((step) => step.required);
  if (requiredSteps.length === 0) {
    return 100;
  }

  const completeSteps = requiredSteps.filter((step) => step.state === "complete" || step.state === "not_required");
  return Math.round((completeSteps.length / requiredSteps.length) * 100);
}

function stateForAge(
  state: CreatorOnboardingRow["age_state"]
): CreatorOnboardingResource["steps"][number]["state"] {
  if (state === "verified") {
    return "complete";
  }
  if (state === "pending") {
    return "review_required";
  }
  if (state === "failed") {
    return "blocked";
  }
  return "action_required";
}

function stateForKyc(
  state: CreatorOnboardingRow["kyc_state"]
): CreatorOnboardingResource["steps"][number]["state"] {
  if (state === "not_required") {
    return "not_required";
  }
  if (state === "verified") {
    return "complete";
  }
  if (state === "pending") {
    return "review_required";
  }
  if (state === "failed") {
    return "blocked";
  }
  return "action_required";
}

function stateForTax(
  state: CreatorOnboardingRow["tax_profile_state"]
): CreatorOnboardingResource["steps"][number]["state"] {
  if (state === "not_required") {
    return "not_required";
  }
  if (state === "verified") {
    return "complete";
  }
  if (state === "pending") {
    return "review_required";
  }
  return "action_required";
}

function hrefForComplianceState(
  state: CreatorOnboardingRow["kyc_state"] | CreatorOnboardingRow["tax_profile_state"],
  href: string
): string | null {
  return state === "required" || state === "failed" ? href : null;
}

function productSummaries(
  row: DashboardRow,
  products: ProductRow[]
): CreatorMonetisationDashboardResource["products"] {
  const enabledByProduct: Partial<Record<components["schemas"]["ProductType"], boolean>> = {
    tip: row.tips_enabled,
    support: row.tips_enabled,
    content_unlock: row.content_unlocks_enabled,
    live_pass: row.live_passes_enabled,
    paid_message: row.paid_messages_enabled,
    creator_subscription: row.subscriptions_enabled
  };
  const productRows = new Map(products.map((product) => [product.product_type, product]));

  return (Object.keys(enabledByProduct) as components["schemas"]["ProductType"][]).map(
    (productType) => {
      const product = productRows.get(productType);

      return {
        productType,
        enabled: Boolean(enabledByProduct[productType]),
        confirmedPaymentCount: Number(product?.confirmed_payment_count ?? 0),
        amountMinor: Number(product?.amount_minor ?? 0),
        currency: "SOL"
      };
    }
  );
}

function toActivityItem(row: RecentPaymentRow): components["schemas"]["ActivityItem"] {
  return {
    id: row.id,
    kind: "payment_intent",
    title: titleForProduct(row.product_type),
    state: row.state,
    productType: row.product_type,
    targetId: row.target_id,
    amountMinor: Number(row.amount_minor),
    currency: row.currency,
    paymentIntentId: row.id,
    signature: row.confirmed_signature,
    referenceAddress: row.reference_address,
    createdAt: row.created_at.toISOString(),
    confirmedAt: row.confirmed_at?.toISOString() ?? null
  };
}

function toContentItem(row: CreatorContentRow): components["schemas"]["ContentItem"] {
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

function titleForProduct(productType: components["schemas"]["ProductType"]): string {
  return productType
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "23505"
  );
}
