-- Converge recipient KYC policy and viewer-relative public content eligibility.
-- Age, adult-publisher, performer, KYC, Enterprise, payment, and entitlement
-- authorities remain independent.

alter table recipient_monetisation_policies
  add column kyc_risk_score_threshold smallint not null default 70
    check (kyc_risk_score_threshold between 1 and 100),
  add column kyc_required_product_types text[] not null default array[]::text[]
    check (kyc_required_product_types <@ array[
      'support', 'content_unlock', 'live_pass', 'event_access_pass',
      'event_ticket', 'paid_message', 'creator_subscription'
    ]::text[]),
  add column kyc_required_jurisdictions text[] not null default array[]::text[];

alter table payment_intents
  add column recipient_kyc_required boolean,
  add column recipient_kyc_policy_mode text
    check (recipient_kyc_policy_mode in ('disabled', 'risk_based', 'required')),
  add column recipient_kyc_policy_version text,
  add column recipient_kyc_decision_reason text;

alter table subscription_plans
  add column recipient_kyc_required boolean,
  add column recipient_kyc_policy_mode text
    check (recipient_kyc_policy_mode in ('disabled', 'risk_based', 'required')),
  add column recipient_kyc_policy_version text,
  add column recipient_kyc_decision_reason text;

alter table subscription_collections
  add column recipient_kyc_required boolean,
  add column recipient_kyc_policy_mode text
    check (recipient_kyc_policy_mode in ('disabled', 'risk_based', 'required')),
  add column recipient_kyc_policy_version text,
  add column recipient_kyc_decision_reason text;

create table recipient_monetisation_risk_assessments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  product_type text not null check (product_type in (
    'support', 'content_unlock', 'live_pass', 'event_access_pass',
    'event_ticket', 'paid_message', 'creator_subscription'
  )),
  risk_score smallint not null check (risk_score between 0 and 100),
  reason_codes text[] not null check (cardinality(reason_codes) > 0),
  source text not null check (source in ('deterministic_rules', 'provider_signal', 'manual_review')),
  state text not null default 'active' check (state in ('active', 'expired', 'revoked')),
  policy_version text not null,
  effective_at timestamptz not null default now(),
  expires_at timestamptz,
  assessed_by_user_id uuid references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (expires_at is null or expires_at > effective_at)
);

create index recipient_monetisation_risk_active_lookup_idx
  on recipient_monetisation_risk_assessments (
    user_id, product_type, effective_at desc, id desc
  )
  where state = 'active';

create index recipient_monetisation_risk_expiry_idx
  on recipient_monetisation_risk_assessments (expires_at)
  where state = 'active' and expires_at is not null;

create index recipient_monetisation_risk_assessor_idx
  on recipient_monetisation_risk_assessments (assessed_by_user_id)
  where assessed_by_user_id is not null;

alter table recipient_monetisation_risk_assessments enable row level security;
grant select on table recipient_monetisation_risk_assessments to authenticated;

create policy recipient_monetisation_risk_staff_select
  on recipient_monetisation_risk_assessments for select to authenticated
  using ((select private.is_staff_member()));

