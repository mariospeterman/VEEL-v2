drop index if exists events_content_item_id_unique_idx;

alter table events
  drop column if exists content_item_id;
