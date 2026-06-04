-- Supabase RLS baseline for public-schema tables.
-- Fastify remains the business truth layer; these policies protect direct Supabase reads/realtime.

create schema if not exists private;

create or replace function private.current_app_user_id()
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select u.id
  from public.users u
  where u.supabase_user_id = (select auth.uid())
  limit 1
$$;

create or replace function private.is_staff_member()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.staff_memberships sm
    join public.users u on u.id = sm.user_id
    where u.supabase_user_id = (select auth.uid())
      and sm.state = 'active'
  )
$$;

grant usage on schema private to authenticated;
grant execute on function private.current_app_user_id() to authenticated;
grant execute on function private.is_staff_member() to authenticated;

alter table users enable row level security;
alter table profiles enable row level security;
alter table staff_memberships enable row level security;
alter table staff_permissions enable row level security;
alter table provider_events enable row level security;
alter table provider_webhook_receipts enable row level security;
alter table idempotency_keys enable row level security;
alter table audit_events enable row level security;
alter table age_verifications enable row level security;
alter table wallets enable row level security;
alter table wallet_link_challenges enable row level security;
alter table content_items enable row level security;
alter table media_assets enable row level security;
alter table content_access_rules enable row level security;
alter table payment_intents enable row level security;
alter table payment_settlement_attempts enable row level security;

create policy users_select_self_or_staff
  on users for select to authenticated
  using (id = (select private.current_app_user_id()) or (select private.is_staff_member()));

create policy profiles_select_public_self_or_staff
  on profiles for select to authenticated
  using (
    visibility = 'public'
    or user_id = (select private.current_app_user_id())
    or (select private.is_staff_member())
  );

create policy staff_memberships_select_self_or_staff
  on staff_memberships for select to authenticated
  using (user_id = (select private.current_app_user_id()) or (select private.is_staff_member()));

create policy staff_permissions_select_self_or_staff
  on staff_permissions for select to authenticated
  using (user_id = (select private.current_app_user_id()) or (select private.is_staff_member()));

create policy provider_events_select_staff
  on provider_events for select to authenticated
  using ((select private.is_staff_member()));

create policy provider_webhook_receipts_select_staff
  on provider_webhook_receipts for select to authenticated
  using ((select private.is_staff_member()));

create policy idempotency_keys_select_staff
  on idempotency_keys for select to authenticated
  using ((select private.is_staff_member()));

create policy audit_events_select_actor_or_staff
  on audit_events for select to authenticated
  using (actor_user_id = (select private.current_app_user_id()) or (select private.is_staff_member()));

create policy age_verifications_select_self_or_staff
  on age_verifications for select to authenticated
  using (user_id = (select private.current_app_user_id()) or (select private.is_staff_member()));

create policy wallets_select_self_or_staff
  on wallets for select to authenticated
  using (user_id = (select private.current_app_user_id()) or (select private.is_staff_member()));

create policy wallet_link_challenges_select_self_or_staff
  on wallet_link_challenges for select to authenticated
  using (user_id = (select private.current_app_user_id()) or (select private.is_staff_member()));

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

create policy payment_intents_select_self_or_staff
  on payment_intents for select to authenticated
  using (user_id = (select private.current_app_user_id()) or (select private.is_staff_member()));

create policy payment_settlement_attempts_select_owner_or_staff
  on payment_settlement_attempts for select to authenticated
  using (
    exists (
      select 1
      from payment_intents pi
      where pi.id = payment_settlement_attempts.payment_intent_id
        and (pi.user_id = (select private.current_app_user_id()) or (select private.is_staff_member()))
    )
  );

create policy entitlements_select_self_or_staff
  on entitlements for select to authenticated
  using (user_id = (select private.current_app_user_id()) or (select private.is_staff_member()));

create policy entitlement_events_select_owner_or_staff
  on entitlement_events for select to authenticated
  using (
    exists (
      select 1
      from entitlements e
      where e.id = entitlement_events.entitlement_id
        and (e.user_id = (select private.current_app_user_id()) or (select private.is_staff_member()))
    )
  );

create policy payment_ledger_entries_select_account_owner_or_staff
  on payment_ledger_entries for select to authenticated
  using (account_user_id = (select private.current_app_user_id()) or (select private.is_staff_member()));

