import postgres from "postgres";
import type {
  CreatorMonetisationDashboardResource,
  CreatorOnboardingResource,
  CreatorProfileResource,
  ProfileRepository,
  UserResource
} from "./types.js";
import type { CreatorContentRow, CreatorOnboardingRow, CreatorProfileRow, DashboardRow, EarningsRow, ProductRow, ProfileRow, RecentPaymentRow } from "./profile-repository-rows.js";
import { toCreatorDashboard, toCreatorOnboarding, toCreatorProfile, toUserResource } from "./profile-repository-mappers.js";

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

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "23505"
  );
}
