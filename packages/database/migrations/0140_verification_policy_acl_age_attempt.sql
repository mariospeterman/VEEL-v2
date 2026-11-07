-- Converge every active verification policy reader on the canonical current
-- decision, add the bounded content-eligibility entry point used by feeds,
-- and close browser-role privileges that can survive older Supabase defaults.

revoke all privileges on table
  verification_sessions,
  verification_records,
  verification_events,
  provider_events,
  provider_webhook_receipts,
  provider_event_replay_requests,
  idempotency_keys,
  audit_events
from public, anon, authenticated;

drop policy if exists verification_sessions_select_self_org_performer_or_staff
  on verification_sessions;
drop policy if exists verification_records_select_self_org_performer_or_staff
  on verification_records;
drop policy if exists verification_events_staff_select on verification_events;
drop policy if exists provider_events_select_staff on provider_events;
drop policy if exists provider_webhook_receipts_select_staff
  on provider_webhook_receipts;
drop policy if exists provider_event_replay_requests_staff_select
  on provider_event_replay_requests;
drop policy if exists idempotency_keys_select_staff on idempotency_keys;
drop policy if exists audit_events_select_actor_or_staff on audit_events;

comment on table verification_records is
  'Server-only normalized verification authority. Browser resources are permission-scoped Fastify projections, never raw provider or evidence rows.';
comment on table audit_events is
  'Server-only immutable operational audit authority. Browser resources are permission-scoped Fastify projections.';

-- A derived decision is usable only while every source in its provenance chain
-- remains the canonical current source for that source's own subject/purpose.
-- The visited-set/depth guard makes malformed cycles fail closed.
create or replace function private.verification_record_derivation_is_current(
  p_record_id uuid,
  p_visited uuid[]
)
returns boolean
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_record public.verification_records%rowtype;
  v_source public.verification_records%rowtype;
  v_current_source_id uuid;
begin
  if p_record_id is null
    or p_record_id = any(coalesce(p_visited, array[]::uuid[]))
    or cardinality(coalesce(p_visited, array[]::uuid[])) >= 32 then
    return false;
  end if;

  select record.* into v_record
  from public.verification_records record
  where record.id = p_record_id;

  if not found then return false; end if;

  if coalesce(v_record.metadata ->> 'source', '') = 'provider_reconciliation'
    and v_record.provider_event_at is null then
    return false;
  end if;

  if v_record.derived_from_record_id is null then return true; end if;

  select source.* into v_source
  from public.verification_records source
  where source.id = v_record.derived_from_record_id;

  if not found then return false; end if;

  if v_record.purpose = 'age_access'
    and v_source.purpose = 'adult_publisher_eligibility'
    and not (
      v_source.threshold_age is not null
      and v_source.threshold_age >= 18
      and v_source.result_over_threshold is true
    ) then
    return false;
  end if;

  select candidate.id into v_current_source_id
  from public.verification_records candidate
  left join public.verification_records candidate_parent
    on candidate_parent.id = candidate.derived_from_record_id
  where candidate.subject_type = v_source.subject_type
    and candidate.subject_id = v_source.subject_id
    and candidate.purpose = v_source.purpose
    and not (
      coalesce(candidate.metadata ->> 'source', '') = 'provider_reconciliation'
      and candidate.provider_event_at is null
    )
    -- A terminal provider decision may carry second-granularity time while its
    -- owning local reservation was recorded later in that same second. Once
    -- both records carry the same session id, the reservation is historical;
    -- unrelated pending/adverse rows remain in the normal fail-closed order.
    and not (
      candidate.status = 'pending'
      and coalesce(candidate.metadata ->> 'source', '') in (
        'verification_session',
        'verification_session_reservation'
      )
      and nullif(candidate.metadata ->> 'sessionId', '') is not null
      and exists (
        select 1
        from public.verification_records session_decision
        where session_decision.subject_type = candidate.subject_type
          and session_decision.subject_id = candidate.subject_id
          and session_decision.purpose = candidate.purpose
          and session_decision.metadata ->> 'sessionId'
            = candidate.metadata ->> 'sessionId'
          and coalesce(session_decision.metadata ->> 'source', '') in (
            'provider_webhook',
            'provider_reconciliation'
          )
          and session_decision.status in (
            'valid', 'blocked', 'invalid', 'revoked', 'expired'
          )
          and session_decision.provider_event_at is not null
          and session_decision.provider_event_at <= candidate.created_at
          and date_trunc('second', session_decision.provider_event_at)
            = date_trunc('second', candidate.created_at)
      )
    )
    and not (
      candidate.purpose = 'age_access'
      and candidate.derived_from_record_id is not null
      and candidate_parent.purpose = 'adult_publisher_eligibility'
      and not (
        candidate_parent.threshold_age is not null
        and candidate_parent.threshold_age >= 18
        and candidate_parent.result_over_threshold is true
      )
    )
    and (
      candidate.derived_from_record_id is null
      or private.verification_record_derivation_is_current(
        candidate.id,
        coalesce(p_visited, array[]::uuid[]) || p_record_id
      )
    )
  order by
    ((case
      when candidate.derived_from_record_id is not null then coalesce(
        candidate.provider_event_at,
        candidate_parent.provider_event_at,
        case
          when candidate_parent.provider = 'manual'
            or coalesce(candidate_parent.metadata ->> 'source', '') in (
              'age_session',
              'verification_session',
              'verification_session_reservation',
              'admin_kyb_override'
            ) then candidate_parent.created_at
          when candidate_parent.metadata ->> 'source' = 'provider_webhook'
            and candidate_parent.status in ('blocked', 'invalid', 'revoked', 'expired')
            then candidate_parent.created_at
          else null
        end
      )
      when candidate.provider_event_at is not null then candidate.provider_event_at
      when candidate.provider = 'manual' then candidate.created_at
      when coalesce(candidate.metadata ->> 'source', '') in (
        'age_session',
        'verification_session',
        'verification_session_reservation',
        'admin_kyb_override'
      ) then candidate.created_at
      when candidate.metadata ->> 'source' = 'provider_webhook'
        and candidate.status in ('blocked', 'invalid', 'revoked', 'expired')
        then candidate.created_at
      else null
    end) is not null) desc,
    coalesce(
      case
        when candidate.derived_from_record_id is not null then coalesce(
          candidate.provider_event_at,
          candidate_parent.provider_event_at,
          case
            when candidate_parent.provider = 'manual'
              or coalesce(candidate_parent.metadata ->> 'source', '') in (
                'age_session',
                'verification_session',
                'verification_session_reservation',
                'admin_kyb_override'
              ) then candidate_parent.created_at
            when candidate_parent.metadata ->> 'source' = 'provider_webhook'
              and candidate_parent.status in ('blocked', 'invalid', 'revoked', 'expired')
              then candidate_parent.created_at
            else null
          end
        )
        when candidate.provider_event_at is not null then candidate.provider_event_at
        when candidate.provider = 'manual' then candidate.created_at
        when coalesce(candidate.metadata ->> 'source', '') in (
          'age_session',
          'verification_session',
          'verification_session_reservation',
          'admin_kyb_override'
        ) then candidate.created_at
        when candidate.metadata ->> 'source' = 'provider_webhook'
          and candidate.status in ('blocked', 'invalid', 'revoked', 'expired')
          then candidate.created_at
        else null
      end,
      candidate.created_at
    ) desc,
    case
      when candidate.status in ('blocked', 'invalid', 'revoked', 'expired') then 3
      when candidate.status = 'pending' then 2
      else 1
    end desc,
    candidate.id desc
  limit 1;

  return v_current_source_id = v_source.id;
