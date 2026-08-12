-- Independent earning, performer, and Enterprise-management authorities.
-- Verification evidence may be reused, but none of these domains grants the others.

create table recipient_monetisation_policies (
  policy_key text primary key check (policy_key = 'default'),
  kyc_mode text not null check (kyc_mode in ('disabled', 'risk_based', 'required')),
  minimum_support_usdc_atomic bigint not null default 500000 check (minimum_support_usdc_atomic >= 500000),
  policy_version text not null,
  effective_at timestamptz not null default now(),
  updated_by_user_id uuid references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table recipient_monetisation_overrides (
  user_id uuid primary key references users(id) on delete cascade,
  kyc_requirement text not null check (kyc_requirement in ('inherit', 'not_required', 'required')),
  reason_code text not null,
  jurisdiction text,
  effective_at timestamptz not null default now(),
  expires_at timestamptz,
  reviewed_by_user_id uuid references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (expires_at is null or expires_at > effective_at)
);

insert into recipient_monetisation_policies (
  policy_key,
  kyc_mode,
  minimum_support_usdc_atomic,
  policy_version
)
values ('default', 'risk_based', 500000, 'recipient-monetisation-2026-08-v1');

create index recipient_monetisation_policies_updated_by_idx
  on recipient_monetisation_policies (updated_by_user_id)
  where updated_by_user_id is not null;

create index recipient_monetisation_overrides_reviewer_idx
  on recipient_monetisation_overrides (reviewed_by_user_id)
  where reviewed_by_user_id is not null;

alter table recipient_monetisation_policies enable row level security;
alter table recipient_monetisation_overrides enable row level security;

grant select on table recipient_monetisation_policies to authenticated;
grant select on table recipient_monetisation_overrides to authenticated;

create policy recipient_monetisation_policies_staff_select
  on recipient_monetisation_policies for select to authenticated
  using ((select private.is_staff_member()));

create policy recipient_monetisation_overrides_self_or_staff_select
  on recipient_monetisation_overrides for select to authenticated
  using (
    user_id = (select private.current_app_user_id())
    or (select private.is_staff_member())
  );

alter table verification_sessions
  drop constraint verification_sessions_subject_type_check,
  drop constraint verification_sessions_purpose_check;

alter table verification_records
  drop constraint verification_records_subject_type_check,
  drop constraint verification_records_purpose_check;

alter table verification_sessions
  add constraint verification_sessions_subject_type_check check (subject_type in (
    'user', 'organization', 'organization_person', 'performer'
  )),
  add constraint verification_sessions_purpose_check check (purpose in (
    'age_access',
    'adult_publisher_eligibility',
    'performer_eligibility',
    'creator_kyc',
    'payout_kyc',
    'org_kyb',
    'ubo_kyc',
    'enterprise_review'
  ));

drop policy verification_sessions_select_self_org_or_staff on verification_sessions;
drop policy verification_records_select_self_org_or_staff on verification_records;

create policy verification_sessions_select_self_org_performer_or_staff
  on verification_sessions for select to authenticated
  using (
    (subject_type = 'user' and subject_id = (select private.current_app_user_id()))
    or (subject_type = 'organization' and exists (
      select 1 from organization_memberships om
      where om.organization_id = verification_sessions.subject_id
        and om.user_id = (select private.current_app_user_id())
        and om.state in ('active', 'invited')
    ))
    or (subject_type = 'performer' and exists (
      select 1 from performer_subjects ps
      where ps.id = verification_sessions.subject_id
        and ps.linked_user_id = (select private.current_app_user_id())
    ))
    or (select private.is_staff_member())
  );

create policy verification_records_select_self_org_performer_or_staff
  on verification_records for select to authenticated
  using (
    (subject_type = 'user' and subject_id = (select private.current_app_user_id()))
    or (subject_type = 'organization' and exists (
      select 1 from organization_memberships om
      where om.organization_id = verification_records.subject_id
        and om.user_id = (select private.current_app_user_id())
        and om.state in ('active', 'invited')
    ))
    or (subject_type = 'performer' and exists (
      select 1 from performer_subjects ps
      where ps.id = verification_records.subject_id
        and ps.linked_user_id = (select private.current_app_user_id())
    ))
    or (select private.is_staff_member())
  );

alter table verification_records
  add constraint verification_records_subject_type_check check (subject_type in (
    'user', 'organization', 'organization_person', 'performer'
  )),
  add constraint verification_records_purpose_check check (purpose in (
    'age_access',
    'adult_publisher_eligibility',
    'performer_eligibility',
    'creator_kyc',
    'payout_kyc',
    'org_kyb',
    'ubo_kyc',
    'enterprise_review'
  ));

alter table content_safety_declarations
  add column content_revision bigint not null default 1 check (content_revision > 0);

alter table performer_subjects
  add column subject_kind text not null default 'wevid_user' check (subject_kind in ('wevid_user', 'external_invitee')),
  add column display_label text,
  add column source_verification_record_id uuid references verification_records(id),
  add constraint performer_subjects_kind_link_check check (
    (subject_kind = 'wevid_user' and linked_user_id is not null)
    or (subject_kind = 'external_invitee' and linked_user_id is null)
  );

create index performer_subjects_source_verification_idx
  on performer_subjects (source_verification_record_id)
  where source_verification_record_id is not null;

alter table performer_consents
  add column content_revision bigint not null default 1 check (content_revision > 0);

create table performer_consent_requests (
  id uuid primary key default gen_random_uuid(),
  content_item_id uuid not null references content_items(id) on delete cascade,
  performer_subject_id uuid not null references performer_subjects(id) on delete cascade,
  requested_by_user_id uuid not null references users(id),
  idempotency_key text not null,
  state text not null default 'pending' check (state in (
    'pending', 'verification_required', 'accepted', 'rejected', 'expired', 'revoked', 'superseded'
  )),
  allowed_uses text[] not null,
  policy_version text not null,
  release_version text not null,
  content_revision bigint not null check (content_revision > 0),
  invitation_token_hash text,
  invitation_expires_at timestamptz,
  responded_at timestamptz,
  response_ip_hash text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (content_item_id, performer_subject_id, content_revision),
  unique (requested_by_user_id, idempotency_key),
  check (cardinality(allowed_uses) > 0),
  check (allowed_uses <@ array[
    'capture', 'upload', 'distribution', 'monetisation', 'live', 'replay', 'promotion'
  ]::text[]),
  check (
    invitation_token_hash is null
    or invitation_expires_at is not null
  )
);

create unique index performer_consent_requests_token_uidx
  on performer_consent_requests (invitation_token_hash)
  where invitation_token_hash is not null;

create index performer_consent_requests_linked_user_idx
  on performer_consent_requests (performer_subject_id, state, created_at desc);

create index performer_consent_requests_content_idx
  on performer_consent_requests (content_item_id, content_revision, state);

create index performer_consent_requests_requested_by_idx
  on performer_consent_requests (requested_by_user_id, created_at desc);

alter table performer_consent_requests enable row level security;

grant select on table performer_consent_requests to authenticated;

create policy performer_consent_requests_select_party_or_staff
  on performer_consent_requests for select to authenticated
  using (
    requested_by_user_id = (select private.current_app_user_id())
    or exists (
      select 1
      from performer_subjects ps
      where ps.id = performer_consent_requests.performer_subject_id
        and ps.linked_user_id = (select private.current_app_user_id())
    )
    or (select private.is_staff_member())
  );

create or replace function private.sync_performer_verification_record()
returns trigger
language plpgsql
security invoker
set search_path = public, private
as $$
begin
  if new.subject_type = 'performer' and new.purpose = 'performer_eligibility' then
    update performer_subjects
    set
      verification_status = new.status,
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

create trigger verification_records_sync_performer
after insert or update of status, expires_at on verification_records
for each row execute function private.sync_performer_verification_record();

create or replace function private.bump_content_performer_revision()
returns trigger
language plpgsql
security invoker
set search_path = public, private
as $$
declare
  v_content_item_id uuid;
begin
  if tg_table_name = 'content_items' then
    v_content_item_id := coalesce(new.id, old.id);
  else
    v_content_item_id := coalesce(new.content_item_id, old.content_item_id);
  end if;

  update content_safety_declarations
  set content_revision = content_revision + 1, updated_at = now()
  where content_item_id = v_content_item_id
    and representation_mode = 'declared_performers';

  if found then
    update performer_consent_requests
    set state = 'superseded', updated_at = now()
    where content_item_id = v_content_item_id
      and state in ('pending', 'verification_required', 'accepted');

    update performer_consents
    set state = 'revoked', updated_at = now()
    where content_item_id = v_content_item_id
      and state = 'active';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create trigger media_assets_bump_performer_revision
after insert or delete on media_assets
for each row execute function private.bump_content_performer_revision();

create trigger content_items_bump_performer_revision
after update of caption, media_type, nsfw_label on content_items
for each row
when (
  old.caption is distinct from new.caption
  or old.media_type is distinct from new.media_type
  or old.nsfw_label is distinct from new.nsfw_label
)
execute function private.bump_content_performer_revision();

create trigger content_safety_declarations_bump_performer_revision
after update of representation_mode on content_safety_declarations
for each row
when (old.representation_mode is distinct from new.representation_mode)
execute function private.bump_content_performer_revision();

create table organization_settlement_wallets (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  linked_by_user_id uuid not null references users(id),
  chain wallet_chain not null,
  address text not null,
  state text not null default 'pending_verification' check (state in (
    'pending_verification', 'active', 'revoked'
  )),
  ownership_verified_at timestamptz,
  is_primary boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, chain, address),
  check (state <> 'active' or ownership_verified_at is not null)
);

