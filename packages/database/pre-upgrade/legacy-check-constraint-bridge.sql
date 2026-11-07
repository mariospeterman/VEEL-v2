-- DB-06 pre-upgrade bridge for databases that have not yet applied 0046, 0056, or 0077.
--
-- This file is intentionally outside the immutable forward-migration directory. It only widens
-- obsolete CHECK constraints so the historical migration can transform populated rows before it
-- installs its final constraint. Run it through scripts/apply-legacy-migration-bridge.mjs; never
-- record it as a replacement migration or mark a migration applied without running that migration.

do $wevid_bridge$
declare
  constraint_name text;
begin
  if to_regclass('public.reports') is not null then
    select con.conname
      into constraint_name
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    join pg_namespace nsp on nsp.oid = rel.relnamespace
    where nsp.nspname = 'public'
      and rel.relname = 'reports'
      and con.contype = 'c'
      and pg_get_constraintdef(con.oid) like '%state%'
      and pg_get_constraintdef(con.oid) not like '%rejected%'
    limit 1;

    if constraint_name is not null then
      execute format('alter table public.reports drop constraint %I', constraint_name);
      alter table public.reports
        add constraint reports_state_check
        check (state in (
          'submitted', 'queued', 'reviewing', 'resolved', 'dismissed', 'escalated', 'rejected'
        ));
    end if;
  end if;

  constraint_name := null;
  -- A database starting before 0049 still has the historical table name. Widen
  -- it before 0049 renames the table so one bridge run can carry an older
  -- populated prefix through 0056 without stopping for a second intervention.
  if to_regclass('public.ticket_purchase_requests') is not null then
    select con.conname
      into constraint_name
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    join pg_namespace nsp on nsp.oid = rel.relnamespace
    where nsp.nspname = 'public'
      and rel.relname = 'ticket_purchase_requests'
      and con.contype = 'c'
      and pg_get_constraintdef(con.oid) like '%state%'
      and pg_get_constraintdef(con.oid) not like '%access_pass_granted%'
    limit 1;

    if constraint_name is not null then
      execute format(
        'alter table public.ticket_purchase_requests drop constraint %I',
        constraint_name
      );
      alter table public.ticket_purchase_requests
        add constraint ticket_purchase_requests_state_check
        check (state in ('pending_payment', 'ticket_granted', 'access_pass_granted', 'cancelled'));
    end if;
  end if;

  constraint_name := null;
  if to_regclass('public.event_access_purchase_requests') is not null then
    select con.conname
      into constraint_name
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    join pg_namespace nsp on nsp.oid = rel.relnamespace
    where nsp.nspname = 'public'
      and rel.relname = 'event_access_purchase_requests'
      and con.contype = 'c'
      and pg_get_constraintdef(con.oid) like '%state%'
      and pg_get_constraintdef(con.oid) not like '%access_pass_granted%'
    limit 1;

    if constraint_name is not null then
      execute format(
        'alter table public.event_access_purchase_requests drop constraint %I',
        constraint_name
      );
      alter table public.event_access_purchase_requests
        add constraint event_access_purchase_requests_state_check
        check (state in ('pending_payment', 'ticket_granted', 'access_pass_granted', 'cancelled'));
    end if;
  end if;

  constraint_name := null;
  if to_regclass('public.viewer_feed_preferences') is not null then
    select con.conname
      into constraint_name
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    join pg_namespace nsp on nsp.oid = rel.relnamespace
    where nsp.nspname = 'public'
      and rel.relname = 'viewer_feed_preferences'
      and con.contype = 'c'
      and pg_get_constraintdef(con.oid) like '%nsfw_preference%'
      and pg_get_constraintdef(con.oid) not like '%both%'
    limit 1;

    if constraint_name is not null then
      execute format(
        'alter table public.viewer_feed_preferences drop constraint %I',
        constraint_name
      );
      alter table public.viewer_feed_preferences
        add constraint viewer_feed_preferences_nsfw_preference_check
        check (nsfw_preference in ('recommended', 'both', 'nsfw', 'sfw'));
    end if;
  end if;
end
$wevid_bridge$;
