import { randomUUID } from "node:crypto";
import postgres from "postgres";
import type {
  AdminAgeCheck,
  AdminAiSession,
  AdminAiToolCall,
  AdminComplianceLedgerEntry,
  AdminComplianceReport,
  AdminContentItem,
  AdminDataRequest,
  AdminMutualsSafety,
  AdminFeatureFlag,
  AdminInvoice,
  AdminLiveRoom,
  AdminMediaAsset,
  AdminIdentityCheck,
  AdminNotificationHealth,
  AdminOpsSummary,
  AdminOrganization,
  AdminOrganizationMember,
  AdminPartnerCampaign,
  AdminPaymentIntent,
  AdminProviderEvent,
  AdminReceipt,
  AdminReport,
  AdminRepository,
  AdminRefundDispute,
  AdminReferralProgram,
  AdminSupportCase,
  AdminSupportPolicy,
  AdminTierWaiver,
  AdminUser,
  AdminVatDetermination,
  AdminUnlock,
  AuditEvent,
  Event,
  EventTicketType,
  Ticket
} from "./types.js";

export class AdminRepositoryConfigurationError extends Error {
  constructor() {
    super("DATABASE_URL_NOT_CONFIGURED");
    this.name = "AdminRepositoryConfigurationError";
  }
}

export class AdminRepositoryStateConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AdminRepositoryStateConflictError";
  }
}

interface CountRow {
  total: string | number;
  pending: string | number;
  submitted: string | number;
  confirmed: string | number;
  failed: string | number;
}

interface NotificationHealthRow {
  unread_count: string | number;
  read_count: string | number;
  archived_count: string | number;
  active_device_count: string | number;
  revoked_device_count: string | number;
  push_enabled_preference_count: string | number;
  queued_delivery_count: string | number;
  leased_delivery_count: string | number;
  delivered_delivery_count: string | number;
  failed_delivery_count: string | number;
  skipped_delivery_count: string | number;
  revoked_delivery_count: string | number;
  latest_notification_at: Date | null;
  latest_device_seen_at: Date | null;
  latest_delivery_at: Date | null;
}

interface AdminUserRow {
  id: string;
  handle: string;
  state: AdminUser["state"];
  age_state: AdminUser["ageState"];
  wallet_connected: boolean;
  wallet_chain: AdminUser["walletState"]["chain"] | null;
  wallet_address: string | null;
  created_at: Date;
}

interface AdminContentRow {
  id: string;
  creator_id: string;
  handle: string;
  display_name: string;
  avatar_url: string | null;
  moderation_state: string;
  state: AdminContentItem["state"];
  created_at: Date;
}

interface AdminReportRow {
  id: string;
  subject_type: string;
  subject_id: string;
  state: AdminReport["state"];
  reason: string;
  created_at: Date;
}

interface PaymentRow {
  id: string;
  product_type: AdminPaymentIntent["productType"];
  amount_minor: string | number;
  currency: AdminPaymentIntent["currency"];
  state: AdminPaymentIntent["state"];
  user_id: string;
  target_id: string;
  reference_address: string;
  submitted_signature: string | null;
  confirmed_signature: string | null;
  settlement_attempt_count: string | number;
  entitlement_id: string | null;
  created_at: Date;
  confirmed_at: Date | null;
}

interface UnlockRow {
  id: string;
  user_id: string;
  target_type: AdminUnlock["targetType"];
  target_id: string;
  product_type: AdminUnlock["productType"];
  payment_intent_id: string | null;
  state: AdminUnlock["state"];
  granted_at: Date;
  expires_at: Date | null;
}

interface ProviderEventRow {
  id: string;
  provider: string;
  event_type: string;
  normalized_state: AdminProviderEvent["state"];
  received_at: Date;
  processed_at: Date | null;
  latest_replay_state: AdminProviderEvent["latestReplayState"];
  latest_replay_requested_at: Date | null;
  latest_replay_processed_at: Date | null;
}

interface LiveRoomRow {
  id: string;
  creator_user_id: string;
  title: string;
  provider: AdminLiveRoom["provider"];
  provider_stream_id: string | null;
  provider_playback_id: string | null;
  provider_state: string;
  state: AdminLiveRoom["state"];
  access_rule: AdminLiveRoom["accessRule"];
  pass_price_minor: string | number;
  currency: AdminLiveRoom["currency"];
  has_playback_url: boolean;
  has_host_stream_key: boolean;
  starts_at: Date | null;
  ended_at: Date | null;
  created_at: Date;
  updated_at: Date | null;
}

interface MediaAssetRow {
  id: string;
  content_item_id: string;
  provider: AdminMediaAsset["provider"];
  provider_asset_id: string;
  provider_state: string;
  provider_playable: boolean;
  has_playback_url: boolean;
  ready_at: Date | null;
  provider_checked_at: Date | null;
  created_at: Date;
}

interface AgeCheckRow {
  id: string;
  user_id: string;
  provider: string;
  provider_reference: string;
  state: AdminAgeCheck["state"];
  jurisdiction: string | null;
  rule: string | null;
  has_provider_reference: boolean;
  verified_at: Date | null;
  expires_at: Date | null;
  created_at: Date;
}

interface IdentityCheckRow {
  id: string;
  user_id: string;
  provider: string;
  provider_reference: string;
  verification_type: AdminIdentityCheck["verificationType"];
  state: AdminIdentityCheck["state"];
  country_code: string | null;
  document_type: string | null;
  liveness_state: string | null;
  wallet_ownership_state: string | null;
  has_provider_reference: boolean;
  has_legal_name_hash: boolean;
  verified_at: Date | null;
  expires_at: Date | null;
  created_at: Date;
}

interface AiSessionRow {
  id: string;
  actor_user_id: string;
  scope: AdminAiSession["scope"];
  state: AdminAiSession["state"];
  allowed_tool_count: string | number;
  created_at: Date;
  expires_at: Date;
}

interface AiToolCallRow {
  id: string;
  session_id: string;
  actor_user_id: string;
  scope: AdminAiToolCall["scope"];
  tool_name: AdminAiToolCall["toolName"];
  state: AdminAiToolCall["state"];
  confirmation_state: AdminAiToolCall["confirmationState"];
  subject_type: Exclude<AdminAiToolCall["subjectType"], undefined>;
  subject_id: string | null;
  input_summary: string;
  output_summary: string;
  created_at: Date;
}

interface AuditEventRow {
  id: string;
  subject_type: string;
  action: string;
  created_at: Date;
}

interface SupportCaseRow {
  id: string;
  organization_id: string | null;
  requester_user_id: string | null;
  assigned_staff_user_id: string | null;
  subject_type: string;
  subject_id: string | null;
  category: AdminSupportCase["category"];
  state: AdminSupportCase["state"];
  priority: AdminSupportCase["priority"];
  created_at: Date;
  updated_at: Date | null;
  closed_at: Date | null;
}

interface SupportPolicyRow {
  id: string;
  organization_id: string;
  support_state: AdminSupportPolicy["supportState"];
  sla_tier: AdminSupportPolicy["slaTier"];
  state: AdminSupportPolicy["state"];
  policy_reason: string | null;
  money_boundary: AdminSupportPolicy["moneyBoundary"];
  created_at: Date;
  updated_at: Date;
}

interface RefundDisputeRow {
  id: string;
  payment_intent_id: string;
  entitlement_id: string | null;
  reporter_user_id: string;
  kind: AdminRefundDispute["kind"];
  requested_action: AdminRefundDispute["requestedAction"];
  state: AdminRefundDispute["state"];
  resolution: string | null;
  custody_boundary: AdminRefundDispute["custodyBoundary"];
  created_at: Date;
  updated_at: Date | null;
  resolved_at: Date | null;
}

interface DataRequestRow {
  id: string;
  requester_user_id: string;
  type: AdminDataRequest["type"];
  state: AdminDataRequest["state"];
  privacy_boundary: AdminDataRequest["privacyBoundary"];
  created_at: Date;
  updated_at: Date | null;
  completed_at: Date | null;
}

interface EventRow {
  id: string;
  title: string;
  description: string | null;
  starts_at: Date;
  ends_at: Date | null;
  access_rule: Event["accessRule"];
  location_type: Event["location"]["type"];
  location_label: string | null;
  location_lat: string | number | null;
  location_lng: string | number | null;
  state: Event["state"];
  created_at: Date;
}

interface EventTicketTypeRow {
  id: string;
  event_id: string;
  label: string;
  price_minor: string | number | null;
  currency: EventTicketType["currency"];
  capacity: number;
  sale_starts_at: Date | null;
  sale_ends_at: Date | null;
  per_user_limit: number;
  state: EventTicketType["state"];
  issued_count: string | number;
}

interface TicketRow {
  id: string;
  event_id: string;
  ticket_type_id: string;
  holder_user_id: string;
  payment_intent_id: string | null;
  state: Ticket["state"];
  checked_in_at: Date | null;
  created_at: Date;
}

interface ComplianceLedgerRow {
  id: string;
  event_type: AdminComplianceLedgerEntry["eventType"];
  product_type: AdminComplianceLedgerEntry["productType"];
  settlement_model: AdminComplianceLedgerEntry["settlementModel"];
  seller_user_id: string | null;
  buyer_user_id: string | null;
  payment_intent_id: string | null;
  entitlement_id: string | null;
  receipt_id: string | null;
  vat_invoice_id: string | null;
  gross_amount_minor: string | number;
  platform_fee_minor: string | number | null;
  creator_net_amount_minor: string | number | null;
  tax_amount_minor: string | number | null;
  currency: AdminComplianceLedgerEntry["currency"];
  fiat_currency: string;
  fx_rate: string | null;
  seller_country: string | null;
  buyer_country: string | null;
  seller_of_record: AdminComplianceLedgerEntry["sellerOfRecord"];
  vat_status: AdminComplianceLedgerEntry["vatStatus"];
  dac7_reportable: boolean;
  carf_reportable: boolean;
  immutable_hash: string | null;
  created_at: Date;
}