create unique index organization_settlement_wallets_primary_idx
  on organization_settlement_wallets (organization_id, chain)
  where state = 'active' and is_primary is true;

create index organization_settlement_wallets_linked_by_idx
  on organization_settlement_wallets (linked_by_user_id);

create table managed_creator_relationships (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  creator_user_id uuid not null references users(id) on delete cascade,
  invited_by_user_id uuid not null references users(id),
  idempotency_key text not null,
  state text not null default 'invited' check (state in (
    'invited', 'active', 'declined', 'suspended', 'terminated', 'expired'
  )),
  invitation_token_hash text,
  invitation_expires_at timestamptz,
  invited_at timestamptz not null default now(),
  accepted_at timestamptz,
  ended_at timestamptz,
  end_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, creator_user_id),
  unique (organization_id, idempotency_key),
  check (state <> 'active' or accepted_at is not null),
  check (ended_at is null or ended_at >= invited_at)
);

create unique index managed_creator_relationships_token_uidx
  on managed_creator_relationships (invitation_token_hash)
  where invitation_token_hash is not null;

create index managed_creator_relationships_creator_state_idx
  on managed_creator_relationships (creator_user_id, state, updated_at desc);

create unique index managed_creator_relationships_one_active_creator_idx
  on managed_creator_relationships (creator_user_id)
  where state = 'active';

