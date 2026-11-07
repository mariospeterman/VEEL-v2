-- One fail-closed current verification decision per subject and purpose.
-- Historical verification rows remain immutable. The selector derives decision
-- authority at read time so legacy data is not rewritten during deployment.

create function private.current_verification_decision_state(
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
  with candidates as (
    select
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
    left join lateral (
      with source_candidates as (
        select
          candidate_source.id,
          candidate_source.status,
          candidate_source.created_at,
          case
            when candidate_source.provider_event_at is not null
              then candidate_source.provider_event_at
            when candidate_source.provider = 'manual'
              then candidate_source.created_at
            when coalesce(candidate_source.metadata ->> 'source', '') in (
              'age_session',
              'verification_session',
              'verification_session_reservation',
              'admin_kyb_override'
            ) then candidate_source.created_at
            when candidate_source.metadata ->> 'source' = 'provider_webhook'
              and candidate_source.status in ('blocked', 'invalid', 'revoked', 'expired')
              then candidate_source.created_at
            else null
          end as decision_effective_at
        from public.verification_records candidate_source
        where candidate_source.subject_type = source.subject_type
          and candidate_source.subject_id = source.subject_id
          and candidate_source.purpose = source.purpose
      )
      select candidate.id
      from source_candidates candidate
      order by
        (candidate.decision_effective_at is not null) desc,
        coalesce(candidate.decision_effective_at, candidate.created_at) desc,
        case
          when candidate.status in ('blocked', 'invalid', 'revoked', 'expired') then 3
          when candidate.status = 'pending' then 2
          else 1
        end desc,
        candidate.id desc
      limit 1
    ) current_source on record.derived_from_record_id is not null
    where record.subject_type = p_subject_type
      and record.subject_id = p_subject_id
      and record.purpose = p_purpose
      -- Documentary identity/liveness proves identity, not adulthood. Historical
      -- rows derived from the adult-publisher workflow are therefore excluded
      -- from age access unless their source carried an explicit threshold fact.
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
        or current_source.id = source.id
      )
  )
  select
    candidate.record_id,
    candidate.status,
    candidate.decision_effective_at,
    candidate.decision_authority
  from candidates candidate
  order by
    (candidate.decision_effective_at is not null) desc,
    coalesce(candidate.decision_effective_at, candidate.created_at) desc,
    case
      when candidate.status in ('blocked', 'invalid', 'revoked', 'expired') then 3
      when candidate.status = 'pending' then 2
      else 1
    end desc,
    candidate.record_id desc
  limit 1
$$;

revoke all on function private.current_verification_decision_state(text, uuid, text)
  from public, anon, authenticated;

create function private.current_verification_decision(
  p_subject_type text,
  p_subject_id uuid,
  p_purpose text
)
returns setof public.verification_records
language sql
stable
security invoker
set search_path = ''
as $$
  select record.*
  from private.current_verification_decision_state(
    p_subject_type,
    p_subject_id,
    p_purpose
  ) current_decision
  join public.verification_records record
    on record.id = current_decision.record_id
$$;

revoke all on function private.current_verification_decision(text, uuid, text)
  from public, anon, authenticated;

comment on function private.current_verification_decision(text, uuid, text) is
  'Sole current verification selector. Select first; evaluate status, assurance, expiry, revocation, and purpose-specific facts only afterward.';

create function private.incoming_verification_decision_is_current(
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
  select coalesce((
    select case
      when p_provider_event_at is null
        and p_status not in ('blocked', 'invalid', 'revoked', 'expired')
        and not (
          current_decision.status = 'pending'
          and current_decision.decision_authority in ('internal_transition', 'legacy')
        ) then false
      when p_provider_event_at is null
        and current_decision.status = 'pending'
        and current_decision.decision_authority in ('internal_transition', 'legacy') then true
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
  ), true)
$$;

revoke all on function private.incoming_verification_decision_is_current(
  text, uuid, text, text, timestamptz
) from public, anon, authenticated;
