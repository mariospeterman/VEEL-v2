do $$
begin
  if exists (select 1 from media_upload_operations) then
    raise exception using
      errcode = '55000',
      message = '0123 rollback refused because durable provider upload state exists';
  end if;
end
$$;

drop table media_upload_operations;
