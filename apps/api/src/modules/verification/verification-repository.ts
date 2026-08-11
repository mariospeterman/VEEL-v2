import { randomUUID } from "node:crypto";
import {
  resolvePostgresClient,
  type PostgresSql,
  type PostgresTransaction
} from "../../shared/postgres.js";
import type {
  CapabilityKey,
  CapabilityResolution,
  NormalizedVerificationWebhook,
  VerificationPurpose,
  VerificationRecordResource,
  VerificationRepository
} from "./types.js";

export class VerificationRepositoryConfigurationError extends Error {
  constructor() {
    super("DATABASE_URL_NOT_CONFIGURED");
    this.name = "VerificationRepositoryConfigurationError";
  }
}

interface VerificationRecordRow {
  subject_type: VerificationRecordResource["subjectType"];
  subject_id: string;
  purpose: VerificationRecordResource["purpose"];
  status: VerificationRecordResource["status"];
  provider: string;
  method: string;
  assurance_level: string;
  verified_at: Date | null;
  expires_at: Date | null;
  reusable: boolean;
}

export function createPostgresVerificationRepository(database?: string | PostgresSql): VerificationRepository {
  if (!database) {
    return {
      async createPendingSession() {
        throw new VerificationRepositoryConfigurationError();
      },
      async applyProviderWebhook() {
        throw new VerificationRepositoryConfigurationError();
      },
      async updateVerificationFromWebhook() {
        throw new VerificationRepositoryConfigurationError();
      },
      async findLatestUserVerification() {
        throw new VerificationRepositoryConfigurationError();
      },
      async findLatestOrganizationVerification() {
        throw new VerificationRepositoryConfigurationError();
      },
      async resolveCapabilities() {
        throw new VerificationRepositoryConfigurationError();
      }
    };
  }

  const { sql, ownsClient } = resolvePostgresClient(database);

  return {
    async createPendingSession(input) {
      const subject = await resolveSessionSubject(sql, input);
      const providerSession = input.providerSession;
      const rows = await sql<Array<{ id: string }>>`
        insert into verification_sessions (
          subject_type,
          subject_id,
          purpose,
          provider,
          provider_session_id,
          provider_applicant_id,
          provider_inquiry_id,
          provider_transaction_id,
          requested_method,
          status,
          assurance_level,
          reusable,
          expires_at
        )
        values (
          ${subject.subjectType},
          ${subject.subjectId},
          ${input.purpose},
          ${providerSession.provider},
          ${providerSession.providerReference},
          ${providerSession.providerApplicantId ?? null},
          ${providerSession.providerInquiryId ?? null},
          ${providerSession.providerTransactionId ?? null},
          ${providerSession.method},
          'pending',
          ${providerSession.assuranceLevel},
          ${providerSession.reusable ?? false},
          ${providerSession.expiresAt}
        )
        returning id
      `;

      await sql`
        insert into verification_records (
          subject_type,
          subject_id,
          purpose,
          status,
          provider,
          provider_reference,
          method,
          assurance_level,
          expires_at,
          reusable,
          metadata
        )
        values (
          ${subject.subjectType},
          ${subject.subjectId},
          ${input.purpose},
          'pending',
          ${providerSession.provider},
          ${providerSession.providerReference},
          ${providerSession.method},
          ${providerSession.assuranceLevel},
          ${providerSession.expiresAt},
          ${providerSession.reusable ?? false},
          ${JSON.stringify({ source: "verification_session" })}::jsonb
        )
      `;

      return rows[0]?.id ?? "";
    },
    async applyProviderWebhook(input) {
      return sql.begin(async (tx) => {
        const rows = await tx<Array<{ id: string }>>`
          insert into verification_events (
            provider,
            event_type,
            idempotency_key,
            payload_hash,
            processing_status
          )
          values (
            ${input.provider},
            ${input.eventType},
            ${input.providerEventId},
            ${input.payloadHash},
            'received'
          )
          on conflict do nothing
          returning id
        `;

        if (rows.length === 0) return "duplicate" as const;
        const applied = await applyVerificationWebhookDecision(tx, input, true);
        return applied ? "applied" as const : "unmatched" as const;
      });
    },
    async updateVerificationFromWebhook(input) {
      return sql.begin((tx) => applyVerificationWebhookDecision(tx, input, false));
    },
    async findLatestUserVerification(input) {
      const rows = await sql<VerificationRecordRow[]>`
        select
          vr.subject_type,
          vr.subject_id,
          vr.purpose,
          case
            when vr.status = 'valid' and vr.expires_at is not null and vr.expires_at <= now() then 'expired'
            else vr.status
          end as status,
          vr.provider,
          vr.method,
          vr.assurance_level,
          vr.verified_at,
          vr.expires_at,
          vr.reusable
        from verification_records vr
        join users u on u.id = vr.subject_id
        where vr.subject_type = 'user'
          and u.supabase_user_id = ${input.supabaseUserId}
          and vr.purpose = ${input.purpose}
        order by vr.created_at desc, vr.id desc
        limit 1
      `;

      return rows[0] ? toRecord(rows[0]) : null;
    },
    async findLatestOrganizationVerification(input) {
      const rows = await sql<VerificationRecordRow[]>`
        select
          subject_type,
          subject_id,
          purpose,
          case
            when status = 'valid' and expires_at is not null and expires_at <= now() then 'expired'
            else status
          end as status,
          provider,
          method,
          assurance_level,
          verified_at,
          expires_at,
          reusable
        from verification_records
        where subject_type = 'organization'
          and subject_id = ${input.organizationId}
          and purpose = ${input.purpose}
        order by created_at desc, id desc
        limit 1
      `;

      return rows[0] ? toRecord(rows[0]) : null;
    },
    async resolveCapabilities(input) {
      const [ageAccess, adultContentAccess, creatorKyc, orgKyb] = await Promise.all([
        this.findLatestUserVerification({
          supabaseUserId: input.supabaseUserId,
          purpose: "age_access"
        }),
        this.findLatestUserVerification({
          supabaseUserId: input.supabaseUserId,
          purpose: "adult_content_access"
        }),
        this.findLatestUserVerification({
          supabaseUserId: input.supabaseUserId,
          purpose: "creator_kyc"
        }),
        input.organizationId
          ? this.findLatestOrganizationVerification({
              organizationId: input.organizationId,
              purpose: "org_kyb"
            })
          : Promise.resolve(null)
      ]);

      return resolveCapabilitiesFromRecords({
        ageAccess,
        adultContentAccess,
        creatorKyc,
        orgKyb
      });
    },
    async close() {
      if (ownsClient) {
        await sql.end({ timeout: 5 });
      }
    }
  };
}

