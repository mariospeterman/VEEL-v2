drop index if exists live_rooms_access_mode_state_idx;

alter table live_passes
  add column duration_minutes integer not null default 60
    check (duration_minutes in (30, 60, 180)),
  alter column expires_at set default now() + interval '60 minutes';

update live_passes
set expires_at = coalesce(expires_at, now() + interval '60 minutes');

alter table live_passes
  alter column expires_at set not null,
  alter column expires_at drop default;

alter table live_pass_purchase_requests
  add column duration_minutes integer not null default 60
    check (duration_minutes in (30, 60, 180));

alter table live_rooms
  drop constraint if exists live_rooms_replay_window_check,
  drop constraint if exists live_rooms_member_inclusion_check,
  drop constraint if exists live_rooms_event_price_check,
  drop constraint if exists live_rooms_access_mode_check,
  add column pass_durations_minutes integer[] not null default array[30, 60, 180];

update live_rooms
set
  access_rule = 'pass_required',
  event_price_minor = coalesce(event_price_minor, 50000000);

alter table live_rooms
  alter column access_rule set default 'pass_required',
  alter column event_price_minor set default 50000000,
  alter column event_price_minor set not null,
  drop column replay_window_hours,
  drop column members_included_in_paid_event,
  drop column members_only_chat;

alter table live_rooms
  rename column event_price_minor to pass_price_minor;

alter table live_rooms
  rename column preview_seconds to teaser_seconds;