end;
$$;

revoke all on function private.verification_record_derivation_is_current(uuid, uuid[])
  from public, anon, authenticated;

create or replace function private.current_verification_decision_states(
  p_subject_type text,
  p_subject_ids uuid[],
  p_purpose text
)
returns table (
  subject_id uuid,
  record_id uuid,
  status text,
  decision_effective_at timestamptz,
  decision_authority text
)
language sql
stable
security invoker
set search_path = ''
as $$
  with candidates as (
    select
      record.subject_id,
      record.id as record_id,
      record.status,
      record.created_at,
      case
        when record.derived_from_record_id is not null then coalesce(
          record.provider_event_at,
          source.provider_event_at,
          case
            when source.provider = 'manual'
              or coalesce(source.metadata ->> 'source', '') in (
                'age_session',
                'verification_session',
                'verification_session_reservation',
                'admin_kyb_override'
              ) then source.created_at
            when source.metadata ->> 'source' = 'provider_webhook'
              and source.status in ('blocked', 'invalid', 'revoked', 'expired')
              then source.created_at
            else null
          end
        )
        when record.provider_event_at is not null then record.provider_event_at
        when record.provider = 'manual' then record.created_at
        when coalesce(record.metadata ->> 'source', '') in (
          'age_session',
          'verification_session',
          'verification_session_reservation',
          'admin_kyb_override'
        ) then record.created_at
        when record.metadata ->> 'source' = 'provider_webhook'
          and record.status in ('blocked', 'invalid', 'revoked', 'expired')
          then record.created_at
        else null
      end as decision_effective_at,
      case
        when record.derived_from_record_id is not null then 'derived'
        when record.provider_event_at is not null then 'provider_authenticated'
        when record.provider = 'manual' then 'manual'
        when coalesce(record.metadata ->> 'source', '') in (
          'age_session',
          'verification_session',
          'verification_session_reservation',
          'admin_kyb_override'
        ) then 'internal_transition'
        when record.metadata ->> 'source' = 'provider_webhook'
          and record.status in ('blocked', 'invalid', 'revoked', 'expired')
          then 'provider_adverse_observed'
        else 'legacy'
      end as decision_authority
    from public.verification_records record
    left join public.verification_records source
      on source.id = record.derived_from_record_id
    where record.subject_type = p_subject_type
      and record.subject_id = any(p_subject_ids)
      and record.purpose = p_purpose
      and not (
        coalesce(record.metadata ->> 'source', '') = 'provider_reconciliation'
        and record.provider_event_at is null
      )
      and not (
        record.status = 'pending'
        and coalesce(record.metadata ->> 'source', '') in (
          'verification_session',
          'verification_session_reservation'
        )
        and nullif(record.metadata ->> 'sessionId', '') is not null
        and exists (
          select 1
          from public.verification_records session_decision
          where session_decision.subject_type = record.subject_type
            and session_decision.subject_id = record.subject_id
            and session_decision.purpose = record.purpose
            and session_decision.metadata ->> 'sessionId'
              = record.metadata ->> 'sessionId'
            and coalesce(session_decision.metadata ->> 'source', '') in (
              'provider_webhook',
              'provider_reconciliation'
            )
            and session_decision.status in (
              'valid', 'blocked', 'invalid', 'revoked', 'expired'
            )
            and session_decision.provider_event_at is not null
            and session_decision.provider_event_at <= record.created_at
            and date_trunc('second', session_decision.provider_event_at)
              = date_trunc('second', record.created_at)
        )
      )
      and not (
        p_purpose = 'age_access'
        and record.derived_from_record_id is not null
        and source.purpose = 'adult_publisher_eligibility'
        and not (
          source.threshold_age is not null
          and source.threshold_age >= 18
          and source.result_over_threshold is true
        )
      )
      and (
        record.derived_from_record_id is null
        or private.verification_record_derivation_is_current(
          record.id,
          array[]::uuid[]
        )
      )
  )
  select distinct on (candidate.subject_id)
    candidate.subject_id,
    candidate.record_id,
    candidate.status,
    candidate.decision_effective_at,
    candidate.decision_authority
  from candidates candidate
  order by
    candidate.subject_id,
    (candidate.decision_effective_at is not null) desc,
    coalesce(candidate.decision_effective_at, candidate.created_at) desc,
    case
      when candidate.status in ('blocked', 'invalid', 'revoked', 'expired') then 3
      when candidate.status = 'pending' then 2
      else 1
    end desc,
    candidate.record_id desc