create index managed_creator_relationships_invited_by_idx
  on managed_creator_relationships (invited_by_user_id);

create table managed_creator_agreements (
  id uuid primary key default gen_random_uuid(),
  relationship_id uuid not null references managed_creator_relationships(id) on delete cascade,
  version_number integer not null check (version_number > 0),
  state text not null default 'proposed' check (state in (
    'proposed', 'accepted', 'rejected', 'superseded', 'terminated'
  )),
  permissions text[] not null,
  commercial_agreement_version text not null,
  terms_hash text not null,
  creator_share_bps integer not null,
  enterprise_management_share_bps integer not null,
  proposed_by_user_id uuid not null references users(id),
  idempotency_key text not null,
  accepted_by_user_id uuid references users(id),
  proposed_at timestamptz not null default now(),
  accepted_at timestamptz,
  effective_at timestamptz,
  ends_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (relationship_id, version_number),
  unique (relationship_id, idempotency_key),
  check (cardinality(permissions) > 0),
  check (permissions <@ array[
    'profile_readiness_view',
    'monetisation_settings_manage',
    'content_manage',
    'analytics_view',
    'revenue_allocation'
  ]::text[]),
  check (creator_share_bps between 1 and 10000),
  check (enterprise_management_share_bps between 0 and 9999),
  check (creator_share_bps + enterprise_management_share_bps = 10000),
  check (
    state <> 'accepted'
    or (
      accepted_by_user_id is not null
      and accepted_at is not null
      and effective_at is not null
    )
  ),
  check (ends_at is null or effective_at is null or ends_at > effective_at)
);