interface ComplianceReportRow {
  id: string;
  reporting_year: string | number;
  jurisdiction: string | null;
  state: AdminComplianceReport["state"];
  line_count: string | number;
  export_id: string | null;
  carf_reporting_required?: boolean | null;
  created_at: Date;
  exported_at: Date | null;
}

interface VatDeterminationRow {
  id: string;
  product_type: AdminVatDetermination["productType"];
  seller_of_record: AdminVatDetermination["sellerOfRecord"];
  buyer_country: string | null;
  seller_country: string | null;
  buyer_vat_id_hash: string | null;
  vies_status: AdminVatDetermination["viesStatus"];
  place_of_supply: string | null;
  vat_status: AdminVatDetermination["vatStatus"];
  vat_rate_bps: string | number | null;
  vat_amount_minor: string | number | null;
  review_state: AdminVatDetermination["reviewState"];
  created_at: Date;
}

interface ReceiptRow {
  id: string;
  receipt_number: string;
  product_type: AdminReceipt["productType"];
  buyer_user_id: string | null;
  seller_user_id: string | null;
  payment_intent_id: string | null;
  gross_amount_minor: string | number;
  currency: AdminReceipt["currency"];
  state: AdminReceipt["state"];
  issued_at: Date;
}

interface InvoiceRow {
  id: string;
  invoice_number: string;
  seller_of_record: AdminInvoice["sellerOfRecord"];
  buyer_user_id: string | null;
  seller_user_id: string | null;
  total_amount_minor: string | number;
  vat_amount_minor: string | number;
  currency: AdminInvoice["currency"];
  state: AdminInvoice["state"];
  issued_at: Date;
}

interface ReferralProgramRow {
  id: string;
  name: string;
  state: AdminReferralProgram["state"];
  priority: AdminReferralProgram["priority"];
  commission_source: AdminReferralProgram["commissionSource"];
  created_at: Date;
}

interface PartnerCampaignRow {
  id: string;
  name: string;
  partner_name: string;
  state: AdminPartnerCampaign["state"];
  contract_id: string | null;
  created_at: Date;
}

interface TierWaiverRow {
  id: string;
  subject_type: AdminTierWaiver["subjectType"];
  subject_id: string;
  tier_key: AdminTierWaiver["tierKey"];
  state: AdminTierWaiver["state"];
  starts_at: Date;
  ends_at: Date | null;
}

interface OrganizationRow {
  id: string;
  name: string;
  state: AdminOrganization["state"];
  plan: AdminOrganization["plan"];
  kyb_state: AdminOrganization["kybState"];
  created_at: Date;
}

interface OrganizationMemberRow {
  id: string;
  organization_id: string;
  user_id: string;
  role: AdminOrganizationMember["role"];
  state: AdminOrganizationMember["state"];
  invited_by_user_id: string | null;
  joined_at: Date | null;
  created_at: Date;
  updated_at: Date | null;
}

interface FeatureFlagRow {
  key: string;
  value: AdminFeatureFlag["value"];
  category: AdminFeatureFlag["category"];
  policy_boundary: AdminFeatureFlag["policyBoundary"];
  state: AdminFeatureFlag["state"];
  updated_at: Date;
}

interface LockedOrganizationMemberRow extends OrganizationMemberRow {
  active_owner_count: string | number;
}

const pageSize = 50;