$$;

revoke all on function private.current_verification_decision_states(text, uuid[], text)
  from public, anon, authenticated;

create or replace function private.current_verification_decision_state(
  p_subject_type text,
  p_subject_id uuid,
  p_purpose text
)
returns table (
  record_id uuid,
  status text,
  decision_effective_at timestamptz,
  decision_authority text
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    current_decision.record_id,
    current_decision.status,
    current_decision.decision_effective_at,
    current_decision.decision_authority
  from private.current_verification_decision_states(
    p_subject_type,
    array[p_subject_id],
    p_purpose
  ) current_decision
$$;

revoke all on function private.current_verification_decision_state(text, uuid, text)
  from public, anon, authenticated;

create or replace function private.current_verification_decisions(
  p_subject_type text,
  p_subject_ids uuid[],
  p_purpose text
)
returns setof public.verification_records
language sql
stable
security invoker
set search_path = ''
as $$
  select record.*
  from private.current_verification_decision_states(
    p_subject_type,
    p_subject_ids,
    p_purpose
  ) current_decision
  join public.verification_records record
    on record.id = current_decision.record_id
$$;

revoke all on function private.current_verification_decisions(text, uuid[], text)
  from public, anon, authenticated;

comment on function private.current_verification_decisions(text, uuid[], text) is
  'Set-based canonical current verification selector. It preserves the scalar selector ordering and fail-closed derivation rules for each requested subject.';

-- Realtime and projection RLS call this SECURITY DEFINER helper directly. Keep
-- the helper on the same canonical decision authority as the Fastify policy
-- readers so a late-delivered stale valid row cannot reopen protected access.
create or replace function private.has_protected_app_access()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.users app_user
    join public.profiles profile on profile.user_id = app_user.id
    where app_user.id = (select private.current_app_user_id())
      and app_user.state = 'active'
      and nullif(btrim(profile.handle), '') is not null
      and nullif(btrim(profile.display_name), '') is not null
      and exists (
        select 1
        from public.wallets wallet
        where wallet.user_id = app_user.id
      )
      and exists (
        select 1
        from private.current_verification_decision(
          'user', app_user.id, 'age_access'
        ) current_age
        where current_age.status = 'valid'
          and current_age.threshold_age >= 18
          and current_age.result_over_threshold is true
          and (current_age.expires_at is null or current_age.expires_at > now())
      )
  )
$$;

revoke all on function private.has_protected_app_access() from public, anon;
grant execute on function private.has_protected_app_access() to authenticated;

create or replace function private.incoming_verification_decision_is_current(
  p_subject_type text,
  p_subject_id uuid,
  p_purpose text,
  p_status text,
  p_provider_event_at timestamptz,
  p_session_id uuid
)
returns boolean
language sql
volatile
security invoker
set search_path = ''
as $$
  select case
    when p_provider_event_at is null
      and p_status not in ('blocked', 'invalid', 'revoked', 'expired') then false
    else coalesce((
      select case
        when p_provider_event_at is not null
          and p_status in ('valid', 'blocked', 'invalid', 'revoked', 'expired')
          and p_session_id is not null
          and current_decision.status = 'pending'
          and current_decision.decision_authority = 'internal_transition'
          and current_record.metadata ->> 'sessionId' = p_session_id::text
          and date_trunc('second', p_provider_event_at)
            = date_trunc('second', current_decision.decision_effective_at)
          then true
        when current_decision.decision_effective_at is null then true
        when coalesce(p_provider_event_at, transaction_timestamp())
          > current_decision.decision_effective_at then true
        when coalesce(p_provider_event_at, transaction_timestamp())
          < current_decision.decision_effective_at then false
        else
          case
            when p_status in ('blocked', 'invalid', 'revoked', 'expired') then 3
            when p_status = 'pending' then 2
            else 1
          end
          > case
            when current_decision.status in ('blocked', 'invalid', 'revoked', 'expired') then 3
            when current_decision.status = 'pending' then 2
            else 1
          end
      end
      from private.current_verification_decision_state(
        p_subject_type,
        p_subject_id,
        p_purpose
      ) current_decision
      join public.verification_records current_record
        on current_record.id = current_decision.record_id
    ), true)
  end
$$;

revoke all on function private.incoming_verification_decision_is_current(
  text, uuid, text, text, timestamptz, uuid
) from public, anon, authenticated;

create or replace function private.incoming_verification_decision_is_current(
  p_subject_type text,
  p_subject_id uuid,
  p_purpose text,
  p_status text,
  p_provider_event_at timestamptz
)
returns boolean
language sql
volatile
security invoker
set search_path = ''
as $$
  select private.incoming_verification_decision_is_current(
    p_subject_type,
    p_subject_id,
    p_purpose,
    p_status,
    p_provider_event_at,
    null::uuid
  )
$$;

revoke all on function private.incoming_verification_decision_is_current(
  text, uuid, text, text, timestamptz
) from public, anon, authenticated;

create or replace function private.resolve_recipient_monetisation_policy(
  p_recipient_user_id uuid,
  p_product_type text
)
returns table (
  effective_kyc_mode text,
  kyc_required boolean,
  policy_version text,
  decision_reason text,
  jurisdiction text,
  risk_score smallint,
  decision_effective_at timestamptz,
  decision_expires_at timestamptz
)
language plpgsql
stable
security invoker
set search_path = public, private
as $$
declare
  v_policy recipient_monetisation_policies%rowtype;
  v_override recipient_monetisation_overrides%rowtype;
  v_jurisdiction text;
  v_risk_score smallint;
  v_risk_effective_at timestamptz;
  v_risk_expires_at timestamptz;