async function applyVerificationWebhookDecision(
  tx: PostgresTransaction,
  input: NormalizedVerificationWebhook,
  trackEvent: boolean
): Promise<boolean> {
  const sessionRows = await tx<Array<{
    id: string;
    subject_type: VerificationRecordResource["subjectType"];
    subject_id: string;
    purpose: VerificationPurpose;
    requested_method: VerificationRecordResource["method"];
    assurance_level: VerificationRecordResource["assuranceLevel"];
    reusable: boolean;
    expires_at: Date | null;
  }>>`
    select
      id, subject_type, subject_id, purpose, requested_method,
      assurance_level, reusable, expires_at
    from verification_sessions
    where provider = ${input.provider}
      and (
        provider_session_id = ${input.providerReference}
        or provider_applicant_id = ${input.providerReference}
        or provider_inquiry_id = ${input.providerReference}
        or provider_transaction_id = ${input.providerReference}
      )
    order by created_at desc
    limit 1
    for update
  `;
  const session = sessionRows[0];

  if (!session) {
    if (trackEvent) {
      await tx`
        update verification_events
        set processing_status = 'ignored', processed_at = now()
        where provider = ${input.provider}
          and idempotency_key = ${input.providerEventId}
      `;
    }
    return false;
  }

  await tx`
    update verification_sessions
    set
      status = ${sessionStatus(input.status)},
      updated_at = now(),
      completed_at = case when ${input.status} in ('valid', 'invalid', 'blocked') then coalesce(${input.occurredAt ?? null}, now()) else completed_at end
    where id = ${session.id}
  `;

  const records = await tx<Array<{ id: string }>>`
    insert into verification_records (
      subject_type, subject_id, purpose, status, provider, provider_reference,
      method, assurance_level, verified_at, expires_at, reusable,
      raw_payload_hash, failure_reason_code, metadata
    )
    values (
      ${session.subject_type}, ${session.subject_id}, ${session.purpose}, ${input.status},
      ${input.provider}, ${input.providerReference}, ${session.requested_method},
      ${session.assurance_level},
      case when ${input.status} = 'valid' then coalesce(${input.occurredAt ?? null}, now()) else null end,
      ${session.expires_at}, ${session.reusable}, ${input.signatureHash},
      ${input.failureReasonCode ?? null},
      ${tx.json({ source: "provider_webhook", eventType: input.eventType })}
    )
    returning id
  `;

  if (trackEvent) {
    await tx`
      update verification_events
      set session_id = ${session.id}, processing_status = 'processed', processed_at = now()
      where provider = ${input.provider}
        and idempotency_key = ${input.providerEventId}
    `;
  }

  await tx`
    insert into audit_events (id, actor_user_id, subject_type, subject_id, action, metadata)
    values (
      ${randomUUID()}, null, 'verification_record', ${records[0]?.id ?? session.id},
      'verification.webhook_applied',
      ${tx.json({
        provider: input.provider,
        providerEventId: input.providerEventId,
        purpose: session.purpose,
        status: input.status
      })}
    )
  `;

  return true;
}