create unique index managed_creator_agreements_active_idx
  on managed_creator_agreements (relationship_id)
  where state = 'accepted';

create index managed_creator_agreements_proposed_by_idx
  on managed_creator_agreements (proposed_by_user_id);

create index managed_creator_agreements_accepted_by_idx
  on managed_creator_agreements (accepted_by_user_id)
  where accepted_by_user_id is not null;

create table managed_creator_allocation_records (
  id uuid primary key default gen_random_uuid(),
  payment_intent_id uuid not null references payment_intents(id),
  relationship_id uuid not null references managed_creator_relationships(id),
  agreement_id uuid not null references managed_creator_agreements(id),
  organization_id uuid not null references organizations(id),
  creator_user_id uuid not null references users(id),
  creator_side_proceeds_minor bigint not null check (creator_side_proceeds_minor > 0),
  creator_net_minor bigint not null check (creator_net_minor > 0),
  enterprise_management_minor bigint not null check (enterprise_management_minor > 0),
  currency text not null check (currency in ('SOL', 'USDC')),
  state text not null default 'pending' check (state in ('pending', 'confirmed', 'failed', 'reversed')),
  confirmed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (payment_intent_id),
  check (creator_side_proceeds_minor = creator_net_minor + enterprise_management_minor)
);

alter table organization_settlement_wallets enable row level security;
alter table managed_creator_relationships enable row level security;
alter table managed_creator_agreements enable row level security;
alter table managed_creator_allocation_records enable row level security;

grant select on table organization_settlement_wallets to authenticated;
grant select on table managed_creator_relationships to authenticated;
grant select on table managed_creator_agreements to authenticated;
grant select on table managed_creator_allocation_records to authenticated;

create policy organization_settlement_wallets_member_or_staff_select
  on organization_settlement_wallets for select to authenticated
  using (
    exists (
      select 1 from organization_memberships om
      where om.organization_id = organization_settlement_wallets.organization_id
        and om.user_id = (select private.current_app_user_id())
        and om.state = 'active'
    )
    or (select private.is_staff_member())
  );

create policy managed_creator_relationships_party_or_staff_select
  on managed_creator_relationships for select to authenticated
  using (
    creator_user_id = (select private.current_app_user_id())
    or exists (
      select 1 from organization_memberships om
      where om.organization_id = managed_creator_relationships.organization_id
        and om.user_id = (select private.current_app_user_id())
        and om.state = 'active'
    )
    or (select private.is_staff_member())
  );

create policy managed_creator_agreements_party_or_staff_select
  on managed_creator_agreements for select to authenticated
  using (
    exists (
      select 1
      from managed_creator_relationships mcr
      where mcr.id = managed_creator_agreements.relationship_id
        and (
          mcr.creator_user_id = (select private.current_app_user_id())
          or exists (
            select 1 from organization_memberships om
            where om.organization_id = mcr.organization_id
              and om.user_id = (select private.current_app_user_id())
              and om.state = 'active'
          )
        )
    )
    or (select private.is_staff_member())
  );

