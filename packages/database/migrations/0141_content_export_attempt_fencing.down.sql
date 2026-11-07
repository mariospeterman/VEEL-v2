do $$
begin
  if exists (select 1 from content_export_archive_attempts) then
    raise exception using
      errcode = '55000',
      message = '0141 rollback refused because content export archive-attempt evidence exists';
  end if;
end
$$;

drop table content_export_archive_attempts;

alter table content_export_jobs
  drop column archive_attempt_sequence;
