import { randomUUID } from "node:crypto";
import { resolvePostgresClient, type PostgresSql, type PostgresTransaction } from "../../shared/postgres.js";
import type {
  PerformerAllowedUse,
  PerformerConsentRequestResource,
  PerformerRepository
} from "./types.js";

const policyVersion = "performer-consent-2026-08-v1";
const releaseVersion = "performer-release-2026-08-v1";

interface PerformerRequestRow {
  id: string;
  content_item_id: string;
  content_revision: number;
  caption: string | null;
  media_type: string;
  nsfw_label: "adult" | "explicit";
  display_label: string | null;
  handle: string | null;
  linked_user_id: string | null;
  state: PerformerConsentRequestResource["state"];
  verification_status: string;
  allowed_uses: PerformerAllowedUse[];
  invitation_expires_at: Date | null;
}

export class PerformerRepositoryConfigurationError extends Error {
  constructor() {
    super("PERFORMER_REPOSITORY_NOT_CONFIGURED");
    this.name = "PerformerRepositoryConfigurationError";
  }
}

export function createPostgresPerformerRepository(database?: string | PostgresSql): PerformerRepository {
  if (!database) {
    const unavailable = async () => { throw new PerformerRepositoryConfigurationError(); };
    return {
      listForContent: unavailable,
      createRequest: unavailable,
      findInvitation: unavailable,
      createVerificationSession: unavailable,
      respondAsLinkedUser: unavailable,
      respondToInvitation: unavailable
    };
  }

  const { sql, ownsClient } = resolvePostgresClient(database);

  return {
    async listForContent(input) {
      return mapRows(await sql.unsafe<PerformerRequestRow[]>(`${requestSelect()}
        where pcr.content_item_id = $1
          and owner.supabase_user_id = $2
        order by pcr.created_at asc`, [input.contentId, input.supabaseUserId]));
    },

    async createRequest(input) {
      const result = await sql.begin(async (transaction): Promise<{
        rows: PerformerRequestRow[];
        invitationCreated: boolean;
      }> => {
        const scopeRows = await transaction<{
          owner_user_id: string;
          content_revision: number;
        }[]>`
          select ci.creator_user_id as owner_user_id, csd.content_revision
          from content_items ci
          join users owner on owner.id = ci.creator_user_id
          join content_safety_declarations csd on csd.content_item_id = ci.id
          where ci.id = ${input.contentId}
            and owner.supabase_user_id = ${input.supabaseUserId}
            and ci.nsfw_label in ('adult', 'explicit')
            and csd.representation_mode = 'declared_performers'
            and csd.state = 'active'
          limit 1
        `;
        const scope = scopeRows[0];
        if (!scope) return { rows: [], invitationCreated: false };

        await transaction`select pg_advisory_xact_lock(hashtextextended(${`${scope.owner_user_id}:${input.idempotencyKey}`}, 0))`;
        const existingRows = await transaction<{ id: string }[]>`
          select id from performer_consent_requests
          where requested_by_user_id = ${scope.owner_user_id}
            and idempotency_key = ${input.idempotencyKey}
          limit 1
        `;
        if (existingRows[0]) {
          return {
            rows: await selectRequestById(transaction, existingRows[0].id),
            invitationCreated: false
          };
        }

        const linkedRows = input.performerHandle
          ? await transaction<{ id: string; handle: string }[]>`
              select u.id, p.handle
              from profiles p
              join users u on u.id = p.user_id
              where lower(p.handle) = lower(${input.performerHandle})
                and u.state = 'active'
              limit 1
            `
          : [];
        const linked = linkedRows[0] ?? null;
        if (input.performerHandle && !linked) return { rows: [], invitationCreated: false };

        const subjectRows = linked
          ? await transaction<{ id: string }[]>`
              insert into performer_subjects (
                owner_user_id, linked_user_id, subject_kind, display_label
              ) values (
                ${scope.owner_user_id}, ${linked.id}, 'wevid_user', ${`@${linked.handle}`}
              )
              on conflict (owner_user_id, linked_user_id) where linked_user_id is not null
              do update set display_label = excluded.display_label, updated_at = now()
              returning id
            `
          : await transaction<{ id: string }[]>`
              insert into performer_subjects (
                owner_user_id, subject_kind, display_label
              ) values (
                ${scope.owner_user_id}, 'external_invitee', ${input.externalLabel ?? "External performer"}
              )
              returning id
            `;
        const subjectId = subjectRows[0]?.id;
        if (!subjectId) return { rows: [], invitationCreated: false };

        if (linked) {
          await deriveReusablePerformerEvidence(transaction, linked.id, subjectId);
        }

        const requestRows = await transaction<{ id: string }[]>`
          insert into performer_consent_requests (
            content_item_id, performer_subject_id, requested_by_user_id, idempotency_key, state,
            allowed_uses, policy_version, release_version, content_revision,
            invitation_token_hash, invitation_expires_at
          )
          select
            ${input.contentId}, ps.id, ${scope.owner_user_id}, ${input.idempotencyKey},
            case when ps.verification_status = 'valid' then 'pending' else 'verification_required' end,
            ${input.allowedUses}, ${policyVersion}, ${releaseVersion}, ${scope.content_revision},
            ${input.invitationTokenHash ?? null}, ${input.invitationExpiresAt ?? null}
          from performer_subjects ps
          where ps.id = ${subjectId}
          on conflict (content_item_id, performer_subject_id, content_revision)
          do update set
            allowed_uses = excluded.allowed_uses,
            state = case
              when performer_consent_requests.state in ('accepted', 'rejected') then performer_consent_requests.state
              else excluded.state
            end,
            updated_at = now()
          returning id
        `;
        const requestId = requestRows[0]?.id;
        if (!requestId) return { rows: [], invitationCreated: false };

        if (linked) {
          await transaction`
            insert into notifications (
              id, user_id, kind, title, body, action_url,
              related_resource_type, related_resource_id, idempotency_key
            ) values (
              ${randomUUID()}, ${linked.id}, 'safety', 'Performer consent requested',
              'Review the exact content scope and allowed uses before accepting.',
              ${`/app/profile?performerRequest=${requestId}`}, 'performer_consent_request',
              ${requestId}, ${`performer-consent:${requestId}`}
            )
            on conflict (user_id, idempotency_key) do nothing
          `;
        }

        return {
          rows: await selectRequestById(transaction, requestId),
          invitationCreated: Boolean(input.invitationTokenHash)
        };
      });
      const request = mapRows(result.rows)[0];
      return request ? { request, invitationCreated: result.invitationCreated } : null;
    },

    async findInvitation(input) {
      const rows = await sql.unsafe<PerformerRequestRow[]>(`${requestSelect()}
        where pcr.invitation_token_hash = $1
          and pcr.invitation_expires_at > now()
          and pcr.state in ('pending', 'verification_required')
        limit 1`, [input.invitationTokenHash]);
      return mapRows(rows)[0] ?? null;
    },

    async createVerificationSession(input) {
      const rows = await sql<{ id: string }[]>`
        insert into verification_sessions (
          subject_type, subject_id, purpose, provider, provider_session_id,
          provider_applicant_id, provider_inquiry_id, provider_transaction_id,
          requested_method, status, threshold_age, assurance_level, reusable, expires_at
        )
        select
          'performer', pcr.performer_subject_id, 'performer_eligibility',
          ${input.providerSession.provider}, ${input.providerSession.providerSessionId ?? null},
          ${input.providerSession.providerApplicantId ?? null}, ${input.providerSession.providerInquiryId ?? null},
          ${input.providerSession.providerTransactionId ?? null}, ${input.providerSession.method},
          'pending', 18, ${input.providerSession.assuranceLevel},
          ${input.providerSession.reusable ?? false}, ${input.providerSession.expiresAt}
        from performer_consent_requests pcr
        where pcr.invitation_token_hash = ${input.invitationTokenHash}
          and pcr.invitation_expires_at > now()
          and pcr.state in ('pending', 'verification_required')
        returning id
      `;
      return rows[0]?.id ?? null;
    },

    async respondAsLinkedUser(input) {
      const rows = await sql.begin((transaction) => respond(transaction, {
        requestId: input.requestId,
        supabaseUserId: input.supabaseUserId,
        invitationTokenHash: null,
        decision: input.decision
      }));
      return mapRows(rows)[0] ?? null;
    },

    async respondToInvitation(input) {
      const rows = await sql.begin((transaction) => respond(transaction, {
        requestId: null,
        supabaseUserId: null,
        invitationTokenHash: input.invitationTokenHash,
        decision: input.decision
      }));
      return mapRows(rows)[0] ?? null;
    },

    async close() {
      if (ownsClient) await sql.end({ timeout: 5 });
    }
  };
}