export function createPostgresAdminRepository(databaseUrl?: string): AdminRepository {
  if (!databaseUrl) {
    return {
      async hasAdminAccess() {
        throw new AdminRepositoryConfigurationError();
      },
      async getOpsSummary() {
        throw new AdminRepositoryConfigurationError();
      },
      async getNotificationHealth() {
        throw new AdminRepositoryConfigurationError();
      },
      async listUsers() {
        throw new AdminRepositoryConfigurationError();
      },
      async getUser() {
        throw new AdminRepositoryConfigurationError();
      },
      async listContent() {
        throw new AdminRepositoryConfigurationError();
      },
      async updateContentModeration() {
        throw new AdminRepositoryConfigurationError();
      },
      async listReports() {
        throw new AdminRepositoryConfigurationError();
      },
      async updateReport() {
        throw new AdminRepositoryConfigurationError();
      },
      async listPaymentIntents() {
        throw new AdminRepositoryConfigurationError();
      },
      async listUnlocks() {
        throw new AdminRepositoryConfigurationError();
      },
      async listProviderEvents() {
        throw new AdminRepositoryConfigurationError();
      },
      async enqueueProviderEventReplay() {
        throw new AdminRepositoryConfigurationError();
      },
      async listAuditEvents() {
        throw new AdminRepositoryConfigurationError();
      },
      async listSupportCases() {
        throw new AdminRepositoryConfigurationError();
      },
      async updateSupportCase() {
        throw new AdminRepositoryConfigurationError();
      },
      async listSupportPolicies() {
        throw new AdminRepositoryConfigurationError();
      },
      async updateSupportPolicy() {
        throw new AdminRepositoryConfigurationError();
      },
      async listRefundDisputes() {
        throw new AdminRepositoryConfigurationError();
      },
      async updateRefundDispute() {
        throw new AdminRepositoryConfigurationError();
      },
      async listDataRequests() {
        throw new AdminRepositoryConfigurationError();
      },
      async updateDataRequest() {
        throw new AdminRepositoryConfigurationError();
      },
      async listEvents() {
        throw new AdminRepositoryConfigurationError();
      },
      async listTickets() {
        throw new AdminRepositoryConfigurationError();
      },
      async listLiveRooms() {
        throw new AdminRepositoryConfigurationError();
      },
      async listMediaAssets() {
        throw new AdminRepositoryConfigurationError();
      },
      async listAgeChecks() {
        throw new AdminRepositoryConfigurationError();
      },
      async listIdentityChecks() {
        throw new AdminRepositoryConfigurationError();
      },
      async listAiSessions() {
        throw new AdminRepositoryConfigurationError();
      },
      async listAiToolCalls() {
        throw new AdminRepositoryConfigurationError();
      },
      async getMutualsSafety() {
        throw new AdminRepositoryConfigurationError();
      },
      async listComplianceLedger() {
        throw new AdminRepositoryConfigurationError();
      },
      async listDac7Reports() {
        throw new AdminRepositoryConfigurationError();
      },
      async listCarfReports() {
        throw new AdminRepositoryConfigurationError();
      },
      async listVatDeterminations() {
        throw new AdminRepositoryConfigurationError();
      },
      async listReceipts() {
        throw new AdminRepositoryConfigurationError();
      },
      async listInvoices() {
        throw new AdminRepositoryConfigurationError();
      },
      async listReferralPrograms() {
        throw new AdminRepositoryConfigurationError();
      },
      async listPartnerCampaigns() {
        throw new AdminRepositoryConfigurationError();
      },
      async listTierWaivers() {
        throw new AdminRepositoryConfigurationError();
      },
      async listOrganizations() {
        throw new AdminRepositoryConfigurationError();
      },
      async updateOrganizationKyb() {
        throw new AdminRepositoryConfigurationError();
      },
      async listOrganizationMembers() {
        throw new AdminRepositoryConfigurationError();
      },
      async updateOrganizationMember() {
        throw new AdminRepositoryConfigurationError();
      },
      async listFeatureFlags() {
        throw new AdminRepositoryConfigurationError();
      },
      async updateFeatureFlag() {
        throw new AdminRepositoryConfigurationError();
      }
    };
  }

  const sql = postgres(databaseUrl, {
    max: 5,
    idle_timeout: 20,
    prepare: false
  });

  return {
    async hasAdminAccess(supabaseUserId) {
      const rows = await sql<{ allowed: boolean }[]>`
        select exists (
          select 1
          from users u
          join staff_memberships sm on sm.user_id = u.id
          where u.supabase_user_id = ${supabaseUserId}
            and u.state = 'active'
            and sm.state = 'active'
            and sm.role in ('owner', 'admin', 'finance', 'ops', 'support', 'creator_success', 'readonly_auditor')
        ) as allowed
      `;

      return Boolean(rows[0]?.allowed);
    },
    async getOpsSummary() {
      const [paymentRows, unlockRows, providerRows, reportRows] = await Promise.all([
        sql<CountRow[]>`
          select
            count(*) as total,
            count(*) filter (where state in ('pending', 'transaction_requested')) as pending,
            count(*) filter (where state = 'submitted') as submitted,
            count(*) filter (where state = 'confirmed') as confirmed,
            count(*) filter (where state in ('failed', 'expired')) as failed
          from payment_intents
        `,
        sql<CountRow[]>`
          select
            count(*) as total,
            0 as pending,
            0 as submitted,
            count(*) filter (where state = 'active') as confirmed,
            count(*) filter (where state in ('expired', 'revoked')) as failed
          from entitlements
        `,
        sql<CountRow[]>`
          select
            count(*) as total,
            count(*) filter (where normalized_state = 'received') as pending,
            0 as submitted,
            count(*) filter (where normalized_state in ('processed', 'replayed', 'ignored')) as confirmed,
            count(*) filter (where normalized_state = 'failed') as failed
          from provider_events
        `,
        sql<{ open_reports: string | number }[]>`
          select 0 as open_reports
        `
      ]);

      const providerCounts = toCounts(providerRows[0]);

      return {
        providerHealth: providerCounts.failed > 0 ? "degraded" : "ok",
        queueHealth: "ok",
        openReports: Number(reportRows[0]?.open_reports ?? 0),
        paymentCounts: toCounts(paymentRows[0]),
        unlockCounts: toCounts(unlockRows[0]),
        providerEventCounts: providerCounts
      };
    },
    async getNotificationHealth() {
      const rows = await sql<NotificationHealthRow[]>`
        select
          (select count(*) from notifications where state = 'unread') as unread_count,
          (select count(*) from notifications where state = 'read') as read_count,
          (select count(*) from notifications where state = 'archived') as archived_count,
          (select count(*) from notification_devices where state = 'active') as active_device_count,
          (select count(*) from notification_devices where state = 'revoked') as revoked_device_count,
          (select count(*) from notification_preferences where push_enabled) as push_enabled_preference_count,
          (select count(*) from notification_delivery_attempts where state = 'queued') as queued_delivery_count,
          (select count(*) from notification_delivery_attempts where state = 'leased') as leased_delivery_count,
          (select count(*) from notification_delivery_attempts where state = 'delivered') as delivered_delivery_count,
          (select count(*) from notification_delivery_attempts where state = 'failed') as failed_delivery_count,
          (select count(*) from notification_delivery_attempts where state = 'skipped') as skipped_delivery_count,
          (select count(*) from notification_delivery_attempts where state = 'revoked') as revoked_delivery_count,
          (select max(created_at) from notifications) as latest_notification_at,
          (select max(last_seen_at) from notification_devices) as latest_device_seen_at,
          (select max(delivered_at) from notification_delivery_attempts) as latest_delivery_at
      `;

      return toNotificationHealth(rows[0]);
    },
    async listUsers(input) {
      const rows = await sql<AdminUserRow[]>`
        select
          u.id,
          p.handle,
          u.state,
          coalesce(latest_age.state::text, 'required') as age_state,
          primary_wallet.address is not null as wallet_connected,
          primary_wallet.chain::text as wallet_chain,
          primary_wallet.address as wallet_address,
          u.created_at
        from users u
        join profiles p on p.user_id = u.id
        left join lateral (
          select state
          from age_verifications av
          where av.user_id = u.id
          order by av.created_at desc
          limit 1
        ) latest_age on true
        left join lateral (
          select chain, address
          from wallets w
          where w.user_id = u.id
          order by w.is_primary desc, w.created_at desc
          limit 1
        ) primary_wallet on true
        where (${input.cursor ?? null}::timestamptz is null or u.created_at < ${input.cursor ?? null}::timestamptz)
          and (
            ${input.query ?? null}::text is null
            or p.handle ilike '%' || ${input.query ?? ""} || '%'
            or u.id::text = ${input.query ?? ""}
          )
        order by u.created_at desc
        limit ${pageSize + 1}
      `;

      return page(rows, toAdminUser);
    },
    async getUser(input) {
      const rows = await sql<AdminUserRow[]>`
        select
          u.id,
          p.handle,
          u.state,
          coalesce(latest_age.state::text, 'required') as age_state,
          primary_wallet.address is not null as wallet_connected,
          primary_wallet.chain::text as wallet_chain,
          primary_wallet.address as wallet_address,
          u.created_at
        from users u
        join profiles p on p.user_id = u.id
        left join lateral (
          select state
          from age_verifications av
          where av.user_id = u.id
          order by av.created_at desc
          limit 1
        ) latest_age on true
        left join lateral (
          select chain, address
          from wallets w
          where w.user_id = u.id
          order by w.is_primary desc, w.created_at desc
          limit 1
        ) primary_wallet on true
        where u.id = ${input.userId}
        limit 1
      `;

      return rows[0] ? toAdminUser(rows[0]) : null;
    },
    async listContent(input) {
      const rows = await sql<AdminContentRow[]>`
        select
          ci.id,
          u.id as creator_id,
          p.handle,
          p.display_name,
          p.avatar_url,
          ci.moderation_state,
          ci.state,
          ci.created_at
        from content_items ci
        join users u on u.id = ci.creator_user_id
        join profiles p on p.user_id = u.id
        where (${input.cursor ?? null}::timestamptz is null or ci.created_at < ${input.cursor ?? null}::timestamptz)
        order by
          case when ci.moderation_state in ('pending', 'reported', 'restricted') then 0 else 1 end,
          ci.created_at desc
        limit ${pageSize + 1}
      `;

      return page(rows, toAdminContentItem);
    },
    async updateContentModeration(input) {
      const moderation = contentModerationForAction(input.body.action);
      const rows = await sql.begin(async (transaction) => {
        const updatedRows = await transaction<AdminContentRow[]>`
          with actor as (
            select id
            from users
            where supabase_user_id = ${input.supabaseUserId}
            limit 1
          ),
          current_content as (
            select id, state, moderation_state
            from content_items
            where id = ${input.contentId}
            for update
          ),
          updated_content as (
            update content_items ci
            set
              moderation_state = ${moderation.moderationState},
              state = ${moderation.state}::content_state,
              updated_at = now()
            from current_content cc
            where ci.id = cc.id
            returning
              ci.id,
              ci.creator_user_id,
              ci.moderation_state,
              ci.state,
              ci.created_at,
              cc.state::text as previous_state,
              cc.moderation_state as previous_moderation_state
          ),
          audit_insert as (
            insert into audit_events (
              id,
              actor_user_id,
              subject_type,
              subject_id,
              action,
              metadata
            )
            select
              gen_random_uuid(),
              actor.id,
              'content',
              updated_content.id,
              'content_moderation_updated',
              jsonb_build_object(
                'reason', ${input.body.reason},
                'idempotencyKey', ${input.idempotencyKey},
                'adminAction', ${input.body.action},
                'previousState', updated_content.previous_state,
                'newState', updated_content.state,
                'previousModerationState', updated_content.previous_moderation_state,
                'newModerationState', updated_content.moderation_state
              )
            from updated_content
            cross join actor
            returning id
          )
          select
            updated_content.id,
            u.id as creator_id,
            p.handle,
            p.display_name,
            p.avatar_url,
            updated_content.moderation_state,
            updated_content.state,
            updated_content.created_at
          from updated_content
          join users u on u.id = updated_content.creator_user_id
          join profiles p on p.user_id = u.id
          where exists (select 1 from audit_insert)
        `;

        return updatedRows;
      });

      return rows[0] ? toAdminContentItem(rows[0]) : null;
    },
    async listReports(input) {
      const rows = await sql<AdminReportRow[]>`
        select id, subject_type, subject_id, state, reason, created_at
        from reports
        where (${input.cursor ?? null}::timestamptz is null or created_at < ${input.cursor ?? null}::timestamptz)
        order by
          case when state in ('submitted', 'queued', 'reviewing', 'escalated') then 0 else 1 end,
          created_at desc
        limit ${pageSize + 1}
      `;

      return page(rows, toAdminReport);
    },
    async updateReport(input) {
      const rows = await sql.begin(async (transaction) => {
        const updatedRows = await transaction<AdminReportRow[]>`
          with actor as (
            select id
            from users
            where supabase_user_id = ${input.supabaseUserId}
            limit 1
          ),
          current_report as (
            select id, state
            from reports
            where id = ${input.reportId}
            for update
          ),
          updated_report as (
            update reports r
            set
              state = ${input.body.state},
              reviewed_at = case
                when ${input.body.state} in ('resolved', 'rejected') then coalesce(r.reviewed_at, now())
                else r.reviewed_at
              end
            from current_report cr
            where r.id = cr.id
            returning
              r.id,
              r.subject_type,
              r.subject_id,
              r.state,
              r.reason,
              r.created_at,
              cr.state as previous_state
          ),
          audit_insert as (
            insert into audit_events (
              id,
              actor_user_id,
              subject_type,
              subject_id,
              action,
              metadata
            )
            select
              gen_random_uuid(),
              actor.id,
              'report',
              updated_report.id,
              'report_review_updated',
              jsonb_build_object(
                'reason', ${input.body.reason},
                'idempotencyKey', ${input.idempotencyKey},
                'reportedSubjectType', updated_report.subject_type,
                'reportedSubjectId', updated_report.subject_id,
                'previousState', updated_report.previous_state,
                'newState', updated_report.state
              )
            from updated_report
            cross join actor
            returning id
          )
          select id, subject_type, subject_id, state, reason, created_at
          from updated_report
          where exists (select 1 from audit_insert)
        `;

        return updatedRows;
      });

      return rows[0] ? toAdminReport(rows[0]) : null;
    },
    async listPaymentIntents(input) {
      const rows = await sql<PaymentRow[]>`
        select
          pi.id,
          pi.product_type,
          pi.amount_minor,
          pi.currency,
          pi.state,
          pi.user_id,
          pi.target_id,
          pi.reference_address,
          pi.submitted_signature,
          pi.confirmed_signature,
          pi.created_at,
          pi.confirmed_at,
          count(psa.id) as settlement_attempt_count,
          max(e.id::text) as entitlement_id
        from payment_intents pi
        left join payment_settlement_attempts psa on psa.payment_intent_id = pi.id
        left join entitlements e on e.payment_intent_id = pi.id
        where (${input.cursor ?? null}::timestamptz is null or pi.created_at < ${input.cursor ?? null}::timestamptz)
          and (
            ${input.query ?? null}::text is null
            or pi.reference_address ilike '%' || ${input.query ?? ""} || '%'
            or pi.submitted_signature ilike '%' || ${input.query ?? ""} || '%'
            or pi.confirmed_signature ilike '%' || ${input.query ?? ""} || '%'
          )
        group by pi.id
        order by pi.created_at desc
        limit ${pageSize + 1}
      `;

      return page(rows, toPaymentIntent);
    },
    async listUnlocks(input) {
      const rows = await sql<UnlockRow[]>`
        select id, user_id, target_type, target_id, product_type, payment_intent_id, state, granted_at, ends_at as expires_at
        from entitlements
        where (${input.cursor ?? null}::timestamptz is null or granted_at < ${input.cursor ?? null}::timestamptz)
          and (
            ${input.query ?? null}::text is null
            or target_id::text = ${input.query ?? ""}
            or payment_intent_id::text = ${input.query ?? ""}
          )
        order by granted_at desc
        limit ${pageSize + 1}
      `;

      return page(rows, toUnlock);
    },
    async listProviderEvents(input) {
      const rows = await sql<ProviderEventRow[]>`
        select
          pe.id,
          pe.provider,
          pe.event_type,
          pe.normalized_state,
          pe.received_at,
          pe.processed_at,
          replay.state as latest_replay_state,
          replay.created_at as latest_replay_requested_at,
          replay.processed_at as latest_replay_processed_at
        from provider_events pe
        left join lateral (
          select state, created_at, processed_at
          from provider_event_replay_requests perr
          where perr.provider_event_id = pe.id
          order by perr.created_at desc
          limit 1
        ) replay on true
        where (${input.cursor ?? null}::timestamptz is null or pe.received_at < ${input.cursor ?? null}::timestamptz)
        order by pe.received_at desc
        limit ${pageSize + 1}
      `;

      return page(rows, toProviderEvent);
    },
    async enqueueProviderEventReplay(input) {
      const replayRequestId = randomUUID();
      const auditEventId = randomUUID();
      const reason = input.body.reason.trim();
      const rows = await sql<{ provider_event_exists: boolean }[]>`
        with actor as (
          select id
          from users
          where supabase_user_id = ${input.supabaseUserId}::uuid
        ),
        target as (
          select id
          from provider_events
          where id = ${input.providerEventId}::uuid
        ),
        inserted as (
          insert into provider_event_replay_requests (
            id,
            provider_event_id,
            requested_by_user_id,
            idempotency_key,
            reason,
            state
          )
          select
            ${replayRequestId},
            target.id,
            actor.id,
            ${input.idempotencyKey},
            ${reason},
            'queued'
          from target
          left join actor on true
          on conflict (provider_event_id, idempotency_key) do nothing
          returning id, provider_event_id, requested_by_user_id
        ),
        audit_insert as (
          insert into audit_events (
            id,
            actor_user_id,
            subject_type,
            subject_id,
            action,
            metadata
          )
          select
            ${auditEventId},
            inserted.requested_by_user_id,
            'provider_event',
            inserted.provider_event_id,
            'provider_event.replay_requested',
            jsonb_build_object(
              'replayRequestId', inserted.id,
              'reason', ${reason},
              'boundary', 'worker_replay_enqueue_only'
            )
          from inserted
          returning id
        )
        select exists(select 1 from target) as provider_event_exists
      `;

      return rows[0]?.provider_event_exists ?? false;
    },
    async listAuditEvents(input) {
      const rows = await sql<AuditEventRow[]>`
        select id, subject_type, action, created_at
        from audit_events
        where (${input.cursor ?? null}::timestamptz is null or created_at < ${input.cursor ?? null}::timestamptz)
        order by created_at desc
        limit ${pageSize + 1}
      `;

      return page(rows, toAuditEvent);
    },
    async listSupportCases(input) {
      const rows = await sql<SupportCaseRow[]>`
        select
          id,
          organization_id,
          requester_user_id,
          assigned_staff_user_id,
          subject_type,
          subject_id,
          category,
          state,
          priority,
          created_at,
          updated_at,
          closed_at
        from support_cases
        where (${input.cursor ?? null}::timestamptz is null or created_at < ${input.cursor ?? null}::timestamptz)
        order by created_at desc
        limit ${pageSize + 1}
      `;

      return page(rows, toSupportCase);
    },
    async updateSupportCase(input) {
      const rows = await sql.begin(async (transaction) => {
        const updatedRows = await transaction<SupportCaseRow[]>`
          with actor as (
            select id
            from users
            where supabase_user_id = ${input.supabaseUserId}
            limit 1
          ),
          current_case as (
            select id, state
            from support_cases
            where id = ${input.supportCaseId}
            for update
          ),
          updated_case as (
            update support_cases sc
            set
              state = ${input.body.state},
              updated_at = now(),
              closed_at = case
                when ${input.body.state} in ('resolved', 'closed') then coalesce(sc.closed_at, now())
                else null
              end
            from current_case cc
            where sc.id = cc.id
            returning
              sc.id,
              sc.organization_id,
              sc.requester_user_id,
              sc.assigned_staff_user_id,
              sc.subject_type,
              sc.subject_id,
              sc.category,
              sc.state,
              sc.priority,
              sc.created_at,
              sc.updated_at,
              sc.closed_at,
              cc.state as previous_state
          ),
          audit_insert as (
            insert into audit_events (
              id,
              actor_user_id,
              subject_type,
              subject_id,
              action,
              metadata
            )
            select
              gen_random_uuid(),
              actor.id,
              'support_case',
              updated_case.id,
              'support_case_updated',
              jsonb_build_object(
                'reason', ${input.body.reason},
                'idempotencyKey', ${input.idempotencyKey},
                'previousState', updated_case.previous_state,
                'newState', updated_case.state,
                'organizationId', updated_case.organization_id
              )
            from updated_case
            cross join actor
            returning id
          )
          select
            id,
            organization_id,
            requester_user_id,
            assigned_staff_user_id,
            subject_type,
            subject_id,
            category,
            state,
            priority,
            created_at,
            updated_at,
            closed_at
          from updated_case
          where exists (select 1 from audit_insert)
        `;

        return updatedRows;
      });

      return rows[0] ? toSupportCase(rows[0]) : null;
    },
    async listSupportPolicies(input) {
      const rows = await sql<SupportPolicyRow[]>`
        select
          id,
          organization_id,
          support_state,
          sla_tier,
          state,
          policy_reason,
          money_boundary,
          created_at,
          updated_at
        from organization_support_policies
        where (${input.cursor ?? null}::timestamptz is null or updated_at < ${input.cursor ?? null}::timestamptz)
        order by updated_at desc
        limit ${pageSize + 1}
      `;

      return page(rows, toSupportPolicy);
    },
    async updateSupportPolicy(input) {
      const rows = await sql.begin(async (transaction) => {
        const updatedRows = await transaction<SupportPolicyRow[]>`
          with actor as (
            select id
            from users
            where supabase_user_id = ${input.supabaseUserId}
            limit 1
          ),
          current_policy as (
            select id, support_state, sla_tier, state
            from organization_support_policies
            where id = ${input.supportPolicyId}
            for update
          ),
          updated_policy as (
            update organization_support_policies osp
            set
              support_state = ${input.body.supportState},
              sla_tier = ${input.body.slaTier},
              state = ${input.body.state},
              policy_reason = ${input.body.reason},
              updated_at = now()
            from current_policy cp
            where osp.id = cp.id
            returning
              osp.id,
              osp.organization_id,
              osp.support_state,
              osp.sla_tier,
              osp.state,
              osp.policy_reason,
              osp.money_boundary,
              osp.created_at,
              osp.updated_at,
              cp.support_state as previous_support_state,
              cp.sla_tier as previous_sla_tier,
              cp.state as previous_state
          ),
          audit_insert as (
            insert into audit_events (
              id,
              actor_user_id,
              subject_type,
              subject_id,
              action,
              metadata
            )
            select
              gen_random_uuid(),
              actor.id,
              'organization_support_policy',
              updated_policy.id,
              'organization_support_policy_updated',
              jsonb_build_object(
                'reason', ${input.body.reason},
                'idempotencyKey', ${input.idempotencyKey},
                'organizationId', updated_policy.organization_id,
                'previousSupportState', updated_policy.previous_support_state,
                'newSupportState', updated_policy.support_state,
                'previousSlaTier', updated_policy.previous_sla_tier,
                'newSlaTier', updated_policy.sla_tier,
                'previousState', updated_policy.previous_state,
                'newState', updated_policy.state,
                'moneyBoundary', updated_policy.money_boundary
              )
            from updated_policy
            cross join actor
            returning id
          )
          select
            id,
            organization_id,
            support_state,
            sla_tier,
            state,
            policy_reason,
            money_boundary,
            created_at,
            updated_at
          from updated_policy
          where exists (select 1 from audit_insert)
        `;

        return updatedRows;
      });

      return rows[0] ? toSupportPolicy(rows[0]) : null;
    },
    async listRefundDisputes(input) {
      const rows = await sql<RefundDisputeRow[]>`
        select
          id,
          payment_intent_id,
          entitlement_id,
          reporter_user_id,
          kind,
          requested_action,
          state,
          resolution,
          custody_boundary,
          created_at,
          updated_at,
          resolved_at
        from refunds_and_disputes
        where (${input.cursor ?? null}::timestamptz is null or created_at < ${input.cursor ?? null}::timestamptz)
        order by created_at desc
        limit ${pageSize + 1}
      `;

      return page(rows, toRefundDispute);
    },
    async updateRefundDispute(input) {
      const rows = await sql.begin(async (transaction) => {
        const updatedRows = await transaction<RefundDisputeRow[]>`
          with actor as (
            select id
            from users
            where supabase_user_id = ${input.supabaseUserId}
            limit 1
          ),
          current_request as (
            select id, state, resolution
            from refunds_and_disputes
            where id = ${input.refundDisputeId}
            for update
          ),
          updated_request as (
            update refunds_and_disputes rd
            set
              state = ${input.body.state},
              resolution = ${input.body.resolution},
              updated_at = now(),
              resolved_at = case
                when ${input.body.state} in ('rejected', 'withdrawn', 'resolved', 'closed') then coalesce(rd.resolved_at, now())
                else null
              end
            from current_request cr
            where rd.id = cr.id
            returning
              rd.id,
              rd.payment_intent_id,
              rd.entitlement_id,
              rd.reporter_user_id,
              rd.kind,
              rd.requested_action,
              rd.state,
              rd.resolution,
              rd.custody_boundary,
              rd.created_at,
              rd.updated_at,
              rd.resolved_at,
              cr.state as previous_state,
              cr.resolution as previous_resolution
          ),
          audit_insert as (
            insert into audit_events (
              id,
              actor_user_id,
              subject_type,
              subject_id,
              action,
              metadata
            )
            select
              gen_random_uuid(),
              actor.id,
              'refund_dispute',
              updated_request.id,
              'refund_dispute_updated',
              jsonb_build_object(
                'reason', ${input.body.reason},
                'idempotencyKey', ${input.idempotencyKey},
                'paymentIntentId', updated_request.payment_intent_id,
                'entitlementId', updated_request.entitlement_id,
                'previousState', updated_request.previous_state,
                'newState', updated_request.state,
                'previousResolution', updated_request.previous_resolution,
                'newResolution', updated_request.resolution,
                'custodyBoundary', updated_request.custody_boundary
              )
            from updated_request
            cross join actor
            returning id
          )
          select
            id,
            payment_intent_id,
            entitlement_id,
            reporter_user_id,
            kind,
            requested_action,
            state,
            resolution,
            custody_boundary,
            created_at,
            updated_at,
            resolved_at
          from updated_request
          where exists (select 1 from audit_insert)
        `;

        return updatedRows;
      });

      return rows[0] ? toRefundDispute(rows[0]) : null;
    },
    async listDataRequests(input) {
      const rows = await sql<DataRequestRow[]>`
        select
          id,
          requester_user_id,
          type,
          state,
          privacy_boundary,
          created_at,
          updated_at,
          completed_at
        from data_requests
        where (${input.cursor ?? null}::timestamptz is null or created_at < ${input.cursor ?? null}::timestamptz)
        order by created_at desc
        limit ${pageSize + 1}
      `;

      return page(rows, toDataRequest);
    },
    async updateDataRequest(input) {
      const rows = await sql.begin(async (transaction) => {
        const updatedRows = await transaction<DataRequestRow[]>`
          with actor as (
            select id
            from users
            where supabase_user_id = ${input.supabaseUserId}
            limit 1
          ),
          current_request as (
            select id, state
            from data_requests
            where id = ${input.dataRequestId}
            for update
          ),
          updated_request as (
            update data_requests dr
            set
              state = ${input.body.state},
              reason = ${input.body.reason},
              updated_at = now(),
              completed_at = case
                when ${input.body.state} in ('completed', 'rejected') then coalesce(dr.completed_at, now())
                else null
              end
            from current_request cr
            where dr.id = cr.id
            returning
              dr.id,
              dr.requester_user_id,
              dr.type,
              dr.state,
              dr.privacy_boundary,
              dr.created_at,
              dr.updated_at,
              dr.completed_at,
              cr.state as previous_state
          ),
          audit_insert as (
            insert into audit_events (
              id,
              actor_user_id,
              subject_type,
              subject_id,
              action,
              metadata
            )
            select
              gen_random_uuid(),
              actor.id,
              'data_request',
              updated_request.id,
              'data_request_updated',
              jsonb_build_object(
                'reason', ${input.body.reason},
                'idempotencyKey', ${input.idempotencyKey},
                'requesterUserId', updated_request.requester_user_id,
                'previousState', updated_request.previous_state,
                'newState', updated_request.state,
                'privacyBoundary', updated_request.privacy_boundary
              )
            from updated_request
            cross join actor
            returning id
          )
          select
            id,
            requester_user_id,
            type,
            state,
            privacy_boundary,
            created_at,
            updated_at,
            completed_at
          from updated_request
          where exists (select 1 from audit_insert)
        `;

        return updatedRows;
      });

      return rows[0] ? toDataRequest(rows[0]) : null;
    },
    async listEvents(input) {
      const eventRows = await sql<EventRow[]>`
        select
          id,
          title,
          description,
          starts_at,
          ends_at,
          access_rule,
          location_type,
          location_label,
          location_lat::text,
          location_lng::text,
          state,
          created_at
        from events
        where (${input.cursor ?? null}::timestamptz is null or starts_at < ${input.cursor ?? null}::timestamptz)
        order by starts_at desc
        limit ${pageSize + 1}
      `;
      const visibleRows = eventRows.slice(0, pageSize);
      const eventIds = visibleRows.map((row) => row.id);
      const ticketRows =
        eventIds.length > 0
          ? await sql<EventTicketTypeRow[]>`
              select
                tt.id,
                tt.event_id,
                tt.label,
                tt.price_minor,
                tt.currency,
                tt.capacity,
                tt.sale_starts_at,
                tt.sale_ends_at,
                tt.per_user_limit,
                tt.state,
                count(te.id) as issued_count
              from ticket_types tt
              left join ticket_entitlements te
                on te.ticket_type_id = tt.id
                and te.state in ('active', 'checked_in')
              where tt.event_id in ${sql(eventIds)}
              group by tt.id
              order by tt.created_at asc
            `
          : [];
      const ticketTypesByEvent = new Map<string, EventTicketTypeRow[]>();
      for (const row of ticketRows) {
        const rows = ticketTypesByEvent.get(row.event_id) ?? [];
        rows.push(row);
        ticketTypesByEvent.set(row.event_id, rows);
      }

      return {
        items: visibleRows.map((row) => toEvent(row, ticketTypesByEvent.get(row.id) ?? [])),
        nextCursor: cursorFor(eventRows.length > pageSize ? eventRows[pageSize] : null)
      };
    },
    async listTickets(input) {
      const rows = await sql<TicketRow[]>`
        select
          id,
          event_id,
          ticket_type_id,
          holder_user_id,
          payment_intent_id,
          state,
          checked_in_at,
          created_at
        from ticket_entitlements
        where (${input.cursor ?? null}::timestamptz is null or created_at < ${input.cursor ?? null}::timestamptz)
        order by created_at desc
        limit ${pageSize + 1}
      `;

      return page(rows, toTicket);
    },
    async listLiveRooms(input) {
      const rows = await sql<LiveRoomRow[]>`
        select
          id,
          creator_user_id,
          title,
          provider,
          provider_stream_id,
          provider_playback_id,
          provider_state,
          state,
          access_rule,
          pass_price_minor,
          currency,
          (playback_url is not null) as has_playback_url,
          (host_stream_key is not null) as has_host_stream_key,
          starts_at,
          ended_at,
          created_at,
          updated_at
        from live_rooms
        where (${input.cursor ?? null}::timestamptz is null or created_at < ${input.cursor ?? null}::timestamptz)
        order by created_at desc
        limit ${pageSize + 1}
      `;

      return page(rows, toLiveRoom);
    },
    async listMediaAssets(input) {
      const rows = await sql<MediaAssetRow[]>`
        select
          id,
          content_item_id,
          provider,
          provider_asset_id,
          provider_state,
          provider_playable,
          (playback_url is not null) as has_playback_url,
          ready_at,
          provider_checked_at,
          created_at
        from media_assets
        where (${input.cursor ?? null}::timestamptz is null or created_at < ${input.cursor ?? null}::timestamptz)
        order by created_at desc
        limit ${pageSize + 1}
      `;

      return page(rows, toMediaAsset);
    },
    async listAgeChecks(input) {
      const rows = await sql<AgeCheckRow[]>`
        select
          id,
          user_id,
          provider,
          provider_reference,
          state,
          jurisdiction,
          rule,
          (provider_reference is not null and provider_reference <> '') as has_provider_reference,
          verified_at,
          expires_at,
          created_at
        from age_verifications
        where (${input.cursor ?? null}::timestamptz is null or created_at < ${input.cursor ?? null}::timestamptz)
        order by created_at desc
        limit ${pageSize + 1}
      `;

      return page(rows, toAgeCheck);
    },
    async listIdentityChecks(input) {
      const rows = await sql<IdentityCheckRow[]>`
        select
          id,
          user_id,
          provider,
          provider_reference,
          verification_type,
          state,
          country_code,
          document_type,
          liveness_state,
          wallet_ownership_state,
          (provider_reference is not null and provider_reference <> '') as has_provider_reference,
          (legal_name_hash is not null and legal_name_hash <> '') as has_legal_name_hash,
          verified_at,
          expires_at,
          created_at
        from identity_verifications
        where (${input.cursor ?? null}::timestamptz is null or created_at < ${input.cursor ?? null}::timestamptz)
        order by created_at desc
        limit ${pageSize + 1}
      `;

      return page(rows, toIdentityCheck);
    },
    async listAiSessions(input) {
      const rows = await sql<AiSessionRow[]>`
        select
          id,
          actor_user_id,
          scope,
          state,
          coalesce(array_length(allowed_tools, 1), 0) as allowed_tool_count,
          created_at,
          expires_at
        from ai_sessions
        where (${input.cursor ?? null}::timestamptz is null or created_at < ${input.cursor ?? null}::timestamptz)
        order by created_at desc
        limit ${pageSize + 1}
      `;

      return page(rows, toAiSession);
    },
    async listAiToolCalls(input) {
      const rows = await sql<AiToolCallRow[]>`
        select
          id,
          session_id,
          actor_user_id,
          scope,
          tool_name,
          state,
          confirmation_state,
          subject_type,
          subject_id,
          input_summary,
          output_summary,
          created_at
        from ai_tool_calls
        where (${input.cursor ?? null}::timestamptz is null or created_at < ${input.cursor ?? null}::timestamptz)
        order by created_at desc
        limit ${pageSize + 1}
      `;

      return page(rows, toAiToolCall);
    },
    async getMutualsSafety() {
      const rows = await sql<{
        open_reports: string | number;
        active_matches: string | number;
        stale_matches: string | number;
      }[]>`
        select
          0 as open_reports,
          count(*) filter (where state = 'active') as active_matches,
          count(*) filter (where state = 'stale') as stale_matches
        from dating_matches
      `;
      const row = rows[0];

      return {
        openReports: Number(row?.open_reports ?? 0),
        activeMutuals: Number(row?.active_matches ?? 0),
        staleMutuals: Number(row?.stale_matches ?? 0),
        socialMoneyBoundary: "money_never_buys_people_visibility_matches_or_social_priority"
      } satisfies AdminMutualsSafety;
    },
    async listComplianceLedger(input) {
      const rows = await sql<ComplianceLedgerRow[]>`
        select
          id,
          event_type,
          product_type,
          settlement_model,
          seller_user_id,
          buyer_user_id,
          payment_intent_id,
          entitlement_id,
          receipt_id,
          vat_invoice_id,
          gross_amount_minor,
          platform_fee_minor,
          creator_net_amount_minor,
          tax_amount_minor,
          currency,
          fiat_currency,
          fx_rate::text,
          seller_country,
          buyer_country,
          seller_of_record,
          vat_status,
          dac7_reportable,
          carf_reportable,
          immutable_hash,
          created_at
        from compliance_ledger_entries
        where (${input.cursor ?? null}::timestamptz is null or created_at < ${input.cursor ?? null}::timestamptz)
        order by created_at desc
        limit ${pageSize + 1}
      `;

      return page(rows, toComplianceLedgerEntry);
    },
    async listDac7Reports(input) {
      const rows = await sql<ComplianceReportRow[]>`
        select id, reporting_year, jurisdiction, state, line_count, export_id::text, null::boolean as carf_reporting_required, created_at, exported_at
        from dac7_reports
        where (${input.cursor ?? null}::timestamptz is null or created_at < ${input.cursor ?? null}::timestamptz)
        order by created_at desc
        limit ${pageSize + 1}
      `;

      return page(rows, (row) => toComplianceReport(row, "dac7"));
    },
    async listCarfReports(input) {
      const rows = await sql<ComplianceReportRow[]>`
        select id, reporting_year, jurisdiction, state, line_count, export_id::text, carf_reporting_required, created_at, exported_at
        from carf_reports
        where (${input.cursor ?? null}::timestamptz is null or created_at < ${input.cursor ?? null}::timestamptz)
        order by created_at desc
        limit ${pageSize + 1}
      `;

      return page(rows, (row) => toComplianceReport(row, "carf"));
    },
    async listVatDeterminations(input) {
      const rows = await sql<VatDeterminationRow[]>`
        select
          id,
          product_type,
          seller_of_record,
          buyer_country,
          seller_country,
          buyer_vat_id_hash,
          vies_status,
          place_of_supply,
          vat_status,
          vat_rate_bps,
          vat_amount_minor,
          review_state,
          created_at
        from vat_determinations
        where (${input.cursor ?? null}::timestamptz is null or created_at < ${input.cursor ?? null}::timestamptz)
        order by created_at desc
        limit ${pageSize + 1}
      `;

      return page(rows, toVatDetermination);
    },
    async listReceipts(input) {
      const rows = await sql<ReceiptRow[]>`
        select
          id,
          receipt_number,
          product_type,
          buyer_user_id,
          seller_user_id,
          payment_intent_id,
          gross_amount_minor,
          currency,
          state,
          issued_at
        from receipts
        where (${input.cursor ?? null}::timestamptz is null or issued_at < ${input.cursor ?? null}::timestamptz)
        order by issued_at desc
        limit ${pageSize + 1}
      `;

      return page(rows, toReceipt);
    },
    async listInvoices(input) {
      const rows = await sql<InvoiceRow[]>`
        select id, invoice_number, seller_of_record, buyer_user_id, seller_user_id, total_amount_minor, vat_amount_minor, currency, state, issued_at
        from vat_invoices
        where (${input.cursor ?? null}::timestamptz is null or issued_at < ${input.cursor ?? null}::timestamptz)
        order by issued_at desc
        limit ${pageSize + 1}
      `;

      return page(rows, toInvoice);
    },
    async listReferralPrograms(input) {
      const rows = await sql<ReferralProgramRow[]>`
        select id, name, state, priority, commission_source, created_at
        from referral_programs
        where (${input.cursor ?? null}::timestamptz is null or created_at < ${input.cursor ?? null}::timestamptz)
        order by created_at desc
        limit ${pageSize + 1}
      `;

      return page(rows, toReferralProgram);
    },
    async listPartnerCampaigns(input) {
      const rows = await sql<PartnerCampaignRow[]>`
        select id, name, partner_name, state, contract_id, created_at
        from partner_campaigns
        where (${input.cursor ?? null}::timestamptz is null or created_at < ${input.cursor ?? null}::timestamptz)
        order by created_at desc
        limit ${pageSize + 1}
      `;

      return page(rows, toPartnerCampaign);
    },
    async listTierWaivers(input) {
      const rows = await sql<TierWaiverRow[]>`
        select id, subject_type, subject_id, tier_key, state, starts_at, ends_at
        from tier_waivers
        where (${input.cursor ?? null}::timestamptz is null or starts_at < ${input.cursor ?? null}::timestamptz)
        order by starts_at desc
        limit ${pageSize + 1}
      `;

      return page(rows, toTierWaiver);
    },
    async listOrganizations(input) {
      const rows = await sql<OrganizationRow[]>`
        select id, name, state, plan, kyb_state, created_at
        from organizations
        where (${input.cursor ?? null}::timestamptz is null or created_at < ${input.cursor ?? null}::timestamptz)
        order by created_at desc
        limit ${pageSize + 1}
      `;

      return page(rows, toOrganization);
    },
    async updateOrganizationKyb(input) {
      const rows = await sql.begin(async (transaction) => {
        const updatedRows = await transaction<OrganizationRow[]>`
          with actor as (
            select id
            from users
            where supabase_user_id = ${input.supabaseUserId}
            limit 1
          ),
          current_org as (
            select id, state, kyb_state
            from organizations
            where id = ${input.organizationId}
            for update
          ),
          updated_org as (
            update organizations o
            set
              kyb_state = ${input.body.kybState},
              state = case
                when o.state in ('suspended', 'archived') then o.state
                when ${input.body.kybState} = 'verified' then 'active'
                else 'pending_kyb'
              end
            from current_org co
            where o.id = co.id
            returning
              o.id,
              o.name,
              o.state,
              o.plan,
              o.kyb_state,
              o.created_at,
              co.state as previous_state,
              co.kyb_state as previous_kyb_state
          ),
          audit_insert as (
            insert into audit_events (
              id,
              actor_user_id,
              subject_type,
              subject_id,
              action,
              metadata
            )
            select
              gen_random_uuid(),
              actor.id,
              'organization',
              updated_org.id,
              'organization_kyb_updated',
              jsonb_build_object(
                'reason', ${input.body.reason},
                'idempotencyKey', ${input.idempotencyKey},
                'previousState', updated_org.previous_state,
                'newState', updated_org.state,
                'previousKybState', updated_org.previous_kyb_state,
                'newKybState', updated_org.kyb_state
              )
            from updated_org
            cross join actor
            returning id
          )
          select id, name, state, plan, kyb_state, created_at
          from updated_org
          where exists (select 1 from audit_insert)
        `;

        return updatedRows;
      });

      return rows[0] ? toOrganization(rows[0]) : null;
    },
    async listOrganizationMembers(input) {
      const rows = await sql<OrganizationMemberRow[]>`
        select
          id,
          organization_id,
          user_id,
          role,
          state,
          invited_by_user_id,
          joined_at,
          created_at,
          updated_at
        from organization_memberships
        where organization_id = ${input.organizationId}
          and (${input.cursor ?? null}::timestamptz is null or coalesce(updated_at, created_at) < ${input.cursor ?? null}::timestamptz)
        order by coalesce(updated_at, created_at) desc, created_at desc
        limit ${pageSize + 1}
      `;

      return page(rows, toOrganizationMember);
    },
    async updateOrganizationMember(input) {
      const rows: OrganizationMemberRow[] = await sql.begin(async (transaction) => {
        const lockedRows = await transaction<LockedOrganizationMemberRow[]>`
          select
            om.id,
            om.organization_id,
            om.user_id,
            om.role,
            om.state,
            om.invited_by_user_id,
            om.joined_at,
            om.created_at,
            om.updated_at,
            (
              select count(*)::int
              from organization_memberships owner_membership
              where owner_membership.organization_id = om.organization_id
                and owner_membership.role = 'owner'
                and owner_membership.state = 'active'
            ) as active_owner_count
          from organization_memberships om
          where om.organization_id = ${input.organizationId}
            and om.id = ${input.membershipId}
          for update
        `;
        const locked = lockedRows[0];

        if (!locked) {
          return [] as OrganizationMemberRow[];
        }

        const wouldRemoveActiveOwner =
          locked.role === "owner" &&
          locked.state === "active" &&
          (input.body.role !== "owner" || input.body.state !== "active");

        if (wouldRemoveActiveOwner && Number(locked.active_owner_count) <= 1) {
          throw new AdminRepositoryStateConflictError("At least one active organization owner is required");
        }

        const updatedRows = await transaction<OrganizationMemberRow[]>`
          with actor as (
            select id
            from users
            where supabase_user_id = ${input.supabaseUserId}
            limit 1
          ),
          updated_membership as (
            update organization_memberships
            set
              role = ${input.body.role},
              state = ${input.body.state},
              joined_at = case
                when ${input.body.state} = 'active' and joined_at is null then now()
                else joined_at
              end,
              updated_at = now()
            where organization_id = ${input.organizationId}
              and id = ${input.membershipId}
            returning
              id,
              organization_id,
              user_id,
              role,
              state,
              invited_by_user_id,
              joined_at,
              created_at,
              updated_at
          ),
          audit_insert as (
            insert into audit_events (
              id,
              actor_user_id,
              subject_type,
              subject_id,
              action,
              metadata
            )
            select
              gen_random_uuid(),
              actor.id,
              'organization_membership',
              updated_membership.id,
              'organization_member_updated',
              jsonb_build_object(
                'organizationId', updated_membership.organization_id,
                'reason', ${input.body.reason},
                'idempotencyKey', ${input.idempotencyKey},
                'previousRole', ${locked.role},
                'newRole', updated_membership.role,
                'previousState', ${locked.state},
                'newState', updated_membership.state
              )
            from updated_membership
            cross join actor
            returning id
          )
          select
            id,
            organization_id,
            user_id,
            role,
            state,
            invited_by_user_id,
            joined_at,
            created_at,
            updated_at
          from updated_membership
          where exists (select 1 from audit_insert)
        `;

        return updatedRows;
      });

      return rows[0] ? toOrganizationMember(rows[0]) : null;
    },
    async listFeatureFlags() {
      const rows = await sql<FeatureFlagRow[]>`
        select key, value, category, policy_boundary, state, updated_at
        from feature_flags
        order by updated_at desc, key asc
        limit ${pageSize}
      `;

      return {
        items: rows.map(toFeatureFlag),
        nextCursor: null
      };
    },
    async updateFeatureFlag(input) {
      const rows = await sql.begin(async (transaction) => {
        const updatedRows = await transaction<FeatureFlagRow[]>`
          with actor as (
            select id
            from users
            where supabase_user_id = ${input.supabaseUserId}
            limit 1
          ),
          current_flag as (
            select key, value, state, policy_boundary
            from feature_flags
            where key = ${input.featureFlagKey}
            for update
          ),
          updated_flag as (
            update feature_flags ff
            set
              value = ${JSON.stringify(input.body.value)}::jsonb,
              state = ${input.body.state},
              updated_at = now()
            from current_flag cf
            where ff.key = cf.key
            returning
              ff.key,
              ff.value,
              ff.category,
              ff.policy_boundary,
              ff.state,
              ff.updated_at,
              cf.value as previous_value,
              cf.state as previous_state
          ),
          audit_insert as (
            insert into audit_events (
              id,
              actor_user_id,
              subject_type,
              subject_id,
              action,
              metadata
            )
            select
              gen_random_uuid(),
              actor.id,
              'feature_flag',
              null,
              'feature_flag_updated',
              jsonb_build_object(
                'featureFlagKey', updated_flag.key,
                'reason', ${input.body.reason},
                'idempotencyKey', ${input.idempotencyKey},
                'previousValue', updated_flag.previous_value,
                'newValue', updated_flag.value,
                'previousState', updated_flag.previous_state,
                'newState', updated_flag.state,
                'policyBoundary', updated_flag.policy_boundary
              )
            from updated_flag
            cross join actor
            returning id
          )
          select key, value, category, policy_boundary, state, updated_at
          from updated_flag
          where exists (select 1 from audit_insert)
        `;

        return updatedRows;
      });

      return rows[0] ? toFeatureFlag(rows[0]) : null;
    },
    async close() {
      await sql.end({ timeout: 5 });
    }
  };
}