begin
  if p_product_type not in (
    'support', 'content_unlock', 'live_pass', 'event_access_pass',
    'event_ticket', 'paid_message', 'creator_subscription'
  ) then
    return query select 'required', true, 'unsupported-product-fail-closed',
      'unsupported_product', null::text, null::smallint, now(), null::timestamptz;
    return;
  end if;

  select rmp.* into strict v_policy
  from recipient_monetisation_policies rmp
  where rmp.policy_key = 'default'
    and rmp.effective_at <= now();

  select rmo.* into v_override
  from recipient_monetisation_overrides rmo
  where rmo.user_id = p_recipient_user_id
    and rmo.effective_at <= now()
    and (rmo.expires_at is null or rmo.expires_at > now());

  select upper(btrim(current_fact.jurisdiction)) into v_jurisdiction
  from (
    select decision.purpose, decision.jurisdiction
    from (values ('creator_kyc', 0), ('age_access', 1)) purpose(purpose, priority)
    cross join lateral private.current_verification_decision(
      'user', p_recipient_user_id, purpose.purpose
    ) decision
    where decision.status = 'valid'
      and decision.jurisdiction is not null
      and (decision.expires_at is null or decision.expires_at > now())
    order by purpose.priority
    limit 1
  ) current_fact;

  select assessment.risk_score, assessment.effective_at, assessment.expires_at
    into v_risk_score, v_risk_effective_at, v_risk_expires_at
  from recipient_monetisation_risk_assessments assessment
  where assessment.user_id = p_recipient_user_id
    and assessment.product_type = p_product_type
    and assessment.state = 'active'
    and assessment.effective_at <= now()
    and (assessment.expires_at is null or assessment.expires_at > now())
  order by assessment.effective_at desc, assessment.id desc
  limit 1;

  if v_override.kyc_requirement = 'required' then
    return query select 'required', true, v_policy.policy_version,
      'account_override_required', v_jurisdiction, v_risk_score,
      v_override.effective_at, v_override.expires_at;
  elsif v_policy.kyc_mode = 'required' then
    return query select 'required', true, v_policy.policy_version,
      'global_policy_required', v_jurisdiction, v_risk_score,
      v_policy.effective_at, null::timestamptz;
  elsif v_policy.kyc_mode = 'disabled' then
    return query select 'disabled', false, v_policy.policy_version,
      'global_policy_disabled', v_jurisdiction, v_risk_score,
      v_policy.effective_at, null::timestamptz;
  elsif v_override.kyc_requirement = 'not_required' then
    return query select 'disabled', false, v_policy.policy_version,
      'account_override_not_required', v_jurisdiction, v_risk_score,
      v_override.effective_at, v_override.expires_at;
  elsif p_product_type = any(v_policy.kyc_required_product_types) then
    return query select 'risk_based', true, v_policy.policy_version,
      'product_policy_required', v_jurisdiction, v_risk_score,
      v_policy.effective_at, null::timestamptz;
  elsif v_jurisdiction is not null
    and exists (
      select 1
      from unnest(v_policy.kyc_required_jurisdictions) configured_jurisdiction
      where upper(btrim(configured_jurisdiction)) = v_jurisdiction
    ) then
    return query select 'risk_based', true, v_policy.policy_version,
      'jurisdiction_policy_required', v_jurisdiction, v_risk_score,
      v_policy.effective_at, null::timestamptz;
  elsif v_risk_score is not null
    and v_risk_score >= v_policy.kyc_risk_score_threshold then
    return query select 'risk_based', true, v_policy.policy_version,
      'risk_threshold_required', v_jurisdiction, v_risk_score,
      v_risk_effective_at, v_risk_expires_at;
  else
    return query select 'risk_based', false, v_policy.policy_version,
      'risk_policy_not_triggered', v_jurisdiction, v_risk_score,
      coalesce(v_risk_effective_at, v_policy.effective_at), v_risk_expires_at;
  end if;
end;
$$;

revoke all on function private.resolve_recipient_monetisation_policy(uuid, text)
  from public, anon, authenticated;

create or replace function private.resolve_creator_kyc_state(p_recipient_user_id uuid)
returns table (
  kyc_state text,
  kyc_required boolean,
  effective_kyc_mode text,
  policy_version text,
  decision_reasons text[]
)
language sql
stable
security invoker
set search_path = public, private
as $$
  select
    case
      when not policy.kyc_required then 'not_required'
      when verification.status = 'valid'
        and verification.assurance_level in ('high', 'documentary')
        and (verification.expires_at is null or verification.expires_at > now())
        then 'verified'
      when verification.status = 'pending' then 'pending'
      when verification.status in ('invalid', 'blocked', 'revoked', 'expired') then 'failed'
      else 'required'
    end,
    policy.kyc_required,
    policy.effective_kyc_mode,
    policy.policy_version,
    policy.decision_reasons
  from private.resolve_creator_monetisation_policy(p_recipient_user_id) policy
  left join lateral private.current_verification_decision(
    'user', p_recipient_user_id, 'creator_kyc'
  ) verification on true;
$$;

revoke all on function private.resolve_creator_kyc_state(uuid)
  from public, anon, authenticated;

create or replace function private.assert_recipient_monetisation_ready(
  p_recipient_user_id uuid,
  p_product_type text,
  p_wallet_chain wallet_chain,
  p_organization_id uuid default null
)
returns table (
  wallet_id uuid,
  address text,
  effective_kyc_mode text,
  kyc_required boolean,
  policy_version text,
  decision_reason text
)
language plpgsql
security invoker
set search_path = public, private
as $$
declare
  v_user_state text;
  v_settings creator_monetisation_settings%rowtype;
  v_decision record;
