import { randomUUID } from "node:crypto";
import { resolvePostgresClient, type PostgresSql, type PostgresTransaction } from "../../shared/postgres.js";
import type {
  ManagedCreatorRelationshipResource,
  ManagedCreatorReportingResource,
  ManagedCreatorRepository
} from "./types.js";

interface Row {
  id: string; organization_id: string; organization_name: string; creator_user_id: string;
  creator_handle: string; state: string; agreement_id: string; version_number: number;
  agreement_state: string; permissions: ManagedCreatorRelationshipResource["permissions"];
  creator_share_bps: number; enterprise_management_share_bps: number;
  organization_kyb_ready: boolean; enterprise_entitlement_ready: boolean; settlement_wallet_ready: boolean;
  viewer_role: "creator" | "organization_member";
  organization_role: "owner" | "admin" | "member" | "viewer" | null;
}

export class ManagedCreatorRepositoryConfigurationError extends Error {
  constructor() { super("MANAGED_CREATOR_REPOSITORY_NOT_CONFIGURED"); this.name = "ManagedCreatorRepositoryConfigurationError"; }
}

export class ManagedCreatorIdempotencyConflictError extends Error {
  constructor() { super("IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_REQUEST"); this.name = "ManagedCreatorIdempotencyConflictError"; }
}

export class ManagedCreatorStateConflictError extends Error {
  constructor(message: string) { super(message); this.name = "ManagedCreatorStateConflictError"; }
}