function page<Row, Item>(rows: Row[], mapper: (row: Row) => Item): { items: Item[]; nextCursor: string | null } {
  const visibleRows = rows.slice(0, pageSize);
  const next = rows.length > pageSize ? rows[pageSize] : null;

  return {
    items: visibleRows.map(mapper),
    nextCursor: cursorFor(next)
  };
}

function cursorFor(row: unknown): string | null {
  if (typeof row === "object" && row !== null) {
    if ("created_at" in row && row.created_at instanceof Date) {
      return row.created_at.toISOString();
    }

    if ("granted_at" in row && row.granted_at instanceof Date) {
      return row.granted_at.toISOString();
    }

    if ("received_at" in row && row.received_at instanceof Date) {
      return row.received_at.toISOString();
    }

    if ("issued_at" in row && row.issued_at instanceof Date) {
      return row.issued_at.toISOString();
    }

    if ("starts_at" in row && row.starts_at instanceof Date) {
      return row.starts_at.toISOString();
    }
  }

  return null;
}

function toCounts(row: CountRow | undefined): AdminOpsSummary["paymentCounts"] {
  return {
    total: Number(row?.total ?? 0),
    pending: Number(row?.pending ?? 0),
    submitted: Number(row?.submitted ?? 0),
    confirmed: Number(row?.confirmed ?? 0),
    failed: Number(row?.failed ?? 0)
  };
}

