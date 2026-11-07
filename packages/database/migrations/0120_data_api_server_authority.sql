-- Sensitive identity, finance, compliance, safety, and canonical content reads
-- are served only by the Fastify authorization layer.  RLS policies do not
-- replace table privileges, and historical Data API grants remain effective
-- after Supabase's new-table exposure default changed.

revoke all privileges on table
  identity_verifications,
  tax_profiles,
  tax_profile_versions,
  seller_of_record_determinations,
  jurisdiction_tax_rules,
  product_tax_matrix,
  buyer_location_evidence,
  vat_determinations,
  receipts,
  receipt_lines,
  platform_fee_statements,
  vat_invoices,
  vat_invoice_lines,
  tax_adjustments,
  compliance_ledger_entries,
  dac7_reports,
  dac7_report_lines,
  carf_reports,
  carf_report_lines,
  compliance_review_queue,
  compliance_exports,
  referral_programs,
  partner_campaigns,
  partner_contracts,
  referral_abuse_flags,
  tier_waivers,
  organizations,
  user_social_counts,
  content_engagement_counters,
  comments,
  content_items,
  media_assets,
  content_access_rules,
  content_hashtags,
  media_safety_cases,
  comment_reactions,
  comment_mentions
from public, anon, authenticated;

-- Keep later tables private unless a reviewed migration deliberately exposes
-- a narrow projection.  This affects objects subsequently created by the
-- migration role; it does not alter backend connection privileges.
alter default privileges in schema public
  revoke all privileges on tables from public, anon, authenticated;

-- Shared policy helpers remain callable only by the authenticated role that
-- owns the surviving messaging/notification/realtime RLS paths.  Default
-- function EXECUTE for PUBLIC must not leak these security-definer helpers.
revoke execute on function private.current_app_user_id() from public, anon;
revoke execute on function private.is_staff_member() from public, anon;
revoke execute on function private.has_protected_app_access() from public, anon;
revoke execute on function private.is_current_conversation_member(uuid) from public, anon;
revoke execute on function private.realtime_topic_can_receive(text, text) from public, anon;
revoke execute on function private.realtime_topic_can_send(text, text) from public, anon;

grant execute on function private.current_app_user_id() to authenticated;
grant execute on function private.is_staff_member() to authenticated;
grant execute on function private.has_protected_app_access() to authenticated;
grant execute on function private.is_current_conversation_member(uuid) to authenticated;
grant execute on function private.realtime_topic_can_receive(text, text) to authenticated;
grant execute on function private.realtime_topic_can_send(text, text) to authenticated;

drop policy if exists identity_verifications_staff_select on identity_verifications;
drop policy if exists tax_profiles_staff_select on tax_profiles;
drop policy if exists tax_profile_versions_staff_select on tax_profile_versions;
drop policy if exists seller_of_record_determinations_staff_select on seller_of_record_determinations;
drop policy if exists jurisdiction_tax_rules_staff_select on jurisdiction_tax_rules;
drop policy if exists product_tax_matrix_staff_select on product_tax_matrix;
drop policy if exists buyer_location_evidence_staff_select on buyer_location_evidence;
drop policy if exists vat_determinations_staff_select on vat_determinations;
drop policy if exists receipts_staff_select on receipts;
drop policy if exists receipt_lines_staff_select on receipt_lines;
drop policy if exists platform_fee_statements_staff_select on platform_fee_statements;
drop policy if exists vat_invoices_staff_select on vat_invoices;
drop policy if exists vat_invoice_lines_staff_select on vat_invoice_lines;
drop policy if exists tax_adjustments_staff_select on tax_adjustments;
drop policy if exists compliance_ledger_entries_staff_select on compliance_ledger_entries;
drop policy if exists dac7_reports_staff_select on dac7_reports;
drop policy if exists dac7_report_lines_staff_select on dac7_report_lines;
drop policy if exists carf_reports_staff_select on carf_reports;
drop policy if exists carf_report_lines_staff_select on carf_report_lines;
drop policy if exists compliance_review_queue_staff_select on compliance_review_queue;
drop policy if exists compliance_exports_staff_select on compliance_exports;
drop policy if exists referral_programs_staff_select on referral_programs;
drop policy if exists partner_campaigns_staff_select on partner_campaigns;
drop policy if exists partner_contracts_staff_select on partner_contracts;
drop policy if exists referral_abuse_flags_staff_select on referral_abuse_flags;
drop policy if exists tier_waivers_staff_select on tier_waivers;
drop policy if exists organizations_staff_select on organizations;
drop policy if exists organizations_select_member_or_staff on organizations;
drop policy if exists user_social_counts_select_authenticated on user_social_counts;
drop policy if exists content_engagement_counters_select_authenticated on content_engagement_counters;
drop policy if exists comments_select_visible_author_creator_or_staff on comments;
drop policy if exists content_items_select_visible_creator_or_staff on content_items;
drop policy if exists media_assets_select_visible_creator_or_staff on media_assets;
drop policy if exists content_access_rules_select_visible_creator_or_staff on content_access_rules;
drop policy if exists content_hashtags_select_visible_content_or_staff on content_hashtags;
drop policy if exists media_safety_cases_select_creator_or_staff on media_safety_cases;
drop policy if exists comment_reactions_select_self_author_creator_or_staff on comment_reactions;
drop policy if exists comment_mentions_select_participant_or_staff on comment_mentions;
