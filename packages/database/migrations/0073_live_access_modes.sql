-- Replace timed live passes with one of three creator-selected access modes.
-- The existing live_pass payment product remains the internal settlement compatibility key.

alter table live_rooms
  rename column teaser_seconds to preview_seconds;

alter table live_rooms
  rename column pass_price_minor to event_price_minor;

alter table live_rooms
  add column members_only_chat boolean not null default false,
  add column members_included_in_paid_event boolean not null default false,
  add column replay_window_hours integer not null default 48;

update live_rooms
set access_rule = 'paid_event'
where access_rule = 'pass_required';

alter table live_rooms
  alter column access_rule set default 'public',
  alter column event_price_minor drop not null,
  alter column event_price_minor drop default,
  drop column pass_durations_minutes,
  add constraint live_rooms_access_mode_check
    check (access_rule in ('public', 'profile_members', 'paid_event')),
  add constraint live_rooms_event_price_check
    check (
      (access_rule = 'paid_event' and event_price_minor is not null and event_price_minor > 0)
      or (access_rule <> 'paid_event' and event_price_minor is null)
    ),
  add constraint live_rooms_member_inclusion_check
    check (not members_included_in_paid_event or access_rule = 'paid_event'),
  add constraint live_rooms_replay_window_check
    check (replay_window_hours between 0 and 720);

alter table live_pass_purchase_requests
  drop constraint if exists live_pass_purchase_requests_duration_minutes_check,
  drop column duration_minutes;

alter table live_passes
  drop constraint if exists live_passes_duration_minutes_check,
  drop column duration_minutes,
  alter column expires_at drop not null;

create index live_rooms_access_mode_state_idx
  on live_rooms (access_rule, state, created_at desc);