function toNotificationHealth(row: NotificationHealthRow | undefined): AdminNotificationHealth {
  return {
    unreadCount: Number(row?.unread_count ?? 0),
    readCount: Number(row?.read_count ?? 0),
    archivedCount: Number(row?.archived_count ?? 0),
    activeDeviceCount: Number(row?.active_device_count ?? 0),
    revokedDeviceCount: Number(row?.revoked_device_count ?? 0),
    pushEnabledPreferenceCount: Number(row?.push_enabled_preference_count ?? 0),
    queuedDeliveryCount: Number(row?.queued_delivery_count ?? 0),
    leasedDeliveryCount: Number(row?.leased_delivery_count ?? 0),
    deliveredDeliveryCount: Number(row?.delivered_delivery_count ?? 0),
    failedDeliveryCount: Number(row?.failed_delivery_count ?? 0),
    skippedDeliveryCount: Number(row?.skipped_delivery_count ?? 0),
    revokedDeliveryCount: Number(row?.revoked_delivery_count ?? 0),
    latestNotificationAt: row?.latest_notification_at?.toISOString() ?? null,
    latestDeviceSeenAt: row?.latest_device_seen_at?.toISOString() ?? null,
    latestDeliveryAt: row?.latest_delivery_at?.toISOString() ?? null
  };
}