create policy managed_creator_allocation_records_party_or_staff_select
  on managed_creator_allocation_records for select to authenticated
  using (
    creator_user_id = (select private.current_app_user_id())
    or exists (
      select 1 from organization_memberships om
      where om.organization_id = managed_creator_allocation_records.organization_id
        and om.user_id = (select private.current_app_user_id())
        and om.state = 'active'
    )
    or (select private.is_staff_member())
  );

alter table organization_memberships
  drop constraint organization_memberships_role_check,
  add constraint organization_memberships_role_check check (role in (
    'owner', 'admin', 'manager', 'finance', 'compliance', 'member', 'viewer'
  ));

alter table payment_intents
  rename column allocation_wallet to referral_wallet;

alter table payment_intents
  rename column allocation_amount_minor to referral_amount_minor;

alter table payment_intents
  drop constraint payment_intents_split_amounts_nonnegative_check,
  drop constraint payment_intents_split_total_check,
  drop constraint payment_intents_javascript_safe_atomic_amounts_check,
  add column creator_side_proceeds_minor bigint,
  add column platform_fee_gross_minor bigint,
  add column enterprise_wallet text,
  add column enterprise_management_amount_minor bigint not null default 0,
  add column managed_creator_relationship_id uuid references managed_creator_relationships(id),
  add column managed_creator_agreement_id uuid references managed_creator_agreements(id),
  add column enterprise_organization_id uuid references organizations(id);

update payment_intents
set
  creator_side_proceeds_minor = creator_amount_minor,
  platform_fee_gross_minor = platform_fee_amount_minor + referral_amount_minor;

alter table payment_intents
  alter column creator_side_proceeds_minor set not null,
  alter column platform_fee_gross_minor set not null,
  add constraint payment_intents_split_amounts_nonnegative_check check (
    total_amount_minor > 0
    and creator_side_proceeds_minor > 0
    and creator_amount_minor > 0
    and enterprise_management_amount_minor >= 0
    and platform_fee_gross_minor >= 0
    and platform_fee_amount_minor >= 0
    and referral_amount_minor >= 0
  ),
  add constraint payment_intents_split_total_check check (
    total_amount_minor = creator_amount_minor
      + enterprise_management_amount_minor
      + platform_fee_amount_minor
      + referral_amount_minor
    and creator_side_proceeds_minor = creator_amount_minor + enterprise_management_amount_minor
    and platform_fee_gross_minor = platform_fee_amount_minor + referral_amount_minor
  ),
  add constraint payment_intents_enterprise_allocation_check check (
    (enterprise_management_amount_minor = 0
      and enterprise_wallet is null
      and managed_creator_relationship_id is null
      and managed_creator_agreement_id is null
      and enterprise_organization_id is null)
    or
    (enterprise_management_amount_minor > 0
      and enterprise_wallet is not null
      and managed_creator_relationship_id is not null
      and managed_creator_agreement_id is not null
      and enterprise_organization_id is not null)
  ),
  add constraint payment_intents_javascript_safe_atomic_amounts_check check (
    amount_minor between 1 and 9007199254740991
    and total_amount_minor between 1 and 9007199254740991
    and creator_side_proceeds_minor between 1 and 9007199254740991
    and creator_amount_minor between 1 and 9007199254740991
    and enterprise_management_amount_minor between 0 and 9007199254740991
    and platform_fee_gross_minor between 0 and 9007199254740991
    and platform_fee_amount_minor between 0 and 9007199254740991
    and referral_amount_minor between 0 and 9007199254740991
  );

create index payment_intents_managed_agreement_idx
  on payment_intents (managed_creator_agreement_id)
  where managed_creator_agreement_id is not null;

create index payment_intents_managed_relationship_idx
  on payment_intents (managed_creator_relationship_id)
  where managed_creator_relationship_id is not null;

create index payment_intents_enterprise_organization_idx
  on payment_intents (enterprise_organization_id)
  where enterprise_organization_id is not null;

create index managed_creator_allocation_records_agreement_idx
  on managed_creator_allocation_records (agreement_id, created_at desc);

create index managed_creator_allocation_records_org_idx
  on managed_creator_allocation_records (organization_id, created_at desc);

