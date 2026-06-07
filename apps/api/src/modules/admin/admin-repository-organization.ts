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
): Pick<AdminRepository, "listOrganizations" | "updateOrganizationKyb" | "listOrganizationMembers" | "updateOrganizationMember"> {
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
  };
}
