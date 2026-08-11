import { createHash, randomUUID } from "node:crypto";
import type postgres from "postgres";

export const mediaSafetyPolicyVersion = "media-safety-v1";

type RepresentationMode =
  | "not_declared"
  | "no_real_person"
  | "self_only"
  | "declared_performers";

export async function recordContentSafetyDeclaration(
  transaction: postgres.TransactionSql,
  input: {
    contentId: string;
    creatorUserId: string;
    rating: "none" | "adult" | "explicit";
    representationMode: RepresentationMode;
    policyAccepted: boolean;
  }
): Promise<void> {
  const previousRows = await transaction<
    { declared_rating: string; representation_mode: string | null }[]
  >`
    select msc.declared_rating, csd.representation_mode
    from media_safety_cases msc
    left join content_safety_declarations csd on csd.content_item_id = msc.content_item_id
    where msc.content_item_id = ${input.contentId}
      and msc.state <> 'superseded'
    limit 1
  `;
  const previous = previousRows[0];
  const declarationChanged =
    previous?.declared_rating !== input.rating ||
    previous?.representation_mode !== input.representationMode;

  await transaction`
    insert into content_safety_declarations (
      content_item_id,
      uploader_user_id,
      representation_mode,
      policy_version,
      state,
      accepted_at
    )
    values (
      ${input.contentId},
      ${input.creatorUserId},
      ${input.representationMode},
      ${mediaSafetyPolicyVersion},
      'active',
      ${input.policyAccepted ? new Date() : null}
    )
    on conflict (content_item_id) do update
    set
      representation_mode = excluded.representation_mode,
      policy_version = excluded.policy_version,
      state = 'active',
      accepted_at = excluded.accepted_at,
      updated_at = now()
  `;

  if (!previous) {
    await transaction`
      insert into media_safety_cases (
        id,
        content_item_id,
        declared_rating,
        state,
        reason_code,
        policy_version
      )
      values (
        ${randomUUID()},
        ${input.contentId},
        ${input.rating},
        'quarantined',
        'awaiting_media_and_review',
        ${mediaSafetyPolicyVersion}
      )
    `;
  } else if (declarationChanged) {
    await transaction`
      update media_safety_cases
      set
        declared_rating = ${input.rating},
        state = 'quarantined',
        decision_source = null,
        reason_code = 'creator_declaration_changed',
        provider_release_allowed = false,
        reviewed_by_user_id = null,
        decided_at = null,
        updated_at = now()
      where content_item_id = ${input.contentId}
        and state <> 'superseded'
    `;
  }

  if (input.representationMode !== "self_only") {
    await transaction`
      update performer_consents
      set state = 'revoked', updated_at = now()
      where content_item_id = ${input.contentId}
        and state = 'active'
    `;
    return;
  }

  const performerRows = await transaction<{ id: string }[]>`
    with latest_verification as (
      select
        provider,
        provider_reference,
        method,
        assurance_level,
        result_over_threshold,
        verified_at,
        expires_at
      from verification_records
      where subject_type = 'user'
        and subject_id = ${input.creatorUserId}
        and purpose = 'adult_publisher_eligibility'
        and status = 'valid'
        and result_over_threshold is true
        and assurance_level in ('high', 'documentary')
        and (expires_at is null or expires_at > now())
      order by verified_at desc nulls last, created_at desc
      limit 1
    )
    insert into performer_subjects (
      owner_user_id,
      linked_user_id,
      verification_status,
      verification_provider,
      verification_reference,
      verification_method,
      assurance_level,
      result_over_18,
      verified_at,
      expires_at
    )
    select
      ${input.creatorUserId},
      ${input.creatorUserId},
      'valid',
      lv.provider,
      lv.provider_reference,
      lv.method,
      lv.assurance_level,
      lv.result_over_threshold,
      lv.verified_at,
      lv.expires_at
    from latest_verification lv
    on conflict (owner_user_id, linked_user_id) where linked_user_id is not null do update
    set
      verification_status = excluded.verification_status,
      verification_provider = excluded.verification_provider,
      verification_reference = excluded.verification_reference,
      verification_method = excluded.verification_method,
      assurance_level = excluded.assurance_level,
      result_over_18 = excluded.result_over_18,
      verified_at = excluded.verified_at,
      expires_at = excluded.expires_at,
      updated_at = now()
    returning id
  `;
  const performer = performerRows[0];
  if (!performer) return;

  const evidenceHash = createHash("sha256")
    .update(
      [
        input.contentId,
        input.creatorUserId,
        input.representationMode,
        mediaSafetyPolicyVersion
      ].join(":"),
      "utf8"
    )
    .digest("hex");

  await transaction`
    insert into performer_consents (
      content_item_id,
      performer_subject_id,
      recorded_by_user_id,
      allowed_uses,
      policy_version,
      release_version,
      state,
      evidence_hash,
      accepted_at
    )
    values (
      ${input.contentId},
      ${performer.id},
      ${input.creatorUserId},
      ${transaction.array(["capture", "upload", "distribution", "monetisation"])},
      ${mediaSafetyPolicyVersion},
      ${mediaSafetyPolicyVersion},
      'active',
      ${evidenceHash},
      now()
    )
    on conflict (content_item_id, performer_subject_id, release_version) do update
    set
      state = 'active',
      allowed_uses = excluded.allowed_uses,
      policy_version = excluded.policy_version,
      evidence_hash = excluded.evidence_hash,
      accepted_at = excluded.accepted_at,
      updated_at = now()
  `;
}
