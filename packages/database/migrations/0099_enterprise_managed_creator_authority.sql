-- Launch 09: durable Enterprise action idempotency and normalized KYB authority.

create table enterprise_action_receipts (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid not null references users(id),
  organization_id uuid references organizations(id) on delete cascade,
  relationship_id uuid references managed_creator_relationships(id) on delete cascade,
  membership_id uuid references organization_memberships(id) on delete cascade,
  action text not null check (action in (
    'managed_creator_invite',
    'managed_creator_response',
    'managed_creator_agreement_propose',
    'managed_creator_agreement_response',
    'managed_creator_termination',
    'organization_provision',
    'organization_member_invite',
    'organization_member_response',
    'organization_member_update',
    'organization_settlement_wallet_update'
  )),
  idempotency_key text not null check (char_length(idempotency_key) between 1 and 128),
  request_hash text not null check (request_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  unique (actor_user_id, action, idempotency_key),
  check (num_nonnulls(relationship_id, membership_id) <= 1)
);

create index enterprise_action_receipts_organization_idx
  on enterprise_action_receipts (organization_id, created_at desc)
  where organization_id is not null;

create index enterprise_action_receipts_relationship_idx
  on enterprise_action_receipts (relationship_id, created_at desc)
  where relationship_id is not null;

create index enterprise_action_receipts_membership_idx
  on enterprise_action_receipts (membership_id, created_at desc)
  where membership_id is not null;

alter table enterprise_action_receipts enable row level security;

revoke all on table enterprise_action_receipts from public, anon, authenticated;

comment on table enterprise_action_receipts is
  'Server-only replay and request-conflict authority for Enterprise relationship, team, and settlement-wallet mutations.';

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
    from verification_records verification
    where verification.subject_type = 'organization'
      and verification.subject_id = v_relationship.organization_id
      and verification.purpose = 'org_kyb'
      and verification.status = 'valid'
      and (verification.expires_at is null or verification.expires_at > now())
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

comment on function private.resolve_managed_creator_allocation(uuid, wallet_chain) is
  'Resolves a creator-approved Enterprise allocation only when normalized KYB, entitlement, agreement, permission, and ownership-proven wallet authority are current.';
