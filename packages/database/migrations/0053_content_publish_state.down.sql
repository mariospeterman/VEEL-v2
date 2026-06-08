drop policy if exists content_access_rules_select_visible_creator_or_staff on content_access_rules;
drop policy if exists media_assets_select_visible_creator_or_staff on media_assets;
drop policy if exists content_items_select_visible_creator_or_staff on content_items;

drop index if exists content_items_home_feed_idx;
create index content_items_home_feed_idx
  on content_items (created_at desc)
  where state = 'ready' and visibility = 'public' and moderation_state = 'approved';

create policy content_items_select_visible_creator_or_staff
  on content_items for select to authenticated
  using (
    (state = 'ready' and visibility = 'public' and moderation_state = 'approved')
    or creator_user_id = (select private.current_app_user_id())
    or (select private.is_staff_member())
  );

create policy media_assets_select_visible_creator_or_staff
  on media_assets for select to authenticated
  using (
    exists (
      select 1
      from content_items ci
      where ci.id = media_assets.content_item_id
        and (
          (ci.state = 'ready' and ci.visibility = 'public' and ci.moderation_state = 'approved')
          or ci.creator_user_id = (select private.current_app_user_id())
          or (select private.is_staff_member())
        )
    )
  );

create policy content_access_rules_select_visible_creator_or_staff
  on content_access_rules for select to authenticated
  using (
    exists (
      select 1
      from content_items ci
      where ci.id = content_access_rules.content_item_id
        and (
          (ci.state = 'ready' and ci.visibility = 'public' and ci.moderation_state = 'approved')
          or ci.creator_user_id = (select private.current_app_user_id())
          or (select private.is_staff_member())
        )
    )
  );

alter table content_items
  drop constraint if exists content_items_publish_state_check,
  drop column if exists published_at,
  drop column if exists publish_requested_at,
  drop column if exists publish_state;
