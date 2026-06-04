drop index if exists live_replay_assets_room_state_idx;
drop index if exists live_chat_messages_room_created_at_idx;
drop index if exists live_passes_user_room_state_idx;
drop index if exists live_rooms_state_created_at_idx;
drop index if exists live_rooms_creator_created_at_idx;

drop table if exists live_replay_assets;
drop table if exists live_chat_messages;
drop table if exists live_passes;
drop table if exists live_pass_purchase_requests;
drop table if exists live_rooms;
