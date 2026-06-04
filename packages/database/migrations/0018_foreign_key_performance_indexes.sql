-- Cover foreign keys reported by the Supabase performance advisor.
-- These indexes protect deletes/updates on referenced rows and common policy joins.

create index entitlement_events_actor_user_id_idx
  on entitlement_events (actor_user_id)
  where actor_user_id is not null;

create index entitlement_events_payment_intent_id_idx
  on entitlement_events (payment_intent_id)
  where payment_intent_id is not null;

create index live_chat_messages_user_id_idx
  on live_chat_messages (user_id);

create index live_pass_purchase_requests_buyer_user_id_idx
  on live_pass_purchase_requests (buyer_user_id);

create index live_pass_purchase_requests_room_id_idx
  on live_pass_purchase_requests (room_id);

create index live_passes_room_id_idx
  on live_passes (room_id);

create index live_replay_assets_content_item_id_idx
  on live_replay_assets (content_item_id)
  where content_item_id is not null;

create index live_rooms_replay_content_item_id_idx
  on live_rooms (replay_content_item_id)
  where replay_content_item_id is not null;

create index messages_sender_user_id_idx
  on messages (sender_user_id);

create index paid_message_delivery_requests_recipient_user_id_idx
  on paid_message_delivery_requests (recipient_user_id);

create index payment_intents_referral_token_id_idx
  on payment_intents (referral_token_id)
  where referral_token_id is not null;

create index payment_ledger_entries_account_user_id_idx
  on payment_ledger_entries (account_user_id)
  where account_user_id is not null;

create index referral_attributions_referrer_user_id_idx
  on referral_attributions (referrer_user_id);

create index referral_commissions_referral_attribution_id_idx
  on referral_commissions (referral_attribution_id);

create index referral_commissions_referral_token_id_idx
  on referral_commissions (referral_token_id);

create index referral_commissions_referred_user_id_idx
  on referral_commissions (referred_user_id);

create index staff_memberships_granted_by_user_id_idx
  on staff_memberships (granted_by_user_id)
  where granted_by_user_id is not null;

create index staff_permissions_granted_by_user_id_idx
  on staff_permissions (granted_by_user_id)
  where granted_by_user_id is not null;

create index wallet_transaction_records_wallet_id_idx
  on wallet_transaction_records (wallet_id)
  where wallet_id is not null;
