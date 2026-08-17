-- Stable local delivery order for monotonic provider-event recovery.

create sequence provider_events_delivery_sequence_seq;

alter table provider_events
  add column delivery_sequence bigint;

with ordered_events as (
  select
    id,
    row_number() over (order by received_at asc, id asc) as delivery_sequence
  from provider_events
)
update provider_events pe
set delivery_sequence = ordered_events.delivery_sequence
from ordered_events
where ordered_events.id = pe.id;

select setval(
  'provider_events_delivery_sequence_seq',
  greatest(coalesce(max(delivery_sequence), 1), 1),
  count(*) > 0
)
from provider_events;

alter sequence provider_events_delivery_sequence_seq
  owned by provider_events.delivery_sequence;

alter table provider_events
  alter column delivery_sequence set default nextval('provider_events_delivery_sequence_seq'),
  alter column delivery_sequence set not null;

create unique index provider_events_delivery_sequence_uidx
  on provider_events (delivery_sequence);

comment on column provider_events.delivery_sequence is
  'Monotonic local receipt order used to reject stale provider-event replay side effects.';