export function createPostgresManagedCreatorRepository(database?: string | PostgresSql): ManagedCreatorRepository {
  if (!database) {
    const unavailable = async () => { throw new ManagedCreatorRepositoryConfigurationError(); };
    return {
      listMine: unavailable,
      getReporting: unavailable,
      invite: unavailable,
      respond: unavailable,
      proposeAgreement: unavailable,
      respondToAgreement: unavailable,
      terminate: unavailable
    };
  }
  const { sql, ownsClient } = resolvePostgresClient(database);
  return {
    async listMine(input) {
      return map(await sql.unsafe<Row[]>(`${selectSql()}
        where creator.supabase_user_id = $1
          or exists (select 1 from organization_memberships mine where mine.organization_id = r.organization_id and mine.user_id = actor.id and mine.state = 'active')
        order by r.updated_at desc`, [input.supabaseUserId]));
    },
    async getReporting(input) {
      const rows = await sql<Array<{
        organization_id: string;
        creator_user_id: string;
        currency: "SOL" | "USDC" | null;
        confirmed_payment_count: number;
        creator_side_proceeds_minor: string | null;
        creator_net_minor: string | null;
        enterprise_management_minor: string | null;
      }>>`
        with actor as (
          select id from users where supabase_user_id = ${input.supabaseUserId} limit 1
        ), authorized_relationship as (
          select relationship.organization_id, relationship.creator_user_id
          from managed_creator_relationships relationship
          join actor on true
          where relationship.id = ${input.relationshipId}
            and (
              relationship.creator_user_id = actor.id
              or (
                exists (
                  select 1 from organization_memberships membership
                  where membership.organization_id = relationship.organization_id
                    and membership.user_id = actor.id
                    and membership.state = 'active'
                )
                and exists (
                  select 1 from managed_creator_agreements agreement
                  where agreement.relationship_id = relationship.id
                    and agreement.permissions @> array['analytics_view']::text[]
                    and agreement.state in ('accepted', 'superseded', 'terminated')
                )
              )
            )
        )
        select authorized.organization_id, authorized.creator_user_id,
          allocation.currency,
          count(allocation.id)::int as confirmed_payment_count,
          coalesce(sum(allocation.creator_side_proceeds_minor), 0)::text as creator_side_proceeds_minor,
          coalesce(sum(allocation.creator_net_minor), 0)::text as creator_net_minor,
          coalesce(sum(allocation.enterprise_management_minor), 0)::text as enterprise_management_minor
        from authorized_relationship authorized
        left join managed_creator_allocation_records allocation
          on allocation.relationship_id = ${input.relationshipId}
          and allocation.state = 'confirmed'
        group by authorized.organization_id, authorized.creator_user_id, allocation.currency
        order by allocation.currency nulls last
      `;
      const first = rows[0];
      if (!first) return null;
      return {
        relationshipId: input.relationshipId,
        organizationId: first.organization_id,
        creatorUserId: first.creator_user_id,
        totals: rows.flatMap((row) => row.currency ? [{
          currency: row.currency,
          confirmedPaymentCount: Number(row.confirmed_payment_count),
          creatorSideProceedsMinor: safeInteger(row.creator_side_proceeds_minor),
          creatorNetMinor: safeInteger(row.creator_net_minor),
          enterpriseManagementMinor: safeInteger(row.enterprise_management_minor)
        }] : []),
        generatedAt: new Date().toISOString(),
        financeBoundary: "confirmed_allocations_only_no_balance_no_withdrawal_no_payout_queue"
      } satisfies ManagedCreatorReportingResource;
    },
    async invite(input) {
      const rows = await sql.begin(async (tx): Promise<Row[]> => {
        await tx`select pg_advisory_xact_lock(hashtextextended(${`${input.organizationId}:${input.idempotencyKey}`}, 0))`;
        const parties = await tx<{ actor_id: string; creator_id: string }[]>`
          select actor.id as actor_id, creator.id as creator_id
          from users actor
          join organization_memberships member on member.user_id = actor.id
          join profiles profile on lower(profile.handle) = lower(${input.creatorHandle})
          join users creator on creator.id = profile.user_id and creator.state = 'active'
          where actor.supabase_user_id = ${input.supabaseUserId}
            and member.organization_id = ${input.organizationId}
            and member.state = 'active' and member.role in ('owner', 'admin')
          limit 1
        `;
        const party = parties[0];
        if (!party || party.actor_id === party.creator_id) return [];
        const replayRelationshipId = await findActionReceipt(
          tx, party.actor_id, "managed_creator_invite", input.idempotencyKey, input.requestHash
        );
        if (replayRelationshipId) return selectById(tx, replayRelationshipId, input.supabaseUserId);
        const existingRows = await tx<{ id: string }[]>`
          select id from managed_creator_relationships
          where organization_id = ${input.organizationId} and idempotency_key = ${input.idempotencyKey}
          limit 1
        `;
        if (existingRows[0]) {
          await recordActionReceipt(tx, {
            actorUserId: party.actor_id,
            organizationId: input.organizationId,
            relationshipId: existingRows[0].id,
            action: "managed_creator_invite",
            idempotencyKey: input.idempotencyKey,
            requestHash: input.requestHash
          });
          return selectById(tx, existingRows[0].id, input.supabaseUserId);
        }

        const currentRows = await tx<{ id: string; state: string }[]>`
          select id, state from managed_creator_relationships
          where organization_id = ${input.organizationId} and creator_user_id = ${party.creator_id}
          for update limit 1
        `;
        const current = currentRows[0];
        if (current?.state === "active" || current?.state === "invited") {
          throw new ManagedCreatorStateConflictError("Creator already has an active or pending relationship");
        }

        if (input.settlementWalletId) {
          const walletRows = await tx<{ id: string }[]>`
            select id from wallets where id = ${input.settlementWalletId} and user_id = ${party.actor_id} limit 1
          `;
          if (!walletRows[0]) return [];
          await tx`
            update organization_settlement_wallets set is_primary = false, updated_at = now()
            where organization_id = ${input.organizationId} and chain = (select chain from wallets where id = ${input.settlementWalletId})
          `;
          await tx`
            insert into organization_settlement_wallets (
              organization_id, linked_by_user_id, chain, address, state, ownership_verified_at, is_primary
            )
            select ${input.organizationId}, ${party.actor_id}, w.chain, w.address, 'active', now(), true
            from wallets w where w.id = ${input.settlementWalletId} and w.user_id = ${party.actor_id}
            on conflict (organization_id, chain, address)
            do update set state = 'active', ownership_verified_at = now(), is_primary = true, updated_at = now()
          `;
        }

        const relationshipRows = await tx<{ id: string }[]>`
          insert into managed_creator_relationships (
            organization_id, creator_user_id, invited_by_user_id, idempotency_key, state
          ) values (${input.organizationId}, ${party.creator_id}, ${party.actor_id}, ${input.idempotencyKey}, 'invited')
          on conflict (organization_id, creator_user_id)
          do update set state = 'invited', invited_by_user_id = excluded.invited_by_user_id,
            idempotency_key = excluded.idempotency_key,
            invited_at = now(), accepted_at = null, ended_at = null, updated_at = now()
          returning id
        `;
        const relationshipId = relationshipRows[0]?.id;
        if (!relationshipId) return [];

        await tx`update managed_creator_agreements set state = 'rejected', updated_at = now() where relationship_id = ${relationshipId} and state = 'proposed'`;
        await tx`
          insert into managed_creator_agreements (
            relationship_id, version_number, state, permissions, commercial_agreement_version,
            terms_hash, creator_share_bps, enterprise_management_share_bps, proposed_by_user_id,
            idempotency_key
          )
          select ${relationshipId}, coalesce(max(version_number), 0) + 1, 'proposed',
            ${input.permissions}, 'managed-creator-2026-08-v1', ${input.termsHash},
            ${10_000 - input.enterpriseManagementShareBps}, ${input.enterpriseManagementShareBps}, ${party.actor_id},
            ${input.idempotencyKey}
          from managed_creator_agreements where relationship_id = ${relationshipId}
        `;
        await tx`
          insert into notifications (id, user_id, kind, title, body, action_url, related_resource_type, related_resource_id, idempotency_key)
          values (${randomUUID()}, ${party.creator_id}, 'studio_setup', 'Enterprise management invitation',
            'Review permissions and the management share before accepting.', '/app/enterprise',
            'managed_creator_relationship', ${relationshipId}, ${`managed-creator:${relationshipId}`})
          on conflict (user_id, idempotency_key) do update set state = 'unread', created_at = now()
        `;
        await recordEnterpriseAudit(tx, {
          actorUserId: party.actor_id,
          relationshipId,
          action: "managed_creator.invited",
          idempotencyKey: input.idempotencyKey,
          metadata: {
            organizationId: input.organizationId,
            creatorUserId: party.creator_id,
            permissions: input.permissions,
            creatorShareBps: 10_000 - input.enterpriseManagementShareBps,
            enterpriseManagementShareBps: input.enterpriseManagementShareBps,
            termsHash: input.termsHash
          }
        });
        await recordActionReceipt(tx, {
          actorUserId: party.actor_id,
          organizationId: input.organizationId,
          relationshipId,
          action: "managed_creator_invite",
          idempotencyKey: input.idempotencyKey,
          requestHash: input.requestHash
        });
        return selectById(tx, relationshipId, input.supabaseUserId);
      });
      return map(rows)[0] ?? null;
    },
    async respond(input) {
      const rows = await sql.begin(async (tx): Promise<Row[]> => {
        const locked = await tx<{ id: string; creator_user_id: string; state: string }[]>`
          select r.id, r.creator_user_id, r.state
          from managed_creator_relationships r
          join users creator on creator.id = r.creator_user_id
          where r.id = ${input.relationshipId} and creator.supabase_user_id = ${input.supabaseUserId}
            and r.state in ('invited', 'active', 'declined')
          for update of r limit 1
        `;
        const relationship = locked[0];
        if (!relationship) return [];
        const replayRelationshipId = await findActionReceipt(
          tx,
          relationship.creator_user_id,
          "managed_creator_response",
          input.idempotencyKey,
          input.requestHash
        );
        if (replayRelationshipId) return selectById(tx, replayRelationshipId, input.supabaseUserId);
        const finalState = input.decision === "accept" ? "active" : "declined";
        if (relationship.state === finalState) {
          await recordActionReceipt(tx, {
            actorUserId: relationship.creator_user_id,
            relationshipId: relationship.id,
            action: "managed_creator_response",
            idempotencyKey: input.idempotencyKey,
            requestHash: input.requestHash
          });
          return selectById(tx, relationship.id, input.supabaseUserId);
        }
        if (relationship.state !== "invited") return [];

        if (input.decision === "accept") {
          await tx`
            select pg_advisory_xact_lock(
              hashtextextended(${'managed-creator-active:' + relationship.creator_user_id}, 0)
            )
          `;
          const conflicting = await tx<{ id: string }[]>`
            select id from managed_creator_relationships
            where creator_user_id = ${relationship.creator_user_id}
              and state = 'active' and id <> ${relationship.id}
            limit 1
          `;
          if (conflicting[0]) return [];
          await tx`update managed_creator_agreements set state = 'superseded', updated_at = now() where relationship_id = ${relationship.id} and state = 'accepted'`;
          await tx`
            update managed_creator_agreements
            set state = 'accepted', accepted_by_user_id = ${relationship.creator_user_id},
              accepted_at = now(), effective_at = now(), updated_at = now()
            where id = (select id from managed_creator_agreements where relationship_id = ${relationship.id} and state = 'proposed' order by version_number desc limit 1)
          `;
        } else {
          await tx`update managed_creator_agreements set state = 'rejected', updated_at = now() where relationship_id = ${relationship.id} and state = 'proposed'`;
        }
        await tx`
          update managed_creator_relationships
          set state = ${finalState}, accepted_at = case when ${finalState} = 'active' then now() else accepted_at end,
            ended_at = case when ${finalState} = 'declined' then now() else null end, updated_at = now()
          where id = ${relationship.id}
        `;
        await recordEnterpriseAudit(tx, {
          actorUserId: relationship.creator_user_id,
          relationshipId: relationship.id,
          action: "managed_creator.responded",
          idempotencyKey: input.idempotencyKey,
          metadata: { decision: input.decision, relationshipState: finalState }
        });
        await recordActionReceipt(tx, {
          actorUserId: relationship.creator_user_id,
          relationshipId: relationship.id,
          action: "managed_creator_response",
          idempotencyKey: input.idempotencyKey,
          requestHash: input.requestHash
        });
        return selectById(tx, relationship.id, input.supabaseUserId);
      });
      return map(rows)[0] ?? null;
    },
    async proposeAgreement(input) {
      const rows = await sql.begin(async (tx): Promise<Row[]> => {
        const locked = await tx<{ id: string; actor_id: string; creator_user_id: string }[]>`
          select r.id, actor.id as actor_id, r.creator_user_id
          from managed_creator_relationships r
          join users actor on actor.supabase_user_id = ${input.supabaseUserId}
          join organization_memberships member on member.organization_id = r.organization_id and member.user_id = actor.id
          where r.id = ${input.relationshipId} and r.state = 'active'
            and member.state = 'active' and member.role in ('owner', 'admin')
          for update of r limit 1
        `;
        const relationship = locked[0];
        if (!relationship) return [];
        const replayRelationshipId = await findActionReceipt(
          tx,
          relationship.actor_id,
          "managed_creator_agreement_propose",
          input.idempotencyKey,
          input.requestHash
        );
        if (replayRelationshipId) return selectById(tx, replayRelationshipId, input.supabaseUserId);
        const existing = await tx<{ id: string; terms_hash: string }[]>`
          select id, terms_hash from managed_creator_agreements
          where relationship_id = ${relationship.id} and idempotency_key = ${input.idempotencyKey}
          limit 1
        `;
        if (existing[0]) {
          if (existing[0].terms_hash !== input.termsHash) throw new ManagedCreatorIdempotencyConflictError();
          await recordActionReceipt(tx, {
            actorUserId: relationship.actor_id,
            relationshipId: relationship.id,
            action: "managed_creator_agreement_propose",
            idempotencyKey: input.idempotencyKey,
            requestHash: input.requestHash
          });
          return selectById(tx, relationship.id, input.supabaseUserId);
        }

        await tx`
          update managed_creator_agreements set state = 'rejected', updated_at = now()
          where relationship_id = ${relationship.id} and state = 'proposed'
        `;
        await tx`
          insert into managed_creator_agreements (
            relationship_id, version_number, state, permissions, commercial_agreement_version,
            terms_hash, creator_share_bps, enterprise_management_share_bps, proposed_by_user_id,
            idempotency_key
          )
          select ${relationship.id}, coalesce(max(version_number), 0) + 1, 'proposed',
            ${input.permissions}, 'managed-creator-2026-08-v1', ${input.termsHash},
            ${10_000 - input.enterpriseManagementShareBps}, ${input.enterpriseManagementShareBps},
            ${relationship.actor_id}, ${input.idempotencyKey}
          from managed_creator_agreements where relationship_id = ${relationship.id}
        `;
        await tx`
          insert into notifications (id, user_id, kind, title, body, action_url, related_resource_type, related_resource_id, idempotency_key)
          values (${randomUUID()}, ${relationship.creator_user_id}, 'studio_setup', 'Management terms changed',
            'Review the changed permissions and management share. Current accepted terms remain active until you accept.',
            '/app/enterprise', 'managed_creator_relationship', ${relationship.id}, ${`managed-agreement:${relationship.id}:${input.idempotencyKey}`})
          on conflict (user_id, idempotency_key) do nothing
        `;
        await recordEnterpriseAudit(tx, {
          actorUserId: relationship.actor_id,
          relationshipId: relationship.id,
          action: "managed_creator.agreement_proposed",
          idempotencyKey: input.idempotencyKey,
          metadata: {
            permissions: input.permissions,
            creatorShareBps: 10_000 - input.enterpriseManagementShareBps,
            enterpriseManagementShareBps: input.enterpriseManagementShareBps,
            termsHash: input.termsHash
          }
        });
        await recordActionReceipt(tx, {
          actorUserId: relationship.actor_id,
          relationshipId: relationship.id,
          action: "managed_creator_agreement_propose",
          idempotencyKey: input.idempotencyKey,
          requestHash: input.requestHash
        });
        return selectById(tx, relationship.id, input.supabaseUserId);
      });
      return map(rows)[0] ?? null;
    },
    async respondToAgreement(input) {
      const rows = await sql.begin(async (tx): Promise<Row[]> => {
        const locked = await tx<{ id: string; state: string; creator_user_id: string }[]>`
          select agreement.id, agreement.state, r.creator_user_id
          from managed_creator_agreements agreement
          join managed_creator_relationships r on r.id = agreement.relationship_id
          join users creator on creator.id = r.creator_user_id
          where r.id = ${input.relationshipId} and agreement.id = ${input.agreementId}
            and r.state = 'active' and creator.supabase_user_id = ${input.supabaseUserId}
          for update of agreement, r limit 1
        `;
        const agreement = locked[0];
        if (!agreement) return [];
        const replayRelationshipId = await findActionReceipt(
          tx,
          agreement.creator_user_id,
          "managed_creator_agreement_response",
          input.idempotencyKey,
          input.requestHash
        );
        if (replayRelationshipId) return selectById(tx, replayRelationshipId, input.supabaseUserId);
        const finalState = input.decision === "accept" ? "accepted" : "rejected";
        if (agreement.state === finalState) {
          await recordActionReceipt(tx, {
            actorUserId: agreement.creator_user_id,
            relationshipId: input.relationshipId,
            action: "managed_creator_agreement_response",
            idempotencyKey: input.idempotencyKey,
            requestHash: input.requestHash
          });
          return selectById(tx, input.relationshipId, input.supabaseUserId);
        }
        if (agreement.state !== "proposed") return [];

        if (input.decision === "accept") {
          await tx`
            update managed_creator_agreements
            set state = 'superseded', ends_at = now(), updated_at = now()
            where relationship_id = ${input.relationshipId} and state = 'accepted'
          `;
          await tx`
            update managed_creator_agreements
            set state = 'accepted', accepted_by_user_id = ${agreement.creator_user_id},
              accepted_at = now(), effective_at = now(), updated_at = now()
            where id = ${agreement.id}
          `;
        } else {
          await tx`update managed_creator_agreements set state = 'rejected', updated_at = now() where id = ${agreement.id}`;
        }
        await recordEnterpriseAudit(tx, {
          actorUserId: agreement.creator_user_id,
          relationshipId: input.relationshipId,
          action: "managed_creator.agreement_responded",
          idempotencyKey: input.idempotencyKey,
          metadata: { agreementId: agreement.id, decision: input.decision, agreementState: finalState }
        });
        await recordActionReceipt(tx, {
          actorUserId: agreement.creator_user_id,
          relationshipId: input.relationshipId,
          action: "managed_creator_agreement_response",
          idempotencyKey: input.idempotencyKey,
          requestHash: input.requestHash
        });
        return selectById(tx, input.relationshipId, input.supabaseUserId);
      });
      return map(rows)[0] ?? null;
    },
    async terminate(input) {
      const rows = await sql.begin(async (tx): Promise<Row[]> => {
        const locked = await tx<{ id: string; state: string; actor_id: string; creator_user_id: string; invited_by_user_id: string }[]>`
          select r.id, r.state, actor.id as actor_id, r.creator_user_id, r.invited_by_user_id
          from managed_creator_relationships r
          join users actor on actor.supabase_user_id = ${input.supabaseUserId}
          where r.id = ${input.relationshipId}
            and (
              r.creator_user_id = actor.id
              or exists (
                select 1 from organization_memberships member
                where member.organization_id = r.organization_id and member.user_id = actor.id
                  and member.state = 'active' and member.role in ('owner', 'admin')
              )
            )
          for update of r limit 1
        `;
        const relationship = locked[0];
        if (!relationship) return [];
        const replayRelationshipId = await findActionReceipt(
          tx,
          relationship.actor_id,
          "managed_creator_termination",
          input.idempotencyKey,
          input.requestHash
        );
        if (replayRelationshipId) return selectById(tx, replayRelationshipId, input.supabaseUserId);
        if (relationship.state === "terminated") {
          await recordActionReceipt(tx, {
            actorUserId: relationship.actor_id,
            relationshipId: relationship.id,
            action: "managed_creator_termination",
            idempotencyKey: input.idempotencyKey,
            requestHash: input.requestHash
          });
          return selectById(tx, relationship.id, input.supabaseUserId);
        }
        if (relationship.state !== "active") return [];
        await tx`
          update managed_creator_agreements
          set state = case when state = 'accepted' then 'terminated' else 'rejected' end,
            ends_at = case when state = 'accepted' then now() else ends_at end, updated_at = now()
          where relationship_id = ${relationship.id} and state in ('accepted', 'proposed')
        `;
        await tx`
          update managed_creator_relationships
          set state = 'terminated', ended_at = now(), end_reason = ${input.reason}, updated_at = now()
          where id = ${relationship.id}
        `;
        const notificationUserId = relationship.actor_id === relationship.creator_user_id
          ? relationship.invited_by_user_id
          : relationship.creator_user_id;
        await tx`
          insert into notifications (id, user_id, kind, title, body, action_url, related_resource_type, related_resource_id, idempotency_key)
          values (${randomUUID()}, ${notificationUserId}, 'studio_setup', 'Management relationship ended',
            'The Enterprise management relationship has ended. Historical payment records are unchanged.',
            '/app/enterprise', 'managed_creator_relationship', ${relationship.id}, ${`managed-termination:${relationship.id}`})
          on conflict (user_id, idempotency_key) do nothing
        `;
        await recordEnterpriseAudit(tx, {
          actorUserId: relationship.actor_id,
          relationshipId: relationship.id,
          action: "managed_creator.terminated",
          idempotencyKey: input.idempotencyKey,
          metadata: { relationshipState: "terminated" }
        });
        await recordActionReceipt(tx, {
          actorUserId: relationship.actor_id,
          relationshipId: relationship.id,
          action: "managed_creator_termination",
          idempotencyKey: input.idempotencyKey,
          requestHash: input.requestHash
        });
        return selectById(tx, relationship.id, input.supabaseUserId);
      });
      return map(rows)[0] ?? null;
    },
    async close() { if (ownsClient) await sql.end({ timeout: 5 }); }
  };
}

