-- PostgreSQL enum values cannot be removed safely in place. The compliance value remains inert after rollback.
drop table if exists staging_fixture_resources;
drop table if exists staff_membership_action_receipts;
drop table if exists staff_invitations;
drop index if exists staff_memberships_active_owner_idx;
alter table staff_memberships drop constraint if exists staff_memberships_state_check;
