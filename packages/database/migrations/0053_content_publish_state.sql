alter table content_items
  add column if not exists publish_state text not null default 'draft',
  add column if not exists publish_requested_at timestamptz,
  add column if not exists published_at timestamptz,
  add constraint content_items_publish_state_check
    check (publish_state in ('draft', 'submitted_for_review', 'published', 'blocked', 'unpublished'));

drop index if exists content_items_home_feed_idx;
create index content_items_home_feed_idx
  on content_items (created_at desc)
  where state = 'ready'
    and publish_state = 'published'
    and visibility = 'public'
    and moderation_state = 'approved';

drop policy if exists content_items_select_visible_creator_or_staff on content_items;
create policy content_items_select_visible_creator_or_staff
  on content_items for select to authenticated
  using (
    (
      state = 'ready'
      and publish_state = 'published'
      and visibility = 'public'
      and moderation_state = 'approved'
    )
    or creator_user_id = (select private.current_app_user_id())
    or (select private.is_staff_member())
  );

drop policy if exists media_assets_select_visible_creator_or_staff on media_assets;
create policy media_assets_select_visible_creator_or_staff
  on media_assets for select to authenticated
  using (
    exists (
      select 1
      from content_items ci
      where ci.id = media_assets.content_item_id
        and (
          (
            ci.state = 'ready'
            and ci.publish_state = 'published'
            and ci.visibility = 'public'
            and ci.moderation_state = 'approved'
          )
          or ci.creator_user_id = (select private.current_app_user_id())
          or (select private.is_staff_member())
        )
    )
  );

drop policy if exists content_access_rules_select_visible_creator_or_staff on content_access_rules;
create policy content_access_rules_select_visible_creator_or_staff
  on content_access_rules for select to authenticated
  using (
    exists (
      select 1
      from content_items ci
      where ci.id = content_access_rules.content_item_id
        and (
          (
            ci.state = 'ready'
            and ci.publish_state = 'published'
            and ci.visibility = 'public'
            and ci.moderation_state = 'approved'
          )
          or ci.creator_user_id = (select private.current_app_user_id())
          or (select private.is_staff_member())
        )
    )
  );
