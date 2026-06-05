-- Cover DAC7/DAC8/VAT compliance foreign keys reported by Supabase performance advisors.

create index buyer_location_evidence_buyer_user_id_idx
  on buyer_location_evidence (buyer_user_id)
  where buyer_user_id is not null;

create index carf_report_lines_tax_profile_version_id_idx
  on carf_report_lines (tax_profile_version_id)
  where tax_profile_version_id is not null;

create index carf_report_lines_user_id_idx
  on carf_report_lines (user_id)
  where user_id is not null;

create index compliance_exports_created_by_user_id_idx
  on compliance_exports (created_by_user_id)
  where created_by_user_id is not null;

create index compliance_ledger_entries_buyer_tax_profile_version_id_idx
  on compliance_ledger_entries (buyer_tax_profile_version_id)
  where buyer_tax_profile_version_id is not null;

create index compliance_ledger_entries_receipt_id_idx
  on compliance_ledger_entries (receipt_id)
  where receipt_id is not null;

create index compliance_ledger_entries_seller_tax_profile_version_id_idx
  on compliance_ledger_entries (seller_tax_profile_version_id)
  where seller_tax_profile_version_id is not null;

create index compliance_ledger_entries_vat_invoice_id_idx
  on compliance_ledger_entries (vat_invoice_id)
  where vat_invoice_id is not null;

create index compliance_review_queue_assigned_staff_user_id_idx
  on compliance_review_queue (assigned_staff_user_id)
  where assigned_staff_user_id is not null;

create index dac7_report_lines_seller_user_id_idx
  on dac7_report_lines (seller_user_id)
  where seller_user_id is not null;

create index dac7_report_lines_tax_profile_version_id_idx
  on dac7_report_lines (tax_profile_version_id)
  where tax_profile_version_id is not null;

create index partner_campaigns_contract_id_idx
  on partner_campaigns (contract_id)
  where contract_id is not null;

create index platform_fee_statements_creator_user_id_idx
  on platform_fee_statements (creator_user_id)
  where creator_user_id is not null;

create index platform_fee_statements_payment_intent_id_idx
  on platform_fee_statements (payment_intent_id)
  where payment_intent_id is not null;

create index receipt_lines_receipt_id_idx
  on receipt_lines (receipt_id);

create index receipts_buyer_user_id_idx
  on receipts (buyer_user_id)
  where buyer_user_id is not null;

create index receipts_seller_user_id_idx
  on receipts (seller_user_id)
  where seller_user_id is not null;

create index referral_abuse_flags_referral_token_id_idx
  on referral_abuse_flags (referral_token_id)
  where referral_token_id is not null;

create index referral_abuse_flags_user_id_idx
  on referral_abuse_flags (user_id)
  where user_id is not null;

create index seller_of_record_determinations_buyer_user_id_idx
  on seller_of_record_determinations (buyer_user_id)
  where buyer_user_id is not null;

create index seller_of_record_determinations_seller_user_id_idx
  on seller_of_record_determinations (seller_user_id)
  where seller_user_id is not null;

create index tax_adjustments_created_by_user_id_idx
  on tax_adjustments (created_by_user_id)
  where created_by_user_id is not null;

create index tax_adjustments_payment_intent_id_idx
  on tax_adjustments (payment_intent_id)
  where payment_intent_id is not null;

create index tax_adjustments_vat_determination_id_idx
  on tax_adjustments (vat_determination_id)
  where vat_determination_id is not null;

create index tax_profile_versions_collected_by_user_id_idx
  on tax_profile_versions (collected_by_user_id)
  where collected_by_user_id is not null;

create index tax_profiles_current_version_id_idx
  on tax_profiles (current_version_id)
  where current_version_id is not null;

create index vat_invoice_lines_vat_invoice_id_idx
  on vat_invoice_lines (vat_invoice_id);

create index vat_invoices_buyer_user_id_idx
  on vat_invoices (buyer_user_id)
  where buyer_user_id is not null;

create index vat_invoices_seller_user_id_idx
  on vat_invoices (seller_user_id)
  where seller_user_id is not null;
