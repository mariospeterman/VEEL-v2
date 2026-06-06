drop policy if exists feature_flags_staff_select on feature_flags;
drop policy if exists data_requests_select_self_or_staff on data_requests;

revoke select on table data_requests, feature_flags from authenticated;

drop index if exists feature_flags_category_state_idx;
drop index if exists data_requests_state_created_idx;
drop index if exists data_requests_requester_created_idx;

drop table if exists feature_flags;
drop table if exists data_requests;
