-- Public profile avatar storage bucket.
-- Uploads are server-owned through Fastify + backend-only Supabase credentials.
-- The browser receives only the resulting public avatar URL.

do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'storage') then
    execute $storage$
      insert into storage.buckets (
        id,
        name,
        public,
        file_size_limit,
        allowed_mime_types
      )
      values (
        'profile-avatars',
        'profile-avatars',
        true,
        5000000,
        array['image/jpeg', 'image/png', 'image/webp']
      )
      on conflict (id) do update
      set
        public = excluded.public,
        file_size_limit = excluded.file_size_limit,
        allowed_mime_types = excluded.allowed_mime_types
    $storage$;
  end if;
end $$;
