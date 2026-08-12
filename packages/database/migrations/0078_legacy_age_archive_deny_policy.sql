-- Keep the historical table explicitly inaccessible while satisfying the RLS advisor.
create policy age_verifications_legacy_archive_deny_all
  on age_verifications
  for all
  to anon, authenticated
  using (false)
  with check (false);