create index managed_creator_allocation_records_relationship_idx
  on managed_creator_allocation_records (relationship_id, created_at desc);

create index managed_creator_allocation_records_creator_idx
  on managed_creator_allocation_records (creator_user_id, created_at desc);

drop function private.assert_recipient_monetisation_ready(uuid, text, wallet_chain, uuid);

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

create function private.resolve_managed_creator_allocation(
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
  select mcr.* into v_relationship
  from managed_creator_relationships mcr
  where mcr.creator_user_id = p_creator_user_id
    and mcr.state = 'active'
  order by mcr.accepted_at desc
  limit 1;

  if not found then
    return;
  end if;

  if not exists (
    select 1
    from organizations o
    where o.id = v_relationship.organization_id
      and o.state = 'active'
      and o.kyb_state = 'verified'
  ) then
    raise exception using errcode = 'P0001', message = 'managed_creator_organization_not_ready';
  end if;

  if not exists (
    select 1
    from tier_waivers tw
    where tw.subject_type = 'organization'
      and tw.subject_id = v_relationship.organization_id
      and tw.tier_key = 'enterprise'
      and tw.state = 'active'
      and tw.starts_at <= now()
      and (tw.ends_at is null or tw.ends_at > now())
  ) then
    raise exception using errcode = 'P0001', message = 'managed_creator_enterprise_entitlement_required';
  end if;

  select mca.* into v_agreement
  from managed_creator_agreements mca
  where mca.relationship_id = v_relationship.id
    and mca.state = 'accepted'
    and mca.effective_at <= now()
    and (mca.ends_at is null or mca.ends_at > now())
  order by mca.version_number desc
  limit 1;

  if not found then
    raise exception using errcode = 'P0001', message = 'managed_creator_agreement_not_ready';
  end if;

  if not (v_agreement.permissions @> array['revenue_allocation']::text[]) then
    return;
  end if;

  select osw.* into v_wallet
  from organization_settlement_wallets osw
  where osw.organization_id = v_relationship.organization_id
    and osw.chain = p_wallet_chain
    and osw.state = 'active'
    and osw.is_primary is true
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
      from verification_records vr
      where vr.subject_type = 'user'
        and vr.subject_id = ci.creator_user_id
        and vr.purpose = 'adult_publisher_eligibility'
        and vr.status = 'valid'
        and vr.result_over_threshold is true
        and vr.assurance_level in ('high', 'documentary')
        and vr.policy_version is not null
        and vr.terms_accepted_at is not null
        and (vr.expires_at is null or vr.expires_at > now())
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
          and ps.verification_status = 'valid'
          and ps.result_over_18 is true
          and ps.dispute_state = 'none'
          and (ps.expires_at is null or ps.expires_at > now())
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
        where pcr.content_item_id = ci.id
          and pcr.content_revision = csd.content_revision
          and (
            pcr.state <> 'accepted'
            or pcr.allowed_uses is distinct from pc.allowed_uses
            or pc.id is null
            or (pc.expires_at is not null and pc.expires_at <= now())
            or ps.verification_status <> 'valid'
            or ps.result_over_18 is distinct from true
            or ps.dispute_state <> 'none'
            or (ps.expires_at is not null and ps.expires_at <= now())
          )
      )
    else false
  end
  from content_items ci
  left join content_safety_declarations csd on csd.content_item_id = ci.id
  where ci.id = p_content_item_id;
$$;

revoke all on function private.content_performer_readiness(uuid) from public, anon, authenticated;

comment on table recipient_monetisation_policies is
  'Canonical earning-policy configuration. It does not grant adult publishing or Enterprise management.';
comment on table performer_consent_requests is
  'Content-revision-bound performer invitation and response state. Verification and consent remain separate.';
comment on table managed_creator_relationships is
  'Accepted Enterprise management relationship for a universal user; never a separate creator account.';
comment on table managed_creator_agreements is
  'Versioned commercial terms requiring creator acceptance before future settlement allocation.';
