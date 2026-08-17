drop index if exists provider_events_delivery_sequence_uidx;

alter table provider_events
  drop column if exists delivery_sequence;

drop sequence if exists provider_events_delivery_sequence_seq;