begin
  if p_organization_id is not null then
    raise exception using errcode = 'P0001', message = 'organization_recipient_policy_not_implemented';
  end if;

  select u.state into v_user_state from users u where u.id = p_recipient_user_id;
  if not found or v_user_state <> 'active' then
    raise exception using errcode = 'P0001', message = 'recipient_account_not_active';
  end if;

  select cms.* into v_settings
  from creator_monetisation_settings cms
  where cms.user_id = p_recipient_user_id
  for share;
  if not found or v_settings.state <> 'active' or v_settings.earning_state <> 'ready' then
    raise exception using errcode = 'P0001', message = 'recipient_monetisation_not_active';
  end if;

  if v_settings.tax_profile_state not in ('not_required', 'verified') then
    raise exception using errcode = 'P0001', message = 'recipient_tax_readiness_required';
  end if;

  select * into strict v_decision
  from private.resolve_recipient_monetisation_policy(p_recipient_user_id, p_product_type);

  if not exists (
    select 1
    from private.current_verification_decision(
      'user', p_recipient_user_id, 'age_access'
    ) current_age
    where current_age.status = 'valid'
      and current_age.result_over_threshold is true
      and current_age.threshold_age >= 18
      and (current_age.expires_at is null or current_age.expires_at > now())
  ) then
    raise exception using errcode = 'P0001', message = 'recipient_age_access_required';
  end if;

  if v_decision.kyc_required and not exists (
    select 1
    from private.current_verification_decision(
      'user', p_recipient_user_id, 'creator_kyc'
    ) current_kyc
    where current_kyc.status = 'valid'
      and current_kyc.assurance_level in ('high', 'documentary')
      and (current_kyc.expires_at is null or current_kyc.expires_at > now())
  ) then
    raise exception using errcode = 'P0001', message = 'recipient_creator_kyc_required';
  end if;

  if not (case p_product_type
    when 'support' then v_settings.support_enabled
    when 'content_unlock' then v_settings.content_unlocks_enabled
    when 'live_pass' then v_settings.live_passes_enabled
    when 'event_access_pass' then v_settings.live_passes_enabled
    when 'event_ticket' then v_settings.live_passes_enabled
    when 'paid_message' then v_settings.paid_messages_enabled
    when 'creator_subscription' then v_settings.subscriptions_enabled
    else false
  end) then
    raise exception using errcode = 'P0001', message = 'recipient_product_not_enabled';
  end if;

  return query
  select w.id, w.address, v_decision.effective_kyc_mode,
    v_decision.kyc_required, v_decision.policy_version, v_decision.decision_reason
  from wallets w
  where w.id = v_settings.earnings_recipient_wallet_id
    and w.user_id = p_recipient_user_id
    and (p_wallet_chain is null or w.chain = p_wallet_chain)
  limit 1;

  if not found then
    raise exception using errcode = 'P0001', message = 'recipient_wallet_required';
  end if;
end;
$$;

revoke all on function private.assert_recipient_monetisation_ready(
  uuid, text, wallet_chain, uuid
) from public, anon, authenticated;

create or replace function private.resolve_managed_creator_allocation(
  p_creator_user_id uuid,
  p_wallet_chain wallet_chain
)
returns table (
  relationship_id uuid,
  agreement_id uuid,
  organization_id uuid,
  enterprise_wallet text,
  enterprise_management_share_bps integer
)
language plpgsql
security invoker
set search_path = public, private
as $$
declare
  v_relationship managed_creator_relationships%rowtype;
  v_agreement managed_creator_agreements%rowtype;
  v_wallet organization_settlement_wallets%rowtype;
begin
  select relationship.* into v_relationship
  from managed_creator_relationships relationship
  where relationship.creator_user_id = p_creator_user_id
    and relationship.state = 'active'
  order by relationship.accepted_at desc
  limit 1;

  if not found then
    return;
  end if;

  if not exists (
    select 1
    from organizations organization
    where organization.id = v_relationship.organization_id
      and organization.state = 'active'
  ) or not exists (
    select 1
    from private.current_verification_decision(
      'organization', v_relationship.organization_id, 'org_kyb'
    ) current_kyb
    where current_kyb.status = 'valid'
      and (current_kyb.expires_at is null or current_kyb.expires_at > now())
  ) then
    raise exception using errcode = 'P0001', message = 'managed_creator_organization_not_ready';
  end if;

  if not exists (
    select 1
    from tier_waivers entitlement
    where entitlement.subject_type = 'organization'
      and entitlement.subject_id = v_relationship.organization_id
      and entitlement.tier_key = 'enterprise'
      and entitlement.state = 'active'
      and entitlement.starts_at <= now()
      and (entitlement.ends_at is null or entitlement.ends_at > now())
  ) then
    raise exception using errcode = 'P0001', message = 'managed_creator_enterprise_entitlement_required';
  end if;

  select agreement.* into v_agreement
  from managed_creator_agreements agreement
  where agreement.relationship_id = v_relationship.id
    and agreement.state = 'accepted'
    and agreement.effective_at <= now()
    and (agreement.ends_at is null or agreement.ends_at > now())
  order by agreement.version_number desc
  limit 1;

  if not found then
    raise exception using errcode = 'P0001', message = 'managed_creator_agreement_not_ready';
  end if;

  if not (v_agreement.permissions @> array['revenue_allocation']::text[]) then
    return;
  end if;

  select wallet.* into v_wallet
  from organization_settlement_wallets wallet
  where wallet.organization_id = v_relationship.organization_id
    and wallet.chain = p_wallet_chain
    and wallet.state = 'active'
    and wallet.is_primary is true
  limit 1;

  if not found then
    raise exception using errcode = 'P0001', message = 'managed_creator_wallet_required';
  end if;

  return query select
    v_relationship.id,
    v_agreement.id,
    v_relationship.organization_id,
    v_wallet.address,
    v_agreement.enterprise_management_share_bps;
end;
$$;

revoke all on function private.resolve_managed_creator_allocation(uuid, wallet_chain)
  from public, anon, authenticated;