async function resolveSessionSubject(
  sql: PostgresSql,
  input: {
    supabaseUserId: string;
    purpose: Extract<
      VerificationPurpose,
      "age_access" | "adult_content_access" | "creator_kyc" | "org_kyb"
    >;
    organizationId?: string | null;
  }
): Promise<{ subjectType: VerificationRecordResource["subjectType"]; subjectId: string }> {
  if (input.purpose === "org_kyb") {
    if (!input.organizationId) {
      throw new Error("ORGANIZATION_ID_REQUIRED");
    }

    const rows = await sql<Array<{ organization_id: string }>>`
      select om.organization_id
      from organization_memberships om
      join users u on u.id = om.user_id
      where u.supabase_user_id = ${input.supabaseUserId}
        and om.organization_id = ${input.organizationId}
        and om.state = 'active'
      limit 1
    `;

    if (!rows[0]) {
      throw new Error("ORGANIZATION_ACCESS_REQUIRED");
    }

    return { subjectType: "organization", subjectId: rows[0].organization_id };
  }

  const rows = await sql<Array<{ id: string }>>`
    select id
    from users
    where supabase_user_id = ${input.supabaseUserId}
    limit 1
  `;

  if (!rows[0]) {
    throw new Error("USER_NOT_FOUND");
  }

  return { subjectType: "user", subjectId: rows[0].id };
}

function sessionStatus(status: NormalizedVerificationWebhook["status"]) {
  if (status === "valid") return "approved";
  if (status === "blocked" || status === "invalid") return "declined";
  return "pending";
}

export function resolveCapabilitiesFromRecords(input: {
  ageAccess: VerificationRecordResource | null;
  adultContentAccess?: VerificationRecordResource | null;
  creatorKyc: VerificationRecordResource | null;
  orgKyb: VerificationRecordResource | null;
}): CapabilityResolution {
  const hasAge = isValid(input.ageAccess);
  const hasAdultContentAccess = hasAge && isValid(input.adultContentAccess ?? null);
  const hasCreatorKyc = isValid(input.creatorKyc);
  const capabilities: Record<CapabilityKey, boolean> = {
    canAccessApp: hasAge,
    canCreateProfile: hasAge,
    canViewAgeRestrictedContent: hasAge,
    canStartCreatorOnboarding: hasAge,
    canCreateDraft: hasAge,
    canUploadMedia: hasAge,
    canPublishMedia: hasAge,
    canPublishAdultMedia: hasAdultContentAccess,
    canMonetize: hasAge && hasCreatorKyc,
    canReceivePayouts: hasAge && hasCreatorKyc,
    canAccessCreatorDashboard: hasAge,
    canCreateOrganization: hasAge,
    canAccessStudio: false,
    canInviteTeam: false,
    canUseTeamPublishing: false,
    canUseAllocationWallets: false,
    canUseComplianceExports: false,
    canAccessEnterprise: false
  };
  const missingRequirements = missingFromCapabilities(capabilities);

  return {
    capabilities,
    missingRequirements,
    nextBestAction: nextBestAction(capabilities),
    verificationSummary: {
      ageAccess: input.ageAccess,
      adultContentAccess: input.adultContentAccess ?? null,
      creatorKyc: input.creatorKyc,
      orgKyb: input.orgKyb
    }
  };
}

export function isValid(record: VerificationRecordResource | null): boolean {
  if (!record || record.status !== "valid") {
    return false;
  }

  if (!record.expiresAt) {
    return true;
  }

  return new Date(record.expiresAt).getTime() > Date.now();
}

function missingFromCapabilities(capabilities: Record<CapabilityKey, boolean>): string[] {
  const missing = new Set<string>();

  if (!capabilities.canAccessApp) {
    missing.add("age_access_required");
  }
  if (!capabilities.canPublishAdultMedia) {
    missing.add("adult_verification_required_for_nsfw");
  }
  if (!capabilities.canMonetize) {
    missing.add("creator_kyc_required_for_earning");
  }
  return [...missing];
}

function nextBestAction(capabilities: Record<CapabilityKey, boolean>): string {
  if (!capabilities.canAccessApp) {
    return "verify_age";
  }
  return "continue";
}

function toRecord(row: VerificationRecordRow): VerificationRecordResource {
  return {
    subjectType: row.subject_type,
    subjectId: row.subject_id,
    purpose: row.purpose,
    status: row.status,
    provider: row.provider,
    method: row.method,
    assuranceLevel: row.assurance_level,
    verifiedAt: row.verified_at?.toISOString() ?? null,
    expiresAt: row.expires_at?.toISOString() ?? null,
    reusable: row.reusable
  };
}
