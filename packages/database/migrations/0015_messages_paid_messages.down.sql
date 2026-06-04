drop index if exists paid_message_delivery_requests_sender_idx;
drop index if exists paid_message_delivery_requests_conversation_idx;
drop index if exists messages_conversation_created_at_idx;
drop index if exists conversation_members_user_idx;

drop table if exists paid_message_delivery_requests;
drop table if exists messages;
drop table if exists conversation_members;
drop table if exists conversations;