create or replace function private.sync_performer_verification_record()
returns trigger
language plpgsql
security invoker
set search_path = public, private
as $$
begin
  if new.subject_type = 'performer'
    and new.purpose = 'performer_eligibility'
    and exists (
      select 1
      from private.current_verification_decision_state(
        'performer', new.subject_id, 'performer_eligibility'
      ) current_decision
      where current_decision.record_id = new.id
    ) then
    update performer_subjects
    set
      verification_status = case when new.status = 'invalid' then 'blocked' else new.status end,
      verification_provider = new.provider,
      verification_reference = new.provider_reference,
      verification_method = new.method,
      assurance_level = new.assurance_level,
      result_over_18 = new.result_over_threshold,
      verified_at = new.verified_at,
      expires_at = new.expires_at,
      source_verification_record_id = new.id,
      updated_at = now()
    where id = new.subject_id;
  end if;
  return new;
end;
$$;

revoke all on function private.sync_performer_verification_record()
  from public, anon, authenticated;

with current_performer_decisions as (
  select
    performer.id as performer_subject_id,
    current_record.*
  from performer_subjects performer
  cross join lateral private.current_verification_decision(
    'performer', performer.id, 'performer_eligibility'
  ) current_record
)
update performer_subjects performer
set
  verification_status = case
    when current_record.status = 'invalid' then 'blocked'
    else current_record.status
  end,
  verification_provider = current_record.provider,
  verification_reference = current_record.provider_reference,
  verification_method = current_record.method,
  assurance_level = current_record.assurance_level,
  result_over_18 = current_record.result_over_threshold,
  verified_at = current_record.verified_at,
  expires_at = current_record.expires_at,
  source_verification_record_id = current_record.id,
  updated_at = now()
from current_performer_decisions current_record
where performer.id = current_record.performer_subject_id
  and performer.source_verification_record_id is distinct from current_record.id;

create or replace function private.content_performer_readiness(p_content_item_id uuid)
returns boolean
language sql
stable
security invoker
set search_path = public, private
as $$
  select case
    when ci.nsfw_label = 'none' then true
    when not exists (
      select 1
      from private.current_verification_decision(
        'user', ci.creator_user_id, 'adult_publisher_eligibility'
      ) current_adult
      where current_adult.status = 'valid'
        and current_adult.result_over_threshold is true
        and current_adult.threshold_age >= 18
        and current_adult.assurance_level in ('high', 'documentary')
        and current_adult.policy_version is not null
        and current_adult.terms_accepted_at is not null
        and (current_adult.expires_at is null or current_adult.expires_at > now())
    ) then false
    when csd.state <> 'active' or csd.representation_mode = 'not_declared' then false
    when csd.representation_mode = 'no_real_person' then true
    when csd.representation_mode = 'self_only' then
      exists (
        select 1
        from performer_consents pc
        join performer_subjects ps on ps.id = pc.performer_subject_id
        where pc.content_item_id = ci.id
          and pc.content_revision = csd.content_revision
          and ps.linked_user_id = ci.creator_user_id
          and ps.dispute_state = 'none'
          and exists (
            select 1
            from private.current_verification_decision(
              'performer', ps.id, 'performer_eligibility'
            ) current_performer
            where current_performer.status = 'valid'
              and current_performer.result_over_threshold is true
              and current_performer.threshold_age >= 18
              and (current_performer.expires_at is null or current_performer.expires_at > now())
          )
          and pc.state = 'active'
          and pc.allowed_uses @> array['capture', 'upload', 'distribution']::text[]
          and (pc.expires_at is null or pc.expires_at > now())
      )
    when csd.representation_mode = 'declared_performers' then
      exists (
        select 1
        from performer_consent_requests pcr
        where pcr.content_item_id = ci.id
          and pcr.content_revision = csd.content_revision
      )
      and not exists (
        select 1
        from performer_consent_requests pcr
        join performer_subjects ps on ps.id = pcr.performer_subject_id
        left join performer_consents pc
          on pc.content_item_id = pcr.content_item_id
          and pc.performer_subject_id = pcr.performer_subject_id
          and pc.content_revision = pcr.content_revision
          and pc.state = 'active'
        left join lateral private.current_verification_decision(
          'performer', ps.id, 'performer_eligibility'
        ) current_performer on true
        where pcr.content_item_id = ci.id
          and pcr.content_revision = csd.content_revision
          and (
            pcr.state <> 'accepted'
            or pcr.allowed_uses is distinct from pc.allowed_uses
            or pc.id is null
            or not (pc.allowed_uses @> array['capture', 'upload', 'distribution']::text[])
            or (pc.expires_at is not null and pc.expires_at <= now())
            or current_performer.id is null
            or current_performer.status <> 'valid'
            or current_performer.result_over_threshold is distinct from true
            or current_performer.threshold_age is null
            or current_performer.threshold_age < 18
            or ps.dispute_state <> 'none'
            or (
              current_performer.expires_at is not null
              and current_performer.expires_at <= now()
            )
          )
      )
    else false
  end
  from content_items ci
  left join content_safety_declarations csd on csd.content_item_id = ci.id
  where ci.id = p_content_item_id;
$$;

revoke all on function private.content_performer_readiness(uuid)
  from public, anon, authenticated;

