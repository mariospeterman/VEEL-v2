-- Reverse canonical Event Access Pass and Mutuals table names.

drop policy if exists event_access_pass_types_select_public_owner_holder_or_staff on event_access_pass_types;
drop policy if exists event_access_purchase_requests_select_self_creator_or_staff on event_access_purchase_requests;
drop policy if exists event_access_passes_select_self_creator_or_staff on event_access_passes;
drop policy if exists event_access_requests_select_self_creator_or_staff on event_access_requests;
drop policy if exists mutual_profiles_select_self_or_staff on mutual_profiles;
drop policy if exists mutual_interests_select_self_or_staff on mutual_interests;
drop policy if exists mutuals_select_member_or_staff on mutuals;

alter table event_access_purchase_requests rename column access_pass_type_id to ticket_type_id;
alter table event_access_passes rename column access_pass_type_id to ticket_type_id;
alter table event_access_requests rename column access_pass_type_id to ticket_type_id;

alter table if exists event_access_pass_types rename to ticket_types;
alter table if exists event_access_purchase_requests rename to ticket_purchase_requests;
alter table if exists event_access_passes rename to ticket_entitlements;
alter table if exists event_access_requests rename to ticket_requests;

alter table if exists mutual_profiles rename to dating_profiles;
alter table if exists mutual_interests rename to dating_swipes;
alter table if exists mutuals rename to dating_matches;

alter index if exists event_access_pass_types_event_state_idx rename to ticket_types_event_state_idx;
alter index if exists event_access_purchase_requests_buyer_idx rename to ticket_purchase_requests_buyer_idx;
alter index if exists event_access_purchase_requests_event_id_idx rename to ticket_purchase_requests_event_id_idx;
alter index if exists event_access_purchase_requests_access_pass_type_id_idx rename to ticket_purchase_requests_ticket_type_id_idx;
alter index if exists event_access_passes_holder_idx rename to ticket_entitlements_holder_idx;
alter index if exists event_access_passes_event_idx rename to ticket_entitlements_event_idx;
alter index if exists event_access_passes_access_pass_type_id_idx rename to ticket_entitlements_ticket_type_id_idx;
alter index if exists event_access_requests_requester_idx rename to ticket_requests_requester_idx;
alter index if exists event_access_requests_access_pass_type_id_idx rename to ticket_requests_ticket_type_id_idx;
alter index if exists event_access_requests_reviewed_by_user_id_idx rename to ticket_requests_reviewed_by_user_id_idx;

alter index if exists mutual_interests_content_unique rename to dating_swipes_content_unique;
alter index if exists mutual_interests_profile_unique rename to dating_swipes_profile_unique;
alter index if exists mutual_interests_target_action_idx rename to dating_swipes_target_action_idx;
alter index if exists mutual_interests_content_item_id_idx rename to dating_swipes_content_item_id_idx;
alter index if exists mutuals_pair_unique rename to dating_matches_pair_unique;
alter index if exists mutuals_user_a_state_idx rename to dating_matches_user_a_state_idx;
alter index if exists mutuals_user_b_state_idx rename to dating_matches_user_b_state_idx;
alter index if exists mutuals_source_content_idx rename to dating_matches_source_content_idx;
alter index if exists mutuals_archived_by_user_id_idx rename to dating_matches_archived_by_user_id_idx;

alter table ticket_types enable row level security;
alter table ticket_purchase_requests enable row level security;
alter table ticket_entitlements enable row level security;
alter table ticket_requests enable row level security;
alter table dating_profiles enable row level security;
alter table dating_swipes enable row level security;
alter table dating_matches enable row level security;

create policy ticket_types_select_public_owner_holder_or_staff
  on ticket_types for select to authenticated
  using (
    exists (
      select 1
      from events e
      where e.id = ticket_types.event_id
        and (
          e.state = 'published'
          or e.creator_user_id = private.current_app_user_id()
          or private.is_staff_member()
        )
    )
  );

create policy ticket_purchase_requests_select_self_creator_or_staff
  on ticket_purchase_requests for select to authenticated
  using (
    buyer_user_id = private.current_app_user_id()
    or private.is_staff_member()
    or exists (
      select 1
      from events e
      where e.id = ticket_purchase_requests.event_id
        and e.creator_user_id = private.current_app_user_id()
    )
  );

create policy ticket_entitlements_select_self_creator_or_staff
  on ticket_entitlements for select to authenticated
  using (
    holder_user_id = private.current_app_user_id()
    or private.is_staff_member()
    or exists (
      select 1
      from events e
      where e.id = ticket_entitlements.event_id
        and e.creator_user_id = private.current_app_user_id()
    )
  );

create policy ticket_requests_select_self_creator_or_staff
  on ticket_requests for select to authenticated
  using (
    requester_user_id = private.current_app_user_id()
    or private.is_staff_member()
    or exists (
      select 1
      from events e
      where e.id = ticket_requests.event_id
        and e.creator_user_id = private.current_app_user_id()
    )
  );

create policy dating_profiles_select_self_or_staff
  on dating_profiles for select to authenticated
  using (user_id = private.current_app_user_id() or private.is_staff_member());

create policy dating_swipes_select_self_or_staff
  on dating_swipes for select to authenticated
  using (
    actor_user_id = private.current_app_user_id()
    or target_user_id = private.current_app_user_id()
    or private.is_staff_member()
  );

create policy dating_matches_select_member_or_staff
  on dating_matches for select to authenticated
  using (
    user_a_id = private.current_app_user_id()
    or user_b_id = private.current_app_user_id()
    or private.is_staff_member()
  );
