import { resolvePostgresClient, type PostgresSql } from "../../shared/postgres.js";
import type { AdminRepository } from "./types.js";
import { createAccessRepository } from "./admin-repository-access.js";
import { createComplianceRepository } from "./admin-repository-compliance.js";
import { createEventOpsRepository } from "./admin-repository-event-ops.js";
import { createGrowthRepository } from "./admin-repository-growth.js";
import { createModerationRepository } from "./admin-repository-moderation.js";
import { createMoneyRepository } from "./admin-repository-money.js";
import { createOrganizationRepository } from "./admin-repository-organization.js";
import { createPrivacyRepository } from "./admin-repository-privacy.js";
import { createFeatureFlagRepository } from "./admin-repository-feature-flag.js";
import { createSupportRepository } from "./admin-repository-support.js";
import { createStaffRepository } from "./admin-repository-staff.js";
import { createUnconfiguredAdminRepository } from "./admin-repository-unconfigured.js";

export { AdminRepositoryConfigurationError, AdminRepositoryStateConflictError } from "./admin-repository-errors.js";

export function createPostgresAdminRepository(database?: string | PostgresSql): AdminRepository {
  if (!database) {
    return createUnconfiguredAdminRepository();
  }

  const { sql, ownsClient } = resolvePostgresClient(database);

  return {
    ...createAccessRepository(sql),
    ...createStaffRepository(sql),
    ...createModerationRepository(sql),
    ...createMoneyRepository(sql),
    ...createSupportRepository(sql),
    ...createPrivacyRepository(sql),
    ...createEventOpsRepository(sql),
    ...createComplianceRepository(sql),
    ...createGrowthRepository(sql),
    ...createOrganizationRepository(sql),
    ...createFeatureFlagRepository(sql),
    async close() {
      if (ownsClient) {
        await sql.end({ timeout: 5 });
      }
    }
  };
}