create or replace function private.eligible_content_access_base(
  p_viewer_user_id uuid,
  p_content_preference text,
  p_candidate_content_ids uuid[]
)
returns table (content_item_id uuid)
language sql
stable
security invoker
set search_path = public, private
as $$
  with candidate_scope as materialized (
    select content.*
    from content_items content
    where content.id = any(p_candidate_content_ids)
      and content.state = 'ready'
      and content.publish_state = 'published'
      and content.moderation_state = 'approved'
  ),
  adult_no_real_person_creators as materialized (
    select distinct content.creator_user_id
    from candidate_scope content
    join content_safety_declarations declaration
      on declaration.content_item_id = content.id
     and declaration.state = 'active'
     and declaration.representation_mode = 'no_real_person'
    where content.nsfw_label in ('adult', 'explicit')
  ),
  current_adult_publishers as materialized (
    select current_adult.*
    from private.current_verification_decisions(
      'user',
      coalesce(
        (
          select array_agg(creator.creator_user_id)
          from adult_no_real_person_creators creator
        ),
        array[]::uuid[]
      ),
      'adult_publisher_eligibility'
    ) current_adult
  ),
  candidate_content as materialized (
    select content.*
    from candidate_scope content
    left join content_safety_declarations declaration
      on declaration.content_item_id = content.id
    left join current_adult_publishers current_adult
      on current_adult.subject_id = content.creator_user_id
    where case
      when content.nsfw_label in ('adult', 'explicit')
        and declaration.state = 'active'
        and declaration.representation_mode = 'no_real_person' then
          current_adult.status = 'valid'
          and current_adult.result_over_threshold is true
          and current_adult.threshold_age >= 18
          and current_adult.assurance_level in ('high', 'documentary')
          and current_adult.policy_version is not null
          and current_adult.terms_accepted_at is not null
          and (current_adult.expires_at is null or current_adult.expires_at > now())
      when content.nsfw_label in ('adult', 'explicit')
        then private.content_performer_readiness(content.id)
      else true
    end
  ),
  candidate_creators as materialized (
    select distinct content.creator_user_id
    from candidate_content content
  ),
  current_creator_ages as materialized (
    select current_age.*
    from private.current_verification_decisions(
      'user',
      coalesce(
        (select array_agg(creator.creator_user_id) from candidate_creators creator),
        array[]::uuid[]
      ),
      'age_access'
    ) current_age
  ),
  eligible_creators as materialized (
    select creator.id
    from candidate_creators candidate_creator
    join users creator
      on creator.id = candidate_creator.creator_user_id
      and creator.state = 'active'
    join profiles profile
      on profile.user_id = creator.id
      and profile.visibility = 'public'
    join current_creator_ages creator_age
      on creator_age.subject_id = creator.id
    where creator_age.status = 'valid'
      and creator_age.threshold_age >= 18
      and creator_age.result_over_threshold is true
      and (creator_age.expires_at is null or creator_age.expires_at > now())
  )
  select ci.id
  from candidate_content ci
  join eligible_creators creator on creator.id = ci.creator_user_id
  left join viewer_feed_preferences preference on preference.user_id = p_viewer_user_id
  where (
      (p_viewer_user_id is null and ci.visibility = 'public')
      or p_viewer_user_id = ci.creator_user_id
      or (
        p_viewer_user_id is not null
        and exists (
          select 1
          from private.current_verification_decision(
            'user', p_viewer_user_id, 'age_access'
          ) viewer_age
          where viewer_age.status = 'valid'
            and viewer_age.threshold_age >= 18
            and viewer_age.result_over_threshold is true
            and (viewer_age.expires_at is null or viewer_age.expires_at > now())
        )
        and (
          ci.visibility = 'public'
          or (
            ci.visibility = 'followers'
            and exists (
              select 1 from user_follows follow
              where follow.follower_user_id = p_viewer_user_id
                and follow.followed_user_id = ci.creator_user_id
                and follow.state = 'active'
            )
          )
          or (
            ci.visibility = 'subscribers'
            and (
              exists (
                select 1 from subscriptions membership
                where membership.subscriber_user_id = p_viewer_user_id
                  and membership.creator_user_id = ci.creator_user_id
                  and membership.scope = 'creator'
                  and membership.state in ('active', 'renewal_pending', 'grace_period')
                  and membership.current_period_starts_at is not null
                  and membership.current_period_starts_at <= now()
                  and membership.current_period_ends_at is not null
                  and membership.current_period_ends_at > now()
              )
              or exists (
                select 1 from entitlements entitlement
                where entitlement.user_id = p_viewer_user_id
                  and entitlement.target_type = 'content'
                  and entitlement.target_id = ci.id
                  and entitlement.state = 'active'
                  and entitlement.starts_at <= now()
                  and (entitlement.ends_at is null or entitlement.ends_at > now())
              )
            )
          )
        )
      )
    )
    and coalesce(
      p_content_preference,
      preference.nsfw_preference,
      case when p_viewer_user_id is null then 'sfw' else 'both' end
    ) in ('both', 'sfw', 'nsfw')
    and (
      coalesce(
        p_content_preference,
        preference.nsfw_preference,
        case when p_viewer_user_id is null then 'sfw' else 'both' end
      ) = 'both'
      or (
        coalesce(p_content_preference, preference.nsfw_preference, 'sfw') = 'sfw'
        and ci.nsfw_label = 'none'
      )
      or (
        coalesce(p_content_preference, preference.nsfw_preference, 'sfw') = 'nsfw'
        and ci.nsfw_label in ('adult', 'explicit')
      )
    )
    and not exists (
      select 1 from viewer_hidden_creators hidden
      where hidden.user_id = p_viewer_user_id
        and hidden.creator_user_id = ci.creator_user_id
    )
    and not exists (
      select 1
      from viewer_hidden_topics hidden_topic
      join hashtags hashtag on hashtag.slug = hidden_topic.topic
      join content_hashtags content_hashtag
        on content_hashtag.hashtag_id = hashtag.id
       and content_hashtag.content_item_id = ci.id
      where hidden_topic.user_id = p_viewer_user_id
    )
    and not exists (
      select 1 from blocks block
      where (block.blocker_user_id = p_viewer_user_id and block.blocked_user_id = ci.creator_user_id)
         or (block.blocker_user_id = ci.creator_user_id and block.blocked_user_id = p_viewer_user_id)
    )
    and not exists (
      select 1 from reports report
      where report.reporter_user_id = p_viewer_user_id
        and report.subject_type = 'content'
        and report.subject_id = ci.id
    );
$$;

revoke all on function private.eligible_content_access_base(uuid, text, uuid[])
  from public, anon, authenticated;

