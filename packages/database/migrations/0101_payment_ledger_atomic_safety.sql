-- Keep canonical settlement ledger values lossless while public money contracts use numbers.

do $$
begin
  if exists (
    select 1
    from payment_ledger_entries
    where amount_minor < 0
       or amount_minor > 9007199254740991
  ) then
    raise exception 'payment ledger contains atomic values outside the JavaScript safe-integer range';
  end if;
end
$$;

alter table payment_ledger_entries
  add constraint payment_ledger_entries_javascript_safe_amount_check
  check (amount_minor between 0 and 9007199254740991);

comment on constraint payment_ledger_entries_javascript_safe_amount_check
  on payment_ledger_entries is
  'Keeps atomic ledger values lossless until public money contracts migrate from numbers to decimal strings.';
