-- Canonical Event Access Pass and Mutuals table names.
-- Deprecated API route aliases stay at the HTTP boundary; database names use launch vocabulary.

drop policy if exists ticket_types_select_public_owner_holder_or_staff on ticket_types;
drop policy if exists ticket_purchase_requests_select_self_creator_or_staff on ticket_purchase_requests;
drop policy if exists ticket_entitlements_select_self_creator_or_staff on ticket_entitlements;
drop policy if exists ticket_requests_select_self_creator_or_staff on ticket_requests;
drop policy if exists dating_profiles_select_self_or_staff on dating_profiles;
drop policy if exists dating_swipes_select_self_or_staff on dating_swipes;
drop policy if exists dating_matches_select_member_or_staff on dating_matches;

alter table if exists ticket_types rename to event_access_pass_types;
alter table if exists ticket_purchase_requests rename to event_access_purchase_requests;
alter table if exists ticket_entitlements rename to event_access_passes;
alter table if exists ticket_requests rename to event_access_requests;

alter table event_access_purchase_requests rename column ticket_type_id to access_pass_type_id;
alter table event_access_passes rename column ticket_type_id to access_pass_type_id;
alter table event_access_requests rename column ticket_type_id to access_pass_type_id;

alter table if exists dating_profiles rename to mutual_profiles;
alter table if exists dating_swipes rename to mutual_interests;
alter table if exists dating_matches rename to mutuals;

alter index if exists ticket_types_event_state_idx rename to event_access_pass_types_event_state_idx;
alter index if exists ticket_purchase_requests_buyer_idx rename to event_access_purchase_requests_buyer_idx;
alter index if exists ticket_purchase_requests_event_id_idx rename to event_access_purchase_requests_event_id_idx;
alter index if exists ticket_purchase_requests_ticket_type_id_idx rename to event_access_purchase_requests_access_pass_type_id_idx;
alter index if exists ticket_entitlements_holder_idx rename to event_access_passes_holder_idx;
alter index if exists ticket_entitlements_event_idx rename to event_access_passes_event_idx;
alter index if exists ticket_entitlements_ticket_type_id_idx rename to event_access_passes_access_pass_type_id_idx;
alter index if exists ticket_requests_requester_idx rename to event_access_requests_requester_idx;
alter index if exists ticket_requests_ticket_type_id_idx rename to event_access_requests_access_pass_type_id_idx;
alter index if exists ticket_requests_reviewed_by_user_id_idx rename to event_access_requests_reviewed_by_user_id_idx;

alter index if exists dating_swipes_content_unique rename to mutual_interests_content_unique;
alter index if exists dating_swipes_profile_unique rename to mutual_interests_profile_unique;
alter index if exists dating_swipes_target_action_idx rename to mutual_interests_target_action_idx;
alter index if exists dating_swipes_content_item_id_idx rename to mutual_interests_content_item_id_idx;
alter index if exists dating_matches_pair_unique rename to mutuals_pair_unique;
alter index if exists dating_matches_user_a_state_idx rename to mutuals_user_a_state_idx;
alter index if exists dating_matches_user_b_state_idx rename to mutuals_user_b_state_idx;
alter index if exists dating_matches_source_content_idx rename to mutuals_source_content_idx;
alter index if exists dating_matches_archived_by_user_id_idx rename to mutuals_archived_by_user_id_idx;

alter table event_access_pass_types enable row level security;
alter table event_access_purchase_requests enable row level security;
alter table event_access_passes enable row level security;
alter table event_access_requests enable row level security;
alter table mutual_profiles enable row level security;
alter table mutual_interests enable row level security;
alter table mutuals enable row level security;

create policy event_access_pass_types_select_public_owner_holder_or_staff
  on event_access_pass_types for select to authenticated
  using (
    exists (
      select 1
      from events e
      where e.id = event_access_pass_types.event_id
        and (
          e.state = 'published'
          or e.creator_user_id = private.current_app_user_id()
          or private.is_staff_member()
        )
    )
  );

create policy event_access_purchase_requests_select_self_creator_or_staff
  on event_access_purchase_requests for select to authenticated
  using (
    buyer_user_id = private.current_app_user_id()
    or private.is_staff_member()
    or exists (
      select 1
      from events e
      where e.id = event_access_purchase_requests.event_id
        and e.creator_user_id = private.current_app_user_id()
    )
  );

create policy event_access_passes_select_self_creator_or_staff
  on event_access_passes for select to authenticated
  using (
    holder_user_id = private.current_app_user_id()
    or private.is_staff_member()
    or exists (
      select 1
      from events e
      where e.id = event_access_passes.event_id
        and e.creator_user_id = private.current_app_user_id()
    )
  );

create policy event_access_requests_select_self_creator_or_staff
  on event_access_requests for select to authenticated
  using (
    requester_user_id = private.current_app_user_id()
    or private.is_staff_member()
    or exists (
      select 1
      from events e
      where e.id = event_access_requests.event_id
        and e.creator_user_id = private.current_app_user_id()
    )
  );

create policy mutual_profiles_select_self_or_staff
  on mutual_profiles for select to authenticated
  using (user_id = private.current_app_user_id() or private.is_staff_member());

create policy mutual_interests_select_self_or_staff
  on mutual_interests for select to authenticated
  using (
    actor_user_id = private.current_app_user_id()
    or target_user_id = private.current_app_user_id()
    or private.is_staff_member()
  );

create policy mutuals_select_member_or_staff
  on mutuals for select to authenticated
  using (
    user_a_id = private.current_app_user_id()
    or user_b_id = private.current_app_user_id()
    or private.is_staff_member()
  );
