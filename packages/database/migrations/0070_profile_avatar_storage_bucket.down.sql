do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'storage') then
    execute $storage$
      delete from storage.buckets
      where id = 'profile-avatars'
    $storage$;
  end if;
end $$;
