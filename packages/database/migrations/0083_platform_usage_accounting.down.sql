drop table if exists platform_playback_heartbeats;
drop table if exists platform_playback_sessions;

update platform_tier_policies
set
  capabilities = capabilities || '["profile_membership"]'::jsonb,
  updated_at = now()
where tier_key = 'veel_studio'
  and not (capabilities ? 'profile_membership');
