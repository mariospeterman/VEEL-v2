-- Cover foreign keys introduced by dating mode.

create index dating_swipes_content_item_id_idx
  on dating_swipes (content_item_id)
  where content_item_id is not null;

create index dating_matches_archived_by_user_id_idx
  on dating_matches (archived_by_user_id)
  where archived_by_user_id is not null;