create policy referral_tokens_select_creator_or_staff
  on referral_tokens for select to authenticated
  using (creator_user_id = (select private.current_app_user_id()) or (select private.is_staff_member()));

create policy referral_attributions_select_party_or_staff
  on referral_attributions for select to authenticated
  using (
    referrer_user_id = (select private.current_app_user_id())
    or referred_user_id = (select private.current_app_user_id())
    or (select private.is_staff_member())
  );

create policy referral_commissions_select_referrer_or_staff
  on referral_commissions for select to authenticated
  using (referrer_user_id = (select private.current_app_user_id()) or (select private.is_staff_member()));

create policy live_rooms_select_creator_or_staff
  on live_rooms for select to authenticated
  using (creator_user_id = (select private.current_app_user_id()) or (select private.is_staff_member()));

create policy live_pass_purchase_requests_select_buyer_creator_or_staff
  on live_pass_purchase_requests for select to authenticated
  using (
    buyer_user_id = (select private.current_app_user_id())
    or (select private.is_staff_member())
    or exists (
      select 1
      from live_rooms lr
      where lr.id = live_pass_purchase_requests.room_id
        and lr.creator_user_id = (select private.current_app_user_id())
    )
  );

create policy live_passes_select_holder_creator_or_staff
  on live_passes for select to authenticated
  using (
    user_id = (select private.current_app_user_id())
    or (select private.is_staff_member())
    or exists (
      select 1
      from live_rooms lr
      where lr.id = live_passes.room_id
        and lr.creator_user_id = (select private.current_app_user_id())
    )
  );

create policy live_chat_messages_select_participant_or_staff
  on live_chat_messages for select to authenticated
  using (
    user_id = (select private.current_app_user_id())
    or (select private.is_staff_member())
    or exists (
      select 1
      from live_rooms lr
      where lr.id = live_chat_messages.room_id
        and lr.creator_user_id = (select private.current_app_user_id())
    )
    or exists (
      select 1
      from live_passes lp
      where lp.room_id = live_chat_messages.room_id
        and lp.user_id = (select private.current_app_user_id())
        and lp.state = 'active'
        and lp.expires_at > now()
    )
  );

create policy live_replay_assets_select_creator_pass_holder_or_staff
  on live_replay_assets for select to authenticated
  using (
    (select private.is_staff_member())
    or exists (
      select 1
      from live_rooms lr
      where lr.id = live_replay_assets.room_id
        and lr.creator_user_id = (select private.current_app_user_id())
    )
    or exists (
      select 1
      from live_passes lp
      where lp.room_id = live_replay_assets.room_id
        and lp.user_id = (select private.current_app_user_id())
        and lp.state = 'active'
        and lp.expires_at > now()
    )
  );

create policy conversations_select_member_or_staff
  on conversations for select to authenticated
  using (
    (select private.is_staff_member())
    or exists (
      select 1
      from conversation_members cm
      where cm.conversation_id = conversations.id
        and cm.user_id = (select private.current_app_user_id())
    )
  );

create policy conversation_members_select_member_or_staff
  on conversation_members for select to authenticated
  using (
    user_id = (select private.current_app_user_id())
    or (select private.is_staff_member())
    or exists (
      select 1
      from conversation_members cm
      where cm.conversation_id = conversation_members.conversation_id
        and cm.user_id = (select private.current_app_user_id())
    )
  );

create policy messages_select_conversation_member_or_staff
  on messages for select to authenticated
  using (
    (select private.is_staff_member())
    or exists (
      select 1
      from conversation_members cm
      where cm.conversation_id = messages.conversation_id
        and cm.user_id = (select private.current_app_user_id())
    )
  );

create policy paid_message_delivery_requests_select_party_or_staff
  on paid_message_delivery_requests for select to authenticated
  using (
    sender_user_id = (select private.current_app_user_id())
    or recipient_user_id = (select private.current_app_user_id())
    or (select private.is_staff_member())
  );

create policy wallet_transaction_records_select_self_or_staff
  on wallet_transaction_records for select to authenticated
  using (user_id = (select private.current_app_user_id()) or (select private.is_staff_member()));
