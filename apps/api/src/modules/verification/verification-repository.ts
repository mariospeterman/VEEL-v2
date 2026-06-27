import { resolvePostgresClient, type PostgresSql } from "../../shared/postgres.js";
import type {
  CapabilityKey,
  CapabilityResolution,
  ResolveCapabilitiesInput,
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
        order by
          case when vr.status = 'valid' and (vr.expires_at is null or vr.expires_at > now()) then 0 else 1 end,
          vr.verified_at desc nulls last,
          vr.created_at desc
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
        order by
          case when status = 'valid' and (expires_at is null or expires_at > now()) then 0 else 1 end,
          verified_at desc nulls last,
          created_at desc
        limit 1
      `;

      return rows[0] ? toRecord(rows[0]) : null;
    },
    async resolveCapabilities(input) {
      const [ageAccess, creatorKyc, orgKyb] = await Promise.all([
        this.findLatestUserVerification({
          supabaseUserId: input.supabaseUserId,
          purpose: "age_access"
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

      return resolveCapabilitiesFromRecords({ ageAccess, creatorKyc, orgKyb });
    },
    async close() {
      if (ownsClient) {
        await sql.end({ timeout: 5 });
      }
    }
  };
}

export function resolveCapabilitiesFromRecords(input: {
  ageAccess: VerificationRecordResource | null;
  creatorKyc: VerificationRecordResource | null;
  orgKyb: VerificationRecordResource | null;
}): CapabilityResolution {
  const hasAge = isValid(input.ageAccess);
  const hasCreatorKyc = isValid(input.creatorKyc);
  const hasOrgKyb = isValid(input.orgKyb);
  const capabilities: Record<CapabilityKey, boolean> = {
    canAccessApp: hasAge,
    canCreateProfile: hasAge,
    canViewAgeRestrictedContent: hasAge,
    canStartCreatorOnboarding: hasAge,
    canCreateDraft: hasAge,
    canUploadMedia: hasAge && hasCreatorKyc,
    canPublishMedia: hasAge && hasCreatorKyc,
    canMonetize: hasAge && hasCreatorKyc,
    canReceivePayouts: hasAge && hasCreatorKyc,
    canAccessCreatorDashboard: hasAge,
    canCreateOrganization: hasAge,
    canAccessStudio: hasAge,
    canInviteTeam: hasAge && hasOrgKyb,
    canUseTeamPublishing: hasAge && hasOrgKyb && hasCreatorKyc,
    canUseAllocationWallets: hasAge && hasOrgKyb,
    canUseComplianceExports: hasAge && hasOrgKyb,
    canAccessEnterprise: hasAge && hasOrgKyb
  };
  const missingRequirements = missingFromCapabilities(capabilities);

  return {
    capabilities,
    missingRequirements,
    nextBestAction: nextBestAction(capabilities, missingRequirements),
    verificationSummary: {
      ageAccess: input.ageAccess,
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
  if (!capabilities.canUploadMedia || !capabilities.canPublishMedia || !capabilities.canMonetize) {
    missing.add("creator_kyc_required");
  }
  if (!capabilities.canAccessEnterprise || !capabilities.canUseComplianceExports) {
    missing.add("org_kyb_required");
  }
  if (!capabilities.canUseTeamPublishing) {
    missing.add("creator_kyc_required_for_team_publishing");
  }

  return [...missing];
}

function nextBestAction(capabilities: Record<CapabilityKey, boolean>, missing: string[]): string {
  if (!capabilities.canAccessApp) {
    return "verify_age";
  }
  if (missing.includes("creator_kyc_required")) {
    return "verify_creator_identity";
  }
  if (missing.includes("org_kyb_required")) {
    return "verify_business";
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
