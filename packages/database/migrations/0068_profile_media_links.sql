alter table profiles
  add column if not exists profile_links jsonb not null default '[]'::jsonb,
  add constraint profiles_profile_links_array_chk check (jsonb_typeof(profile_links) = 'array');
