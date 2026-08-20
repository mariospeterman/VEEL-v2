drop function if exists private.eligible_content(uuid, text);
drop index if exists subscriptions_content_eligibility_idx;

alter table viewer_feed_preferences
  drop constraint if exists viewer_feed_preferences_default_feed_mode_check,
  add constraint viewer_feed_preferences_default_feed_mode_check
    check (default_feed_mode in ('recommended', 'following', 'nsfw', 'sfw'));

drop function private.assert_recipient_monetisation_ready(uuid, text, wallet_chain, uuid);
drop function if exists private.resolve_creator_kyc_state(uuid);
drop function if exists private.resolve_creator_monetisation_policy(uuid);
drop function if exists private.resolve_recipient_monetisation_policy(uuid, text);

drop table if exists recipient_monetisation_risk_assessments;

alter table subscription_collections
  drop column if exists recipient_kyc_decision_reason,
  drop column if exists recipient_kyc_policy_version,
  drop column if exists recipient_kyc_policy_mode,
  drop column if exists recipient_kyc_required;

alter table subscription_plans
  drop column if exists recipient_kyc_decision_reason,
  drop column if exists recipient_kyc_policy_version,
  drop column if exists recipient_kyc_policy_mode,
  drop column if exists recipient_kyc_required;

alter table payment_intents
  drop column if exists recipient_kyc_decision_reason,
  drop column if exists recipient_kyc_policy_version,
  drop column if exists recipient_kyc_policy_mode,
  drop column if exists recipient_kyc_required;

alter table recipient_monetisation_policies
  drop column if exists kyc_required_jurisdictions,
  drop column if exists kyc_required_product_types,
  drop column if exists kyc_risk_score_threshold;

create function private.assert_recipient_monetisation_ready(
  p_recipient_user_id uuid,
  p_product_type text,
  p_wallet_chain wallet_chain,
  p_organization_id uuid default null
)
returns table (wallet_id uuid, address text, effective_kyc_mode text, policy_version text)
language plpgsql
security invoker
set search_path = public, private
as $$
declare
  v_user_state text;
  v_settings creator_monetisation_settings%rowtype;
  v_policy recipient_monetisation_policies%rowtype;
  v_override recipient_monetisation_overrides%rowtype;
  v_effective_kyc_mode text;
begin
  if p_organization_id is not null then
    raise exception using errcode = 'P0001', message = 'organization_recipient_policy_not_implemented';
  end if;

  select u.state into v_user_state
  from users u
  where u.id = p_recipient_user_id;

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

  select rmp.* into strict v_policy
  from recipient_monetisation_policies rmp
  where rmp.policy_key = 'default'
    and rmp.effective_at <= now();

  select rmo.* into v_override
  from recipient_monetisation_overrides rmo
  where rmo.user_id = p_recipient_user_id
    and rmo.effective_at <= now()
    and (rmo.expires_at is null or rmo.expires_at > now());

  v_effective_kyc_mode := case
    when v_override.kyc_requirement = 'required' then 'required'
    when v_override.kyc_requirement = 'not_required' then 'disabled'
    when v_policy.kyc_mode = 'required' then 'required'
    else v_policy.kyc_mode
  end;

  if not exists (
    select 1
    from verification_records vr
    where vr.subject_type = 'user'
      and vr.subject_id = p_recipient_user_id
      and vr.purpose = 'age_access'
      and vr.status = 'valid'
      and vr.result_over_threshold is true
      and (vr.expires_at is null or vr.expires_at > now())
  ) then
    raise exception using errcode = 'P0001', message = 'recipient_age_access_required';
  end if;

  if v_effective_kyc_mode = 'required' and not exists (
    select 1
    from verification_records vr
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
  select w.id, w.address, v_effective_kyc_mode, v_policy.policy_version
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
  'Canonical recipient earning readiness. KYC follows effective policy and is independent from adult publishing and Enterprise management.';