create function private.resolve_recipient_monetisation_policy(
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

  select upper(vr.jurisdiction) into v_jurisdiction
  from verification_records vr
  where vr.subject_type = 'user'
    and vr.subject_id = p_recipient_user_id
    and vr.purpose in ('age_access', 'creator_kyc')
    and vr.status = 'valid'
    and vr.jurisdiction is not null
    and (vr.expires_at is null or vr.expires_at > now())
  order by
    case when vr.purpose = 'creator_kyc' then 0 else 1 end,
    vr.created_at desc,
    vr.id desc
  limit 1;

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
    and v_jurisdiction = any(v_policy.kyc_required_jurisdictions) then
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

comment on function private.resolve_recipient_monetisation_policy(uuid, text) is
  'Canonical deterministic recipient KYC decision by global policy, account override, product, jurisdiction, and normalized risk evidence.';

create function private.resolve_creator_monetisation_policy(p_recipient_user_id uuid)
returns table (
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
  with enabled_products (product_type) as (
    select product_type
    from creator_monetisation_settings settings
    cross join lateral (values
      ('support', settings.support_enabled),
      ('content_unlock', settings.content_unlocks_enabled),
      ('event_access_pass', settings.live_passes_enabled),
      ('paid_message', settings.paid_messages_enabled),
      ('creator_subscription', settings.subscriptions_enabled)
    ) product(product_type, enabled)
    where settings.user_id = p_recipient_user_id
      and product.enabled
  ),
  decisions as (
    select decision.*
    from enabled_products product
    cross join lateral private.resolve_recipient_monetisation_policy(
      p_recipient_user_id, product.product_type
    ) decision
  )
  select
    coalesce(bool_or(decisions.kyc_required), false),
    case
      when coalesce(bool_or(decisions.effective_kyc_mode = 'required'), false) then 'required'
      when coalesce(bool_or(decisions.effective_kyc_mode = 'risk_based'), false) then 'risk_based'
      else max(decisions.effective_kyc_mode)
    end,
    max(decisions.policy_version),
    coalesce(
      array_agg(distinct decisions.decision_reason)
        filter (where decisions.decision_reason is not null),
      array[]::text[]
    )
  from decisions;
$$;

revoke all on function private.resolve_creator_monetisation_policy(uuid)
  from public, anon, authenticated;

comment on function private.resolve_creator_monetisation_policy(uuid) is
  'Aggregates the canonical per-product recipient policy across a creator current enabled products.';

create function private.resolve_creator_kyc_state(p_recipient_user_id uuid)
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
      when verification.status in ('invalid', 'blocked', 'revoked') then 'failed'
      else 'required'
    end,
    policy.kyc_required,
    policy.effective_kyc_mode,
    policy.policy_version,
    policy.decision_reasons
  from private.resolve_creator_monetisation_policy(p_recipient_user_id) policy
  left join lateral (
    select vr.status, vr.assurance_level, vr.expires_at
    from verification_records vr
    where vr.subject_type = 'user'
      and vr.subject_id = p_recipient_user_id
      and vr.purpose = 'creator_kyc'
    order by vr.created_at desc, vr.id desc
    limit 1
  ) verification on true;
$$;

revoke all on function private.resolve_creator_kyc_state(uuid)
  from public, anon, authenticated;

comment on function private.resolve_creator_kyc_state(uuid) is
  'Canonical creator KYC projection for capability, earnings, dashboard, and payment readiness paths.';

drop function private.assert_recipient_monetisation_ready(uuid, text, wallet_chain, uuid);

create function private.assert_recipient_monetisation_ready(
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
    select 1 from verification_records vr
    where vr.subject_type = 'user'
      and vr.subject_id = p_recipient_user_id
      and vr.purpose = 'age_access'
      and vr.status = 'valid'
      and vr.result_over_threshold is true
      and (vr.expires_at is null or vr.expires_at > now())
  ) then
    raise exception using errcode = 'P0001', message = 'recipient_age_access_required';
  end if;

  if v_decision.kyc_required and not exists (
    select 1 from verification_records vr
    where vr.subject_type = 'user'
      and vr.subject_id = p_recipient_user_id
      and vr.purpose = 'creator_kyc'
      and vr.status = 'valid'
      and vr.assurance_level in ('high', 'documentary')
      and (vr.expires_at is null or vr.expires_at > now())
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

revoke all on function private.assert_recipient_monetisation_ready(uuid, text, wallet_chain, uuid)
  from public, anon, authenticated;

comment on function private.assert_recipient_monetisation_ready(uuid, text, wallet_chain, uuid) is
  'Canonical recipient readiness using the deterministic recipient policy resolver. Adult publishing and Enterprise management remain independent.';

update viewer_feed_preferences
set default_feed_mode = 'recommended'
where default_feed_mode in ('nsfw', 'sfw');

alter table viewer_feed_preferences
  drop constraint viewer_feed_preferences_default_feed_mode_check,
  add constraint viewer_feed_preferences_default_feed_mode_check
    check (default_feed_mode in ('recommended', 'following'));

create index subscriptions_content_eligibility_idx
  on subscriptions (subscriber_user_id, creator_user_id, current_period_ends_at)
  where scope = 'creator'
    and state in ('active', 'renewal_pending', 'grace_period');

create function private.eligible_content(
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
  left join viewer_feed_preferences preference on preference.user_id = p_viewer_user_id
  where ci.state = 'ready'
    and ci.publish_state = 'published'
    and ci.moderation_state = 'approved'
    and exists (
      select 1 from verification_records creator_age
      where creator_age.subject_type = 'user'
        and creator_age.subject_id = creator.id
        and creator_age.purpose = 'age_access'
        and creator_age.status = 'valid'
        and creator_age.result_over_threshold is true
        and (creator_age.expires_at is null or creator_age.expires_at > now())
    )
    and (
      (p_viewer_user_id is null and ci.visibility = 'public')
      or p_viewer_user_id = ci.creator_user_id
      or (
        p_viewer_user_id is not null
        and exists (
          select 1 from verification_records viewer_age
          where viewer_age.subject_type = 'user'
            and viewer_age.subject_id = p_viewer_user_id
            and viewer_age.purpose = 'age_access'
            and viewer_age.status = 'valid'
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
                  and (
                    membership.current_period_ends_at is null
                    or membership.current_period_ends_at > now()
                  )
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

revoke all on function private.eligible_content(uuid, text)
  from public, anon, authenticated;

comment on function private.eligible_content(uuid, text) is
  'Canonical set-based content eligibility for feed, detail, Discover, profile, share, unlock, and engagement surfaces. Anonymous access is public and SFW-only.';