function toAdminUser(row: AdminUserRow): AdminUser {
  return {
    id: row.id,
    handle: row.handle,
    state: row.state,
    ageState: row.age_state,
    walletState: {
      connected: row.wallet_connected,
      chain: row.wallet_chain ?? "solana_devnet",
      address: row.wallet_address
    }
  };
}

function toAdminContentItem(row: AdminContentRow): AdminContentItem {
  return {
    id: row.id,
    creator: {
      id: row.creator_id,
      handle: row.handle,
      displayName: row.display_name,
      avatarUrl: row.avatar_url,
      badges: []
    },
    moderationState: row.moderation_state,
    state: row.state
  };
}

function toAdminReport(row: AdminReportRow): AdminReport {
  return {
    id: row.id,
    subjectType: row.subject_type,
    subjectId: row.subject_id,
    state: row.state,
    reason: row.reason
  };
}

function toPaymentIntent(row: PaymentRow): AdminPaymentIntent {
  return {
    id: row.id,
    productType: row.product_type,
    amountMinor: Number(row.amount_minor),
    currency: row.currency,
    state: row.state,
    userId: row.user_id,
    targetId: row.target_id,
    referenceAddress: row.reference_address,
    submittedSignature: row.submitted_signature,
    confirmedSignature: row.confirmed_signature,
    settlementAttemptCount: Number(row.settlement_attempt_count),
    entitlementId: row.entitlement_id,
    createdAt: row.created_at.toISOString(),
    confirmedAt: row.confirmed_at?.toISOString() ?? null
  };
}

