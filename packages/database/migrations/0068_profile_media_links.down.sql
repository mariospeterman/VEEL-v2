alter table profiles
  drop constraint if exists profiles_profile_links_array_chk,
  drop column if exists profile_links;
