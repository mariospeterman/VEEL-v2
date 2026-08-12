drop function if exists private.resolve_managed_creator_allocation(uuid, wallet_chain);

drop function if exists private.assert_recipient_monetisation_ready(uuid, text, wallet_chain, uuid);

drop policy if exists verification_records_select_self_org_performer_or_staff on verification_records;
drop policy if exists verification_sessions_select_self_org_performer_or_staff on verification_sessions;

drop trigger if exists media_assets_bump_performer_revision on media_assets;
drop trigger if exists content_items_bump_performer_revision on content_items;
drop trigger if exists content_safety_declarations_bump_performer_revision on content_safety_declarations;
drop function if exists private.bump_content_performer_revision();
drop trigger if exists verification_records_sync_performer on verification_records;
drop function if exists private.sync_performer_verification_record();

drop policy if exists managed_creator_allocation_records_party_or_staff_select on managed_creator_allocation_records;
drop policy if exists managed_creator_agreements_party_or_staff_select on managed_creator_agreements;
drop policy if exists managed_creator_relationships_party_or_staff_select on managed_creator_relationships;
drop policy if exists organization_settlement_wallets_member_or_staff_select on organization_settlement_wallets;
drop policy if exists performer_consent_requests_select_party_or_staff on performer_consent_requests;
drop policy if exists recipient_monetisation_overrides_self_or_staff_select on recipient_monetisation_overrides;
drop policy if exists recipient_monetisation_policies_staff_select on recipient_monetisation_policies;

revoke select on table managed_creator_agreements from authenticated;
revoke select on table managed_creator_relationships from authenticated;
revoke select on table organization_settlement_wallets from authenticated;
revoke select on table managed_creator_allocation_records from authenticated;
revoke select on table performer_consent_requests from authenticated;
revoke select on table recipient_monetisation_overrides from authenticated;
revoke select on table recipient_monetisation_policies from authenticated;

drop table if exists managed_creator_allocation_records;

alter table payment_intents
  drop constraint if exists payment_intents_javascript_safe_atomic_amounts_check,
  drop constraint if exists payment_intents_enterprise_allocation_check,
  drop constraint if exists payment_intents_split_total_check,
  drop constraint if exists payment_intents_split_amounts_nonnegative_check,
  drop column if exists enterprise_organization_id,
  drop column if exists managed_creator_agreement_id,
  drop column if exists managed_creator_relationship_id,
  drop column if exists enterprise_management_amount_minor,
  drop column if exists enterprise_wallet,
  drop column if exists platform_fee_gross_minor,
  drop column if exists creator_side_proceeds_minor;

alter table payment_intents rename column referral_amount_minor to allocation_amount_minor;
alter table payment_intents rename column referral_wallet to allocation_wallet;

alter table payment_intents
  add constraint payment_intents_split_amounts_nonnegative_check check (
    total_amount_minor > 0
    and creator_amount_minor > 0
    and platform_fee_amount_minor >= 0
    and allocation_amount_minor >= 0
  ),
  add constraint payment_intents_split_total_check check (
    total_amount_minor = creator_amount_minor + platform_fee_amount_minor + allocation_amount_minor
  ),
  add constraint payment_intents_javascript_safe_atomic_amounts_check check (
    amount_minor between 1 and 9007199254740991
    and total_amount_minor between 1 and 9007199254740991
    and creator_amount_minor between 1 and 9007199254740991
    and platform_fee_amount_minor between 0 and 9007199254740991
    and allocation_amount_minor between 0 and 9007199254740991
  );

drop table if exists managed_creator_agreements;
drop table if exists managed_creator_relationships;
drop table if exists organization_settlement_wallets;

alter table organization_memberships
  drop constraint organization_memberships_role_check,
  add constraint organization_memberships_role_check check (role in ('owner', 'admin', 'member', 'viewer'));

drop table if exists performer_consent_requests;

alter table performer_consents drop column if exists content_revision;
alter table performer_subjects
  drop constraint if exists performer_subjects_kind_link_check,
  drop column if exists source_verification_record_id,
  drop column if exists display_label,
  drop column if exists subject_kind;
alter table content_safety_declarations drop column if exists content_revision;

delete from verification_records
where subject_type = 'performer' or purpose = 'performer_eligibility';
delete from verification_sessions
where subject_type = 'performer' or purpose = 'performer_eligibility';

alter table verification_sessions
  drop constraint verification_sessions_subject_type_check,
  drop constraint verification_sessions_purpose_check,
  add constraint verification_sessions_subject_type_check check (subject_type in (
    'user', 'organization', 'organization_person'
  )),
  add constraint verification_sessions_purpose_check check (purpose in (
    'age_access',
    'adult_publisher_eligibility',
    'creator_kyc',
    'payout_kyc',
    'org_kyb',
    'ubo_kyc',
    'enterprise_review'
  ));

alter table verification_records
  drop constraint verification_records_subject_type_check,
  drop constraint verification_records_purpose_check,
  add constraint verification_records_subject_type_check check (subject_type in (
    'user', 'organization', 'organization_person'
  )),
  add constraint verification_records_purpose_check check (purpose in (
    'age_access',
    'adult_publisher_eligibility',
    'creator_kyc',
    'payout_kyc',
    'org_kyb',
    'ubo_kyc',
    'enterprise_review'
  ));

create policy verification_sessions_select_self_org_or_staff
  on verification_sessions for select to authenticated
  using (
    (subject_type = 'user' and subject_id = (select private.current_app_user_id()))
    or (subject_type = 'organization' and exists (
      select 1 from organization_memberships om
      where om.organization_id = verification_sessions.subject_id
        and om.user_id = (select private.current_app_user_id())
        and om.state in ('active', 'invited')
    ))
    or (select private.is_staff_member())
  );

create policy verification_records_select_self_org_or_staff
  on verification_records for select to authenticated
  using (
    (subject_type = 'user' and subject_id = (select private.current_app_user_id()))
    or (subject_type = 'organization' and exists (
      select 1 from organization_memberships om
      where om.organization_id = verification_records.subject_id
        and om.user_id = (select private.current_app_user_id())
        and om.state in ('active', 'invited')
    ))
    or (select private.is_staff_member())
  );

drop table if exists recipient_monetisation_overrides;
drop table if exists recipient_monetisation_policies;

create function private.assert_recipient_monetisation_ready(
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

  if not exists (
    select 1 from verification_records vr
    where vr.subject_type = 'user' and vr.subject_id = p_recipient_user_id
      and vr.purpose = 'age_access' and vr.status = 'valid'
      and vr.result_over_threshold is true
      and (vr.expires_at is null or vr.expires_at > now())
  ) then
    raise exception using errcode = 'P0001', message = 'recipient_age_access_required';
  end if;

  if not exists (
    select 1 from verification_records vr
    where vr.subject_type = 'user' and vr.subject_id = p_recipient_user_id
      and vr.purpose = 'creator_kyc' and vr.status = 'valid'
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

revoke all on function private.assert_recipient_monetisation_ready(uuid, text, wallet_chain, uuid)
  from public, anon, authenticated;