async function deriveReusablePerformerEvidence(
  transaction: PostgresTransaction,
  linkedUserId: string,
  performerSubjectId: string
): Promise<void> {
  await transaction`
    insert into verification_records (
      subject_type, subject_id, purpose, status, provider, provider_reference,
      method, jurisdiction, threshold_age, result_over_threshold, assurance_level,
      verified_at, expires_at, reusable, derived_from_record_id, metadata
    )
    select
      'performer', ${performerSubjectId}, 'performer_eligibility', 'valid',
      source.provider, source.provider_reference, source.method, source.jurisdiction,
      18, true, source.assurance_level, source.verified_at, source.expires_at,
      source.reusable, source.id, jsonb_build_object('evidence_reuse', true)
    from verification_records source
    where source.subject_type = 'user'
      and source.subject_id = ${linkedUserId}
      and source.status = 'valid'
      and source.assurance_level in ('high', 'documentary')
      and source.purpose in ('adult_publisher_eligibility', 'creator_kyc')
      and source.result_over_threshold is true
      and (source.expires_at is null or source.expires_at > now())
      and (
        source.purpose = 'adult_publisher_eligibility'
        or exists (
          select 1 from verification_records age
          where age.subject_type = 'user' and age.subject_id = ${linkedUserId}
            and age.purpose = 'age_access' and age.status = 'valid'
            and age.result_over_threshold is true
            and (age.expires_at is null or age.expires_at > now())
        )
      )
      and not exists (
        select 1 from verification_records existing
        where existing.subject_type = 'performer' and existing.subject_id = ${performerSubjectId}
          and existing.purpose = 'performer_eligibility' and existing.status = 'valid'
          and (existing.expires_at is null or existing.expires_at > now())
      )
    order by (source.purpose = 'adult_publisher_eligibility') desc, source.verified_at desc
    limit 1
  `;
}

