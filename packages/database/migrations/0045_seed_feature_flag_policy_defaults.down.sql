delete from feature_flags
where key = 'compliance.carf_exports'
  and state = 'paused'
  and value = '{"enabled": false, "reason": "Counsel/tax review required before CARF reporting exports"}'::jsonb;
