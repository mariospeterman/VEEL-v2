-- Raise profile avatar uploads to the product-approved 5 MB limit.

do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'storage') then
    execute $storage$
      update storage.buckets
      set file_size_limit = 5000000
      where id = 'profile-avatars'
    $storage$;
  end if;
end $$;