function toUnlock(row: UnlockRow): AdminUnlock {
  return {
    id: row.id,
    userId: row.user_id,
    targetType: row.target_type,
    targetId: row.target_id,
    productType: row.product_type,
    paymentIntentId: row.payment_intent_id,
    state: row.state,
    grantedAt: row.granted_at.toISOString(),
    expiresAt: row.expires_at?.toISOString() ?? null
  };
}

function toProviderEvent(row: ProviderEventRow): AdminProviderEvent {
  return {
    id: row.id,
    provider: row.provider,
    eventType: row.event_type,
    state: row.normalized_state,
    receivedAt: row.received_at.toISOString(),
    processedAt: row.processed_at?.toISOString() ?? null,
    latestReplayState: row.latest_replay_state ?? null,
    latestReplayRequestedAt: row.latest_replay_requested_at?.toISOString() ?? null,
    latestReplayProcessedAt: row.latest_replay_processed_at?.toISOString() ?? null
  };
}

function toLiveRoom(row: LiveRoomRow): AdminLiveRoom {
  return {
    id: row.id,
    creatorUserId: row.creator_user_id,
    title: row.title,
    provider: row.provider,
    providerStreamId: row.provider_stream_id,
    providerPlaybackId: row.provider_playback_id,
    providerState: row.provider_state,
    state: row.state,
    accessRule: row.access_rule,
    passPriceMinor: Number(row.pass_price_minor),
    currency: row.currency,
    hasPlaybackUrl: row.has_playback_url,
    hasHostStreamKey: row.has_host_stream_key,
    startsAt: row.starts_at?.toISOString() ?? null,
    endedAt: row.ended_at?.toISOString() ?? null,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at?.toISOString() ?? null
  };
}

function toMediaAsset(row: MediaAssetRow): AdminMediaAsset {
  return {
    id: row.id,
    contentItemId: row.content_item_id,
    provider: row.provider,
    providerAssetId: row.provider_asset_id,
    providerState: row.provider_state,
    providerPlayable: row.provider_playable,
    hasPlaybackUrl: row.has_playback_url,
    readyAt: row.ready_at?.toISOString() ?? null,
    providerCheckedAt: row.provider_checked_at?.toISOString() ?? null,
    createdAt: row.created_at.toISOString()
  };
}

function toAgeCheck(row: AgeCheckRow): AdminAgeCheck {
  return {
    id: row.id,
    userId: row.user_id,
    provider: row.provider,
    providerReference: row.provider_reference,
    state: row.state,
    jurisdiction: row.jurisdiction,
    rule: row.rule,
    hasProviderReference: row.has_provider_reference,
    privacyBoundary: "sanitized_age_state_no_raw_identity_payloads",
    verifiedAt: row.verified_at?.toISOString() ?? null,
    expiresAt: row.expires_at?.toISOString() ?? null,
    createdAt: row.created_at.toISOString()
  };
}

function toIdentityCheck(row: IdentityCheckRow): AdminIdentityCheck {
  return {
    id: row.id,
    userId: row.user_id,
    provider: row.provider,
    providerReference: row.provider_reference,
    verificationType: row.verification_type,
    state: row.state,
    countryCode: row.country_code,
    documentType: row.document_type,
    livenessState: row.liveness_state,
    walletOwnershipState: row.wallet_ownership_state,
    hasProviderReference: row.has_provider_reference,
    hasLegalNameHash: row.has_legal_name_hash,
    privacyBoundary: "sanitized_identity_minimized_no_raw_documents_or_pii",
    verifiedAt: row.verified_at?.toISOString() ?? null,
    expiresAt: row.expires_at?.toISOString() ?? null,
    createdAt: row.created_at.toISOString()
  };
}

function toAiSession(row: AiSessionRow): AdminAiSession {
  return {
    id: row.id,
    actorUserId: row.actor_user_id,
    scope: row.scope,
    state: row.state,
    allowedToolCount: Number(row.allowed_tool_count),
    createdAt: row.created_at.toISOString(),
    expiresAt: row.expires_at.toISOString()
  };
}

function toAiToolCall(row: AiToolCallRow): AdminAiToolCall {
  return {
    id: row.id,
    sessionId: row.session_id,
    actorUserId: row.actor_user_id,
    scope: row.scope,
    toolName: row.tool_name,
    state: row.state,
    confirmationState: row.confirmation_state,
    subjectType: row.subject_type,
    subjectId: row.subject_id,
    inputSummary: row.input_summary,
    outputSummary: row.output_summary,
    redactionBoundary: "summaries_only_no_tool_payloads_or_secrets",
    createdAt: row.created_at.toISOString()
  };
}

