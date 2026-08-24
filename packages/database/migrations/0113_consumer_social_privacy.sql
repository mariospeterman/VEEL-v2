-- Convergence 06: comment conversations, account privacy controls, and self-service data requests.
-- Fastify remains the only mutation authority. These tables never grant access or social priority.

alter table engagement_action_receipts
  drop constraint engagement_action_receipts_action_check,
  add constraint engagement_action_receipts_action_check check (action in (
    'content.like', 'content.save', 'comment.like',
    'user.block', 'user.unblock', 'user.mute', 'user.unmute'
  ));

insert into engagement_action_receipts (actor_user_id, action, target_id, idempotency_key, created_at)
select blocker_user_id, 'user.block', blocked_user_id, idempotency_key, created_at
from blocks
on conflict do nothing;

create table comment_reactions (
  comment_id uuid not null references comments(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  reaction_key text not null default 'like' check (reaction_key = 'like'),
  state text not null default 'active' check (state in ('active', 'inactive')),
  last_idempotency_key text not null,
  updated_at timestamptz not null default now(),
  primary key (comment_id, user_id, reaction_key)
);

create table comment_mentions (
  comment_id uuid not null references comments(id) on delete cascade,
  mentioned_user_id uuid not null references users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (comment_id, mentioned_user_id)
);

create table user_mutes (
  muting_user_id uuid not null references users(id) on delete cascade,
  muted_user_id uuid not null references users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (muting_user_id, muted_user_id),
  check (muting_user_id <> muted_user_id)
);

alter table data_requests
  add column idempotency_key text;

update data_requests
set idempotency_key = 'legacy:' || id::text
where idempotency_key is null;

alter table data_requests
  alter column idempotency_key set not null,
  add constraint data_requests_idempotency_key_length
    check (char_length(idempotency_key) between 1 and 128),
  add constraint data_requests_requester_idempotency_unique
    unique (requester_user_id, idempotency_key);

create index data_requests_requester_active_type_idx
  on data_requests (requester_user_id, type)
  where state in ('requested', 'verifying', 'processing');

create index comment_reactions_user_idx
  on comment_reactions (user_id, updated_at desc)
  where state = 'active';

create index comment_mentions_user_idx
  on comment_mentions (mentioned_user_id, created_at desc);

create index user_mutes_muted_idx
  on user_mutes (muted_user_id);

alter table comment_reactions enable row level security;
alter table comment_mentions enable row level security;
alter table user_mutes enable row level security;

grant select on table comment_reactions, comment_mentions, user_mutes to authenticated;

create policy comment_reactions_select_self_author_creator_or_staff
  on comment_reactions for select to authenticated
  using (
    user_id = (select private.current_app_user_id())
    or (select private.is_staff_member())
    or exists (
      select 1
      from comments c
      join content_items ci on ci.id = c.content_item_id
      where c.id = comment_reactions.comment_id
        and (c.user_id = (select private.current_app_user_id())
          or ci.creator_user_id = (select private.current_app_user_id()))
    )
  );

create policy comment_mentions_select_participant_or_staff
  on comment_mentions for select to authenticated
  using (
    mentioned_user_id = (select private.current_app_user_id())
    or (select private.is_staff_member())
    or exists (
      select 1
      from comments c
      where c.id = comment_mentions.comment_id
        and c.user_id = (select private.current_app_user_id())
    )
  );

create policy user_mutes_select_self_or_staff
  on user_mutes for select to authenticated
  using (muting_user_id = (select private.current_app_user_id()) or (select private.is_staff_member()));

create or replace function private.enforce_comment_parent()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  parent_content_id uuid;
  parent_parent_id uuid;
begin
  if new.parent_comment_id is null then
    return new;
  end if;

  -- Safety/admin workflows must always be able to hide or remove a reply,
  -- even when its parent has already become non-visible.
  if tg_op = 'UPDATE' and new.moderation_state <> 'visible' then
    return new;
  end if;

  if new.parent_comment_id = new.id then
    raise exception using errcode = '23514', message = 'comment cannot reply to itself';
  end if;

  select content_item_id, parent_comment_id
  into parent_content_id, parent_parent_id
  from comments
  where id = new.parent_comment_id
    and moderation_state = 'visible';

  if parent_content_id is null or parent_content_id <> new.content_item_id then
    raise exception using errcode = '23514', message = 'reply parent must be visible on the same content';
  end if;

  if parent_parent_id is not null then
    raise exception using errcode = '23514', message = 'reply depth is limited to one level';
  end if;

  return new;
end;
$$;

create trigger comments_parent_guard
before insert or update of parent_comment_id, content_item_id, moderation_state on comments
for each row execute function private.enforce_comment_parent();
