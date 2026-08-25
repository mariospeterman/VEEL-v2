delete from analytics_onboarding_daily
where event_key in (
  'landing_cta_clicked', 'landing_nav_clicked', 'landing_section_viewed',
  'landing_money_example_viewed', 'landing_comparison_viewed', 'landing_faq_opened'
);

delete from analytics_onboarding_journey_events
where event_key in (
  'landing_cta_clicked', 'landing_nav_clicked', 'landing_section_viewed',
  'landing_money_example_viewed', 'landing_comparison_viewed', 'landing_faq_opened'
);

alter table analytics_onboarding_daily
  drop constraint if exists analytics_onboarding_daily_event_key_check;

alter table analytics_onboarding_daily
  add constraint analytics_onboarding_daily_event_key_check check (event_key in (
    'landing_viewed', 'login_opened', 'onboarding_opened', 'auth_method_selected',
    'wallet_runtime_ready', 'wallet_authentication_completed', 'wallet_ownership_verified',
    'profile_step_viewed', 'profile_step_completed', 'age_step_started',
    'age_step_completed', 'age_step_failed', 'protected_app_entered',
    'onboarding_abandoned', 'returning_login_completed', 'account_not_found'
  ));

alter table analytics_onboarding_journey_events
  drop constraint if exists analytics_onboarding_journey_events_event_key_check;

alter table analytics_onboarding_journey_events
  add constraint analytics_onboarding_journey_events_event_key_check check (event_key in (
    'landing_viewed', 'login_opened', 'onboarding_opened', 'auth_method_selected',
    'wallet_runtime_ready', 'wallet_authentication_completed', 'wallet_ownership_verified',
    'profile_step_viewed', 'profile_step_completed', 'age_step_started',
    'age_step_completed', 'age_step_failed', 'protected_app_entered',
    'onboarding_abandoned', 'returning_login_completed', 'account_not_found'
  ));
