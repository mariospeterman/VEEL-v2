-- Refund and managed-creator finance records are served only by Fastify routes
-- that enforce the canonical permission registry. Historical authenticated
-- grants plus self/member/party-or-any-staff policies allow a low-privilege
-- staff role to bypass those route permissions through the Data API.

revoke all privileges on table
  refunds_and_disputes,
  refund_remediation_evidence,
  organization_settlement_wallets,
  managed_creator_relationships,
  managed_creator_agreements,
  managed_creator_allocation_records
from public, anon, authenticated;

drop policy if exists refunds_and_disputes_select_self_or_staff on refunds_and_disputes;
drop policy if exists refund_remediation_evidence_select_self_or_staff on refund_remediation_evidence;
drop policy if exists organization_settlement_wallets_member_or_staff_select on organization_settlement_wallets;
drop policy if exists managed_creator_relationships_party_or_staff_select on managed_creator_relationships;
drop policy if exists managed_creator_agreements_party_or_staff_select on managed_creator_agreements;
drop policy if exists managed_creator_allocation_records_party_or_staff_select on managed_creator_allocation_records;