function selectSql() { return `
  select r.id, r.organization_id, o.name as organization_name, r.creator_user_id,
    profile.handle as creator_handle, r.state, agreement.id as agreement_id,
    agreement.version_number, agreement.state as agreement_state, agreement.permissions,
    agreement.creator_share_bps, agreement.enterprise_management_share_bps,
    (o.state = 'active' and exists (
      select 1 from verification_records verification
      where verification.subject_type = 'organization'
        and verification.subject_id = o.id
        and verification.purpose = 'org_kyb'
        and verification.status = 'valid'
        and (verification.expires_at is null or verification.expires_at > now())
    )) as organization_kyb_ready,
    exists (select 1 from tier_waivers tw where tw.subject_type = 'organization' and tw.subject_id = o.id and tw.tier_key = 'enterprise' and tw.state = 'active' and tw.starts_at <= now() and (tw.ends_at is null or tw.ends_at > now())) as enterprise_entitlement_ready,
    exists (select 1 from organization_settlement_wallets sw where sw.organization_id = o.id and sw.state = 'active' and sw.is_primary) as settlement_wallet_ready
    , case when r.creator_user_id = actor.id then 'creator' else 'organization_member' end as viewer_role
    , (select membership.role from organization_memberships membership
       where membership.organization_id = r.organization_id and membership.user_id = actor.id and membership.state = 'active'
       limit 1) as organization_role
  from managed_creator_relationships r
  join organizations o on o.id = r.organization_id
  join users creator on creator.id = r.creator_user_id
  join profiles profile on profile.user_id = creator.id
  join lateral (
    select * from managed_creator_agreements a where a.relationship_id = r.id
    order by case a.state when 'proposed' then 0 when 'accepted' then 1 else 2 end, a.version_number desc
    limit 1
  ) agreement on true
  join users actor on actor.supabase_user_id = $1
`; }

