-- Canonical noncustodial recipient-readiness policy for creator-paid products.

create or replace function private.assert_recipient_monetisation_ready(
  p_recipient_user_id uuid,
  p_product_type text,
  p_wallet_chain wallet_chain,
  p_organization_id uuid default null
)
returns table (wallet_id uuid, address text)
language plpgsql
security invoker
set search_path = public, private
as $$
declare
  v_user_state text;
  v_settings creator_monetisation_settings%rowtype;
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

  if not exists (
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
    when 'tip' then v_settings.support_enabled
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
  select w.id, w.address
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

comment on function private.assert_recipient_monetisation_ready(uuid, text, wallet_chain, uuid) is
  'Asserts individual creator-proceeds readiness and returns the user-owned settlement wallet. No custody or payout queue.';

revoke all on function private.assert_recipient_monetisation_ready(uuid, text, wallet_chain, uuid)
  from public, anon, authenticated;