async function respond(transaction: PostgresTransaction, input: {
  requestId: string | null;
  supabaseUserId: string | null;
  invitationTokenHash: string | null;
  decision: "accept" | "reject";
}): Promise<PerformerRequestRow[]> {
  const requestRows = await transaction<{
    id: string;
    performer_subject_id: string;
    verification_status: string;
    state: "pending" | "verification_required" | "accepted" | "rejected";
  }[]>`
    select pcr.id, pcr.performer_subject_id, ps.verification_status, pcr.state
    from performer_consent_requests pcr
    join performer_subjects ps on ps.id = pcr.performer_subject_id
    left join users linked on linked.id = ps.linked_user_id
    join content_safety_declarations csd on csd.content_item_id = pcr.content_item_id
    where (${input.requestId}::uuid is null or pcr.id = ${input.requestId})
      and (${input.invitationTokenHash}::text is null or pcr.invitation_token_hash = ${input.invitationTokenHash})
      and (${input.supabaseUserId}::uuid is null or linked.supabase_user_id = ${input.supabaseUserId})
      and (pcr.invitation_expires_at is null or pcr.invitation_expires_at > now())
      and pcr.content_revision = csd.content_revision
      and pcr.state in ('pending', 'verification_required', 'accepted', 'rejected')
    for update of pcr
    limit 1
  `;
  const request = requestRows[0];
  if (!request) return [];
  if (
    (request.state === "accepted" && input.decision === "accept") ||
    (request.state === "rejected" && input.decision === "reject")
  ) {
    return selectRequestById(transaction, request.id);
  }
  if (request.state === "accepted" || request.state === "rejected") return [];
  if (input.decision === "accept" && request.verification_status !== "valid") return [];

  if (input.decision === "accept") {
    await transaction`
      insert into performer_consents (
        content_item_id, performer_subject_id, recorded_by_user_id, allowed_uses,
        policy_version, release_version, state, evidence_hash, evidence_reference,
        accepted_at, content_revision
      )
      select
        pcr.content_item_id, pcr.performer_subject_id, coalesce(ps.linked_user_id, pcr.requested_by_user_id),
        pcr.allowed_uses, pcr.policy_version, pcr.release_version, 'active',
        encode(extensions.digest(pcr.id::text || ':' || pcr.content_revision::text, 'sha256'), 'hex'),
        'performer_consent_request:' || pcr.id::text, now(), pcr.content_revision
      from performer_consent_requests pcr
      join performer_subjects ps on ps.id = pcr.performer_subject_id
      where pcr.id = ${request.id}
      on conflict (content_item_id, performer_subject_id, release_version)
      do update set
        allowed_uses = excluded.allowed_uses,
        state = 'active',
        evidence_hash = excluded.evidence_hash,
        accepted_at = excluded.accepted_at,
        content_revision = excluded.content_revision,
        updated_at = now()
    `;
  }

  await transaction`
    update performer_consent_requests
    set state = ${input.decision === "accept" ? "accepted" : "rejected"},
        responded_at = now(), updated_at = now()
    where id = ${request.id}
  `;
  return selectRequestById(transaction, request.id);
}

function requestSelect() {
  return `
    select pcr.id, pcr.content_item_id, pcr.content_revision, ci.caption, ci.media_type,
      ci.nsfw_label, ps.display_label, profile.handle, ps.linked_user_id, pcr.state,
      ps.verification_status, pcr.allowed_uses, pcr.invitation_expires_at
    from performer_consent_requests pcr
    join performer_subjects ps on ps.id = pcr.performer_subject_id
    join content_items ci on ci.id = pcr.content_item_id
    join users owner on owner.id = ci.creator_user_id
    left join profiles profile on profile.user_id = ps.linked_user_id
  `;
}

async function selectRequestById(transaction: PostgresTransaction, requestId: string): Promise<PerformerRequestRow[]> {
  return transaction.unsafe<PerformerRequestRow[]>(`${requestSelect()} where pcr.id = $1 limit 1`, [requestId]);
}

function mapRows(rows: PerformerRequestRow[]): PerformerConsentRequestResource[] {
  return rows.map((row) => ({
    id: row.id,
    contentId: row.content_item_id,
    contentRevision: Number(row.content_revision),
    contentCaption: row.caption,
    mediaType: row.media_type,
    rating: row.nsfw_label,
    performerLabel: row.handle ? `@${row.handle}` : row.display_label ?? "External performer",
    linkedUser: Boolean(row.linked_user_id),
    state: row.state,
    verificationState: row.verification_status,
    allowedUses: row.allowed_uses,
    expiresAt: row.invitation_expires_at?.toISOString() ?? null
  }));
}