type EnterpriseAction =
  | "managed_creator_invite"
  | "managed_creator_response"
  | "managed_creator_agreement_propose"
  | "managed_creator_agreement_response"
  | "managed_creator_termination";

async function findActionReceipt(
  tx: PostgresTransaction,
  actorUserId: string,
  action: EnterpriseAction,
  idempotencyKey: string,
  requestHash: string
): Promise<string | null> {
  await tx`select pg_advisory_xact_lock(hashtextextended(${`enterprise-action:${actorUserId}:${action}:${idempotencyKey}`}, 0))`;
  const rows = await tx<Array<{ request_hash: string; relationship_id: string | null }>>`
    select request_hash, relationship_id
    from enterprise_action_receipts
    where actor_user_id = ${actorUserId}
      and action = ${action}
      and idempotency_key = ${idempotencyKey}
    limit 1
  `;
  const receipt = rows[0];
  if (!receipt) return null;
  if (receipt.request_hash !== requestHash) throw new ManagedCreatorIdempotencyConflictError();
  return receipt.relationship_id;
}

async function recordActionReceipt(tx: PostgresTransaction, input: {
  actorUserId: string;
  organizationId?: string;
  relationshipId: string;
  action: EnterpriseAction;
  idempotencyKey: string;
  requestHash: string;
}): Promise<void> {
  await tx`
    insert into enterprise_action_receipts (
      actor_user_id, organization_id, relationship_id, action, idempotency_key, request_hash
    ) values (
      ${input.actorUserId}, ${input.organizationId ?? null}, ${input.relationshipId},
      ${input.action}, ${input.idempotencyKey}, ${input.requestHash}
    )
    on conflict (actor_user_id, action, idempotency_key) do nothing
  `;
}

