do $$
begin
  if exists (select 1 from mutation_command_receipts) then
    raise exception
      '0128 rollback refused because lifelong mutation command receipts exist'
      using errcode = '55000';
  end if;
end
$$;

drop table if exists mutation_command_receipts;