function toAuditEvent(row: AuditEventRow): AuditEvent {
  return {
    id: row.id,
    subjectType: row.subject_type,
    action: row.action,
    createdAt: row.created_at.toISOString()
  };
}

function toSupportCase(row: SupportCaseRow): AdminSupportCase {
  return {
    id: row.id,
    organizationId: row.organization_id,
    requesterUserId: row.requester_user_id,
    assignedStaffUserId: row.assigned_staff_user_id,
    category: row.category,
    state: row.state,
    priority: row.priority,
    subjectType: row.subject_type,
    subjectId: row.subject_id,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at?.toISOString() ?? null,
    closedAt: row.closed_at?.toISOString() ?? null
  };
}

function toSupportPolicy(row: SupportPolicyRow): AdminSupportPolicy {
  return {
    id: row.id,
    organizationId: row.organization_id,
    supportState: row.support_state,
    slaTier: row.sla_tier,
    state: row.state,
    policyReason: row.policy_reason,
    moneyBoundary: row.money_boundary,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString()
  };
}

function toRefundDispute(row: RefundDisputeRow): AdminRefundDispute {
  return {
    id: row.id,
    paymentIntentId: row.payment_intent_id,
    entitlementId: row.entitlement_id,
    reporterUserId: row.reporter_user_id,
    kind: row.kind,
    requestedAction: row.requested_action,
    state: row.state,
    resolution: row.resolution,
    custodyBoundary: row.custody_boundary,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at?.toISOString() ?? null,
    resolvedAt: row.resolved_at?.toISOString() ?? null
  };
}

function toDataRequest(row: DataRequestRow): AdminDataRequest {
  return {
    id: row.id,
    requesterUserId: row.requester_user_id,
    type: row.type,
    state: row.state,
    privacyBoundary: row.privacy_boundary,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at?.toISOString() ?? null,
    completedAt: row.completed_at?.toISOString() ?? null
  };
}

function toEvent(row: EventRow, ticketTypeRows: EventTicketTypeRow[]): Event {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    startsAt: row.starts_at.toISOString(),
    endsAt: row.ends_at?.toISOString() ?? null,
    accessRule: row.access_rule,
    location: {
      type: row.location_type,
      ...(row.location_label ? { label: row.location_label } : {}),
      ...(row.location_lat !== null ? { latitude: Number(row.location_lat) } : {}),
      ...(row.location_lng !== null ? { longitude: Number(row.location_lng) } : {})
    },
    state: row.state,
    ticketTypes: ticketTypeRows.map(toEventTicketType)
  };
}

function toEventTicketType(row: EventTicketTypeRow): EventTicketType {
  const issued = Number(row.issued_count);

  return {
    id: row.id,
    label: row.label,
    priceMinor: nullableNumber(row.price_minor),
    currency: row.currency,
    capacity: row.capacity,
    remaining: Math.max(row.capacity - issued, 0),
    state: issued >= row.capacity ? "sold_out" : row.state,
    saleStartsAt: row.sale_starts_at?.toISOString() ?? null,
    saleEndsAt: row.sale_ends_at?.toISOString() ?? null,
    perUserLimit: row.per_user_limit
  };
}

function toTicket(row: TicketRow): Ticket {
  return {
    id: row.id,
    eventId: row.event_id,
    ticketTypeId: row.ticket_type_id,
    holderUserId: row.holder_user_id,
    paymentIntentId: row.payment_intent_id,
    state: row.state,
    qrToken: "redacted",
    checkedInAt: row.checked_in_at?.toISOString() ?? null,
    createdAt: row.created_at.toISOString()
  };
}

function toComplianceLedgerEntry(row: ComplianceLedgerRow): AdminComplianceLedgerEntry {
  return {
    id: row.id,
    eventType: row.event_type,
    productType: normalizeAdminProductType(row.product_type),
    settlementModel: row.settlement_model,
    sellerUserId: row.seller_user_id,
    buyerUserId: row.buyer_user_id,
    paymentIntentId: row.payment_intent_id,
    entitlementId: row.entitlement_id,
    receiptId: row.receipt_id,
    invoiceId: row.vat_invoice_id,
    grossAmountMinor: Number(row.gross_amount_minor),
    platformFeeMinor: nullableNumber(row.platform_fee_minor),
    creatorNetAmountMinor: nullableNumber(row.creator_net_amount_minor),
    taxAmountMinor: nullableNumber(row.tax_amount_minor),
    currency: row.currency,
    fiatCurrency: row.fiat_currency,
    fxRate: row.fx_rate,
    sellerCountry: row.seller_country,
    buyerCountry: row.buyer_country,
    sellerOfRecord: row.seller_of_record ?? "undetermined",
    vatStatus: row.vat_status,
    dac7Reportable: row.dac7_reportable,
    carfReportable: row.carf_reportable,
    immutableHash: row.immutable_hash,
    createdAt: row.created_at.toISOString()
  };
}

function toComplianceReport(
  row: ComplianceReportRow,
  reportType: AdminComplianceReport["reportType"]
): AdminComplianceReport {
  return {
    id: row.id,
    reportType,
    reportingYear: Number(row.reporting_year),
    state: row.state,
    lineCount: Number(row.line_count),
    jurisdiction: row.jurisdiction,
    exportId: row.export_id,
    carfReportingRequired: row.carf_reporting_required ?? null,
    createdAt: row.created_at.toISOString(),
    exportedAt: row.exported_at?.toISOString() ?? null
  };
}

function toVatDetermination(row: VatDeterminationRow): AdminVatDetermination {
  return {
    id: row.id,
    productType: normalizeAdminProductType(row.product_type),
    sellerOfRecord: row.seller_of_record,
    buyerCountry: row.buyer_country,
    sellerCountry: row.seller_country,
    buyerVatId: row.buyer_vat_id_hash,
    viesStatus: row.vies_status ?? null,
    placeOfSupply: row.place_of_supply,
    vatStatus: row.vat_status,
    vatRateBps: nullableNumber(row.vat_rate_bps),
    vatAmountMinor: nullableNumber(row.vat_amount_minor),
    reviewState: row.review_state ?? "clear",
    createdAt: row.created_at.toISOString()
  };
}

function toReceipt(row: ReceiptRow): AdminReceipt {
  return {
    id: row.id,
    receiptNumber: row.receipt_number,
    productType: normalizeAdminProductType(row.product_type),
    buyerUserId: row.buyer_user_id,
    sellerUserId: row.seller_user_id,
    paymentIntentId: row.payment_intent_id,
    grossAmountMinor: Number(row.gross_amount_minor),
    currency: row.currency,
    state: row.state,
    issuedAt: row.issued_at.toISOString()
  };
}

function toInvoice(row: InvoiceRow): AdminInvoice {
  return {
    id: row.id,
    invoiceNumber: row.invoice_number,
    sellerOfRecord: row.seller_of_record,
    buyerUserId: row.buyer_user_id,
    sellerUserId: row.seller_user_id,
    totalAmountMinor: Number(row.total_amount_minor),
    vatAmountMinor: Number(row.vat_amount_minor),
    currency: row.currency,
    state: row.state,
    issuedAt: row.issued_at.toISOString()
  };
}

function toReferralProgram(row: ReferralProgramRow): AdminReferralProgram {
  return {
    id: row.id,
    name: row.name,
    state: row.state,
    priority: row.priority,
    ...(row.commission_source ? { commissionSource: row.commission_source } : {}),
    createdAt: row.created_at.toISOString()
  };
}

function toPartnerCampaign(row: PartnerCampaignRow): AdminPartnerCampaign {
  return {
    id: row.id,
    name: row.name,
    partnerName: row.partner_name,
    state: row.state,
    contractId: row.contract_id,
    createdAt: row.created_at.toISOString()
  };
}

function toTierWaiver(row: TierWaiverRow): AdminTierWaiver {
  return {
    id: row.id,
    subjectType: row.subject_type,
    subjectId: row.subject_id,
    tierKey: row.tier_key,
    state: row.state,
    startsAt: row.starts_at.toISOString(),
    endsAt: row.ends_at?.toISOString() ?? null
  };
}

function toOrganization(row: OrganizationRow): AdminOrganization {
  return {
    id: row.id,
    name: row.name,
    state: row.state,
    plan: row.plan,
    ...(row.kyb_state ? { kybState: row.kyb_state } : {}),
    createdAt: row.created_at.toISOString()
  };
}

function toOrganizationMember(row: OrganizationMemberRow): AdminOrganizationMember {
  return {
    id: row.id,
    organizationId: row.organization_id,
    userId: row.user_id,
    role: row.role,
    state: row.state,
    invitedByUserId: row.invited_by_user_id,
    joinedAt: row.joined_at?.toISOString() ?? null,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at?.toISOString() ?? null
  };
}

function toFeatureFlag(row: FeatureFlagRow): AdminFeatureFlag {
  return {
    key: row.key,
    value: row.value,
    category: row.category,
    policyBoundary: row.policy_boundary,
    state: row.state,
    updatedAt: row.updated_at.toISOString()
  };
}

function contentModerationForAction(action: string): {
  moderationState: string;
  state: AdminContentItem["state"];
} {
  switch (action) {
    case "approve":
    case "reinstate":
      return { moderationState: "approved", state: "ready" };
    case "restrict":
      return { moderationState: "restricted", state: "ready" };
    case "block":
      return { moderationState: "blocked", state: "blocked" };
    case "delete":
      return { moderationState: "deleted", state: "deleted" };
    default:
      return { moderationState: "pending", state: "draft" };
  }
}

function nullableNumber(value: string | number | null): number | null {
  return value === null ? null : Number(value);
}

function normalizeAdminProductType(productType: string): AdminComplianceLedgerEntry["productType"] {
  switch (productType) {
    case "tip":
      return "support";
    case "event_ticket":
      return "event_access_pass";
    case "creator_subscription":
      return "membership";
    case "platform_subscription":
      return "platform_plus";
    default:
      return productType as AdminComplianceLedgerEntry["productType"];
  }
}
