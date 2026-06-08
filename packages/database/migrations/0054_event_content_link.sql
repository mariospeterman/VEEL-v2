alter table events
  add column if not exists content_item_id uuid references content_items(id);

create unique index if not exists events_content_item_id_unique_idx
  on events (content_item_id)
  where content_item_id is not null;
