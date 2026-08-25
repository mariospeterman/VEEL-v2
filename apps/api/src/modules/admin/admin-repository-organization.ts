import type postgres from "postgres";
import type { AdminRepository } from "./types.js";
import { AdminRepositoryStateConflictError } from "./admin-repository-errors.js";
import {
  OrganizationRow,
  OrganizationMemberRow,
  LockedOrganizationMemberRow,
  pageSize,
  page,
  toOrganization,
  toOrganizationMember
} from "./admin-repository-mappers.js";

export function createOrganizationRepository(
  sql: postgres.Sql
): Pick<AdminRepository, "listOrganizations" | "provisionOrganization" | "updateOrganizationKyb" | "listOrganizationMembers" | "updateOrganizationMember"> {
  return {
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
    async provisionOrganization(input) {
      const rows = await sql.begin(async (transaction): Promise<OrganizationRow[]> => {
        const parties = await transaction<Array<{ actor_id: string; owner_id: string }>>`
          select actor.id as actor_id, owner.id as owner_id
          from users actor
          join profiles owner_profile on lower(owner_profile.handle) = lower(${input.body.ownerHandle})
          join users owner on owner.id = owner_profile.user_id and owner.state = 'active'
          where actor.supabase_user_id = ${input.supabaseUserId}
          limit 1
        `;
        const party = parties[0];
        if (!party) return [];

        await transaction`
          select pg_advisory_xact_lock(
            hashtextextended(${`enterprise-action:${party.actor_id}:organization_provision:${input.idempotencyKey}`}, 0)
          )
        `;
        const receipts = await transaction<Array<{ request_hash: string; organization_id: string | null }>>`
          select request_hash, organization_id
          from enterprise_action_receipts
          where actor_user_id = ${party.actor_id}
            and action = 'organization_provision'
            and idempotency_key = ${input.idempotencyKey}
          limit 1
        `;
        const receipt = receipts[0];
        if (receipt) {
          if (receipt.request_hash !== input.requestHash) {
            throw new AdminRepositoryStateConflictError("Idempotency key was already used for a different organization request");
          }
          if (!receipt.organization_id) return [];
          return transaction<OrganizationRow[]>`
            select id, name, state, plan, kyb_state, created_at
            from organizations where id = ${receipt.organization_id} limit 1
          `;
        }

        const duplicates = await transaction<Array<{ id: string }>>`
          select id from organizations
          where lower(name) = lower(${input.body.name}) and state <> 'archived'
          limit 1
        `;
        if (duplicates[0]) {
          throw new AdminRepositoryStateConflictError("An active organization with this name already exists");
        }

        const organizations = await transaction<OrganizationRow[]>`
          insert into organizations (id, name, state, plan, kyb_state)
          values (gen_random_uuid(), ${input.body.name}, 'pending_kyb', 'enterprise', 'not_started')
          returning id, name, state, plan, kyb_state, created_at
        `;
        const organization = organizations[0];
        if (!organization) return [];
        const memberships = await transaction<Array<{ id: string }>>`
          insert into organization_memberships (
            id, organization_id, user_id, role, state, invited_by_user_id, joined_at
          ) values (
            gen_random_uuid(), ${organization.id}, ${party.owner_id}, 'owner', 'invited', ${party.actor_id}, null
          )
          returning id
        `;
        const membership = memberships[0];
        if (!membership) return [];
        await transaction`
          insert into notifications (
            id, user_id, kind, title, body, action_url, related_resource_type, related_resource_id, idempotency_key
          ) values (
            gen_random_uuid(), ${party.owner_id}, 'studio_setup', 'Enterprise organization invitation',
            'Review and accept the owner role before starting organization KYB.', '/app/enterprise',
            'organization_membership', ${membership.id}, ${`organization-provision:${organization.id}`}
          )
          on conflict (user_id, idempotency_key) do nothing
        `;
        await transaction`
          insert into audit_events (
            id, actor_user_id, subject_type, subject_id, action, metadata, idempotency_key
          ) values (
            gen_random_uuid(), ${party.actor_id}, 'organization', ${organization.id},
            'organization.provisioned',
            ${JSON.stringify({
              ownerUserId: party.owner_id,
              ownerMembershipId: membership.id,
              reason: input.body.reason,
              initialState: "pending_kyb",
              ownerConsentState: "invited"
            })}::jsonb,
            ${input.idempotencyKey}
          )
        `;
        await transaction`
          insert into enterprise_action_receipts (
            actor_user_id, organization_id, membership_id, action, idempotency_key, request_hash
          ) values (
            ${party.actor_id}, ${organization.id}, ${membership.id}, 'organization_provision',
            ${input.idempotencyKey}, ${input.requestHash}
          )
        `;
        return [organization];
      });
      return rows[0] ? toOrganization(rows[0]) : null;
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
          ),
          verification_insert as (
            insert into verification_records (
              subject_type,
              subject_id,
              purpose,
              status,
              provider,
              method,
              assurance_level,
              verified_at,
              reusable,
              manual_review_reason,
              metadata
            )
            select
              'organization',
              updated_org.id,
              'org_kyb',
              case
                when updated_org.kyb_state = 'verified' then 'valid'
                when updated_org.kyb_state = 'pending' then 'pending'
                when updated_org.kyb_state = 'rejected' then 'blocked'
                else 'invalid'
              end,
              'manual',
              'manual_review',
              case when updated_org.kyb_state = 'verified' then 'business_verified' else 'low' end,
              case when updated_org.kyb_state = 'verified' then now() else null end,
              false,
              ${input.body.reason},
              jsonb_build_object(
                'source', 'admin_kyb_override',
                'idempotencyKey', ${input.idempotencyKey},
                'auditEventId', audit_insert.id
              )
            from updated_org
            cross join audit_insert
            returning id
          )
          select id, name, state, plan, kyb_state, created_at
          from updated_org
          where exists (select 1 from verification_insert)
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
  };
}
