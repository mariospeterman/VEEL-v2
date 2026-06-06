-- Support case foreign-key indexes reported by the Supabase performance advisor.

create index support_cases_requester_user_idx
  on support_cases (requester_user_id)
  where requester_user_id is not null;

create index support_cases_assigned_staff_user_idx
  on support_cases (assigned_staff_user_id)
  where assigned_staff_user_id is not null;
