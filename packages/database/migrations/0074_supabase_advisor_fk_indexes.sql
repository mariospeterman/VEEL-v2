-- Cover foreign keys reported by the Supabase performance advisor.

create index mcp_connections_revoked_by_user_idx
  on mcp_connections (revoked_by_user_id);

create index oauth_access_tokens_code_idx
  on oauth_access_tokens (code_id);

create index oauth_authorization_codes_actor_idx
  on oauth_authorization_codes (actor_user_id);

create index oauth_authorization_codes_request_idx
  on oauth_authorization_codes (authorization_request_id);

create index oauth_authorization_requests_approved_by_idx
  on oauth_authorization_requests (approved_by_user_id);

create index oauth_authorization_requests_denied_by_idx
  on oauth_authorization_requests (denied_by_user_id);

create index payment_confirmation_deliveries_receipt_idx
  on payment_confirmation_deliveries (receipt_id);

create index refund_remediation_evidence_recorded_by_idx
  on refund_remediation_evidence (recorded_by_user_id);

create index verification_records_derived_from_idx
  on verification_records (derived_from_record_id);

create index verification_sessions_source_session_idx
  on verification_sessions (source_session_id);

create index wallet_auth_sessions_wallet_idx
  on wallet_auth_sessions (wallet_id);
