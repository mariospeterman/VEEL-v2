alter table viewer_feed_preferences
  drop constraint if exists viewer_feed_preferences_nsfw_preference_check;

update viewer_feed_preferences
set nsfw_preference = 'recommended'
where nsfw_preference = 'both';

alter table viewer_feed_preferences
  alter column nsfw_preference set default 'recommended';

alter table viewer_feed_preferences
  add constraint viewer_feed_preferences_nsfw_preference_check
    check (nsfw_preference in ('recommended', 'nsfw', 'sfw'));

grant select on table age_verifications to authenticated;

create policy age_verifications_select_self_or_staff
  on age_verifications for select to authenticated
  using (user_id = (select private.current_app_user_id()) or (select private.is_staff_member()));

comment on table age_verifications is null;