async function recordEnterpriseAudit(tx: PostgresTransaction, input: {
  actorUserId: string;
  relationshipId: string;
  action: string;
  idempotencyKey: string;
  metadata: Record<string, unknown>;
}): Promise<void> {
  await tx`
    insert into audit_events (
      id, actor_user_id, subject_type, subject_id, action, metadata, idempotency_key
    ) values (
      ${randomUUID()}, ${input.actorUserId}, 'managed_creator_relationship', ${input.relationshipId},
      ${input.action}, ${JSON.stringify(input.metadata)}::jsonb, ${input.idempotencyKey}
    )
    on conflict (actor_user_id, action, idempotency_key)
      where actor_user_id is not null and idempotency_key is not null
      do nothing
  `;
}

function selectById(tx: PostgresTransaction, id: string, supabaseUserId: string) {
  return tx.unsafe<Row[]>(`${selectSql()} where r.id = $2 limit 1`, [supabaseUserId, id]);
}

function map(rows: Row[]): ManagedCreatorRelationshipResource[] {
  return rows.map((r) => ({ id: r.id, organizationId: r.organization_id, organizationName: r.organization_name,
    creatorUserId: r.creator_user_id, creatorHandle: r.creator_handle, state: r.state,
    agreementId: r.agreement_id, agreementVersion: Number(r.version_number), agreementState: r.agreement_state,
    permissions: r.permissions, creatorShareBps: Number(r.creator_share_bps),
    enterpriseManagementShareBps: Number(r.enterprise_management_share_bps),
    organizationKybReady: r.organization_kyb_ready, enterpriseEntitlementReady: r.enterprise_entitlement_ready,
    settlementWalletReady: r.settlement_wallet_ready,
    viewerRole: r.viewer_role,
    organizationRole: r.organization_role,
    availableActions: availableActions(r)
  }));
}

function availableActions(row: Row): ManagedCreatorRelationshipResource["availableActions"] {
  const actions: ManagedCreatorRelationshipResource["availableActions"] = [];
  if (row.viewer_role === "creator" && row.state === "invited") {
    actions.push("accept_relationship", "decline_relationship");
  }
  if (row.viewer_role === "creator" && row.state === "active" && row.agreement_state === "proposed") {
    actions.push("accept_agreement", "reject_agreement");
  }
  if (row.viewer_role === "organization_member" && row.state === "active" &&
    (row.organization_role === "owner" || row.organization_role === "admin")) {
    actions.push("propose_agreement");
  }
  if (row.state === "active" && (row.viewer_role === "creator" || row.organization_role === "owner" || row.organization_role === "admin")) {
    actions.push("terminate_relationship");
  }
  return actions;
}

function safeInteger(value: string | null): number {
  const parsed = Number(value ?? 0);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new ManagedCreatorStateConflictError("Enterprise reporting amount exceeds the supported range");
  }
  return parsed;
}