create or replace function private.eligible_content_access_base(
  p_viewer_user_id uuid,
  p_content_preference text default null
)
returns table (content_item_id uuid)
language sql
stable
security invoker
set search_path = public, private
as $$
  select ci.id
  from content_items ci
  join users creator on creator.id = ci.creator_user_id and creator.state = 'active'
  join profiles profile on profile.user_id = creator.id and profile.visibility = 'public'
  cross join lateral private.current_verification_decision(
    'user', creator.id, 'age_access'
  ) creator_age
  left join viewer_feed_preferences preference on preference.user_id = p_viewer_user_id
  where ci.state = 'ready'
    and ci.publish_state = 'published'
    and ci.moderation_state = 'approved'
    and case
      when ci.nsfw_label in ('adult', 'explicit')
        then private.content_performer_readiness(ci.id)
      else true
    end
    and creator_age.status = 'valid'
    and creator_age.threshold_age >= 18
    and creator_age.result_over_threshold is true
    and (creator_age.expires_at is null or creator_age.expires_at > now())
    and (
      (p_viewer_user_id is null and ci.visibility = 'public')
      or p_viewer_user_id = ci.creator_user_id
      or (
        p_viewer_user_id is not null
        and exists (
          select 1
          from private.current_verification_decision(
            'user', p_viewer_user_id, 'age_access'
          ) viewer_age
          where viewer_age.status = 'valid'
            and viewer_age.threshold_age >= 18
            and viewer_age.result_over_threshold is true
            and (viewer_age.expires_at is null or viewer_age.expires_at > now())
        )
        and (
          ci.visibility = 'public'
          or (
            ci.visibility = 'followers'
            and exists (
              select 1 from user_follows follow
              where follow.follower_user_id = p_viewer_user_id
                and follow.followed_user_id = ci.creator_user_id
                and follow.state = 'active'
            )
          )
          or (
            ci.visibility = 'subscribers'
            and (
              exists (
                select 1 from subscriptions membership
                where membership.subscriber_user_id = p_viewer_user_id
                  and membership.creator_user_id = ci.creator_user_id
                  and membership.scope = 'creator'
                  and membership.state in ('active', 'renewal_pending', 'grace_period')
                  and membership.current_period_starts_at is not null
                  and membership.current_period_starts_at <= now()
                  and membership.current_period_ends_at is not null
                  and membership.current_period_ends_at > now()
              )
              or exists (
                select 1 from entitlements entitlement
                where entitlement.user_id = p_viewer_user_id
                  and entitlement.target_type = 'content'
                  and entitlement.target_id = ci.id
                  and entitlement.state = 'active'
                  and entitlement.starts_at <= now()
                  and (entitlement.ends_at is null or entitlement.ends_at > now())
              )
            )
          )
        )
      )
    )
    and coalesce(
      p_content_preference,
      preference.nsfw_preference,
      case when p_viewer_user_id is null then 'sfw' else 'both' end
    ) in ('both', 'sfw', 'nsfw')
    and (
      coalesce(
        p_content_preference,
        preference.nsfw_preference,
        case when p_viewer_user_id is null then 'sfw' else 'both' end
      ) = 'both'
      or (
        coalesce(p_content_preference, preference.nsfw_preference, 'sfw') = 'sfw'
        and ci.nsfw_label = 'none'
      )
      or (
        coalesce(p_content_preference, preference.nsfw_preference, 'sfw') = 'nsfw'
        and ci.nsfw_label in ('adult', 'explicit')
      )
    )
    and not exists (
      select 1 from viewer_hidden_creators hidden
      where hidden.user_id = p_viewer_user_id
        and hidden.creator_user_id = ci.creator_user_id
    )
    and not exists (
      select 1
      from viewer_hidden_topics hidden_topic
      join hashtags hashtag on hashtag.slug = hidden_topic.topic
      join content_hashtags content_hashtag
        on content_hashtag.hashtag_id = hashtag.id
       and content_hashtag.content_item_id = ci.id
      where hidden_topic.user_id = p_viewer_user_id
    )
    and not exists (
      select 1 from blocks block
      where (block.blocker_user_id = p_viewer_user_id and block.blocked_user_id = ci.creator_user_id)
         or (block.blocker_user_id = ci.creator_user_id and block.blocked_user_id = p_viewer_user_id)
    )
    and not exists (
      select 1 from reports report
      where report.reporter_user_id = p_viewer_user_id
        and report.subject_type = 'content'
        and report.subject_id = ci.id
    );
$$;

revoke all on function private.eligible_content_access_base(uuid, text)
  from public, anon, authenticated;

create or replace function private.eligible_content(
  p_viewer_user_id uuid,
  p_content_preference text,
  p_candidate_content_ids uuid[]
)
returns table (content_item_id uuid)
language sql
stable
security invoker
set search_path = public, private
as $$
  select eligible.content_item_id
  from private.eligible_content_access_base(
    p_viewer_user_id,
    p_content_preference,
    p_candidate_content_ids
  ) eligible
  join public.content_items content on content.id = eligible.content_item_id
  where (content.scheduled_for is null or content.scheduled_for <= now())
    and (content.distribution_mode <> 'moment' or content.expires_at > now())
$$;

revoke all on function private.eligible_content(uuid, text, uuid[])
  from public, anon, authenticated;

create or replace function private.eligible_content(
  p_viewer_user_id uuid,
  p_content_preference text default null
)
returns table (content_item_id uuid)
language sql
stable
security invoker
set search_path = public, private
as $$
  select eligible.content_item_id
  from private.eligible_content_access_base(
    p_viewer_user_id,
    p_content_preference
  ) eligible
  join public.content_items content on content.id = eligible.content_item_id
  where (content.scheduled_for is null or content.scheduled_for <= now())
    and (content.distribution_mode <> 'moment' or content.expires_at > now())
$$;

revoke all on function private.eligible_content(uuid, text)
  from public, anon, authenticated;

comment on function private.eligible_content(uuid, text, uuid[]) is
  'Canonical current-policy eligibility constrained to a caller-supplied chronological candidate window.';
