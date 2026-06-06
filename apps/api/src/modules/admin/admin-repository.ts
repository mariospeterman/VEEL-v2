import postgres from "postgres";
import type {
  AdminComplianceLedgerEntry,
  AdminComplianceReport,
  AdminDataRequest,
  AdminDatingSafety,
  AdminFeatureFlag,
  AdminInvoice,
  AdminNotificationHealth,
  AdminOpsSummary,
  AdminOrganization,
  AdminOrganizationMember,
  AdminPartnerCampaign,
  AdminPaymentIntent,
  AdminProviderEvent,
  AdminReceipt,
  AdminRepository,
  AdminRefundDispute,
  AdminReferralProgram,
  AdminSupportCase,
  AdminSupportPolicy,
  AdminTierWaiver,
  AdminVatDetermination,
  AdminUnlock,
  AuditEvent
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
      async listPaymentIntents() {
        throw new AdminRepositoryConfigurationError();
      },
      async listUnlocks() {
        throw new AdminRepositoryConfigurationError();
      },
      async listProviderEvents() {
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
      async getDatingSafety() {
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
        select id, provider, event_type, normalized_state, received_at, processed_at
        from provider_events
        where (${input.cursor ?? null}::timestamptz is null or received_at < ${input.cursor ?? null}::timestamptz)
        order by received_at desc
        limit ${pageSize + 1}
      `;

      return page(rows, toProviderEvent);
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
    async getDatingSafety() {
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
        activeMatches: Number(row?.active_matches ?? 0),
        staleMatches: Number(row?.stale_matches ?? 0)
      } satisfies AdminDatingSafety;
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
    processedAt: row.processed_at?.toISOString() ?? null
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
