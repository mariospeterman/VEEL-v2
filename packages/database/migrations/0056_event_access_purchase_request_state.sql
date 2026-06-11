-- Canonical Event Access purchase request state vocabulary.
-- Keeps the state source of truth in the entitlement/payment settlement boundary.

update event_access_purchase_requests
set state = 'access_pass_granted'
where state = 'ticket_granted';

do $$
declare
  constraint_name text;
begin
  select con.conname
    into constraint_name
  from pg_constraint con
  join pg_class rel on rel.oid = con.conrelid
  join pg_namespace nsp on nsp.oid = rel.relnamespace
  where nsp.nspname = 'public'
    and rel.relname = 'event_access_purchase_requests'
    and con.contype = 'c'
    and pg_get_constraintdef(con.oid) like '%state%'
  limit 1;

  if constraint_name is not null then
    execute format('alter table event_access_purchase_requests drop constraint %I', constraint_name);
  end if;
end $$;

alter table event_access_purchase_requests
  add constraint event_access_purchase_requests_state_check
  check (state in ('pending_payment', 'access_pass_granted', 'cancelled'));
