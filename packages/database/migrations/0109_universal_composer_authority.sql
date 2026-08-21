-- Converge all creator post formats onto content_items + ordered media_assets.
-- Polls are subordinate content state; they are not a parallel content authority.
-- Provider credentials, private prompts, and raw provider payloads remain outside these tables.

alter table content_items
  add column body_text text,
  add column asset_revision bigint not null default 1 check (asset_revision > 0),
  add constraint content_items_media_type_check check (media_type in (
    'bit', 'clip', 'image', 'vod', 'live_replay', 'carousel', 'text', 'poll'
  )),
  add constraint content_items_body_text_check check (
    body_text is null or char_length(body_text) between 1 and 10000
  ),
  add constraint content_items_text_shape_check check (
    media_type = 'text'
    or body_text is null
  );

alter table media_assets
  add column asset_kind text not null default 'video' check (asset_kind in ('image', 'video')),
  add column position smallint,
  add column mime_type text,
  add column width_pixels integer,
  add column height_pixels integer,
  add column alt_text text,
  add column checksum_sha256 text,
  add column required_for_release boolean not null default true,
  add column is_cover boolean not null default false,
  add column focal_point_x numeric(5,4),
  add column focal_point_y numeric(5,4),
  add column origin_classification text not null default 'human_created' check (
    origin_classification in (
      'human_created', 'ai_assisted', 'ai_generated', 'materially_ai_manipulated'
    )
  ),
  add column source_lineage_reference text,
  add column workflow_provider_reference text,
  add column provenance_human_review_state text not null default 'not_required' check (
    provenance_human_review_state in ('not_required', 'pending', 'confirmed', 'rejected')
  ),
  add column visible_label_state text not null default 'none' check (
    visible_label_state in ('none', 'ai_assisted', 'ai_generated', 'manipulated')
  ),
  add column machine_readable_marking_state text not null default 'unavailable' check (
    machine_readable_marking_state in ('unavailable', 'pending', 'present', 'invalid')
  ),
  add column c2pa_reference text,
  add constraint media_assets_position_check check (position between 0 and 9),
  add constraint media_assets_mime_type_check check (
    mime_type is null
    or mime_type in (
      'image/jpeg', 'image/png', 'image/webp', 'image/avif',
      'video/mp4', 'video/quicktime', 'video/webm'
    )
  ),
  add constraint media_assets_dimensions_check check (
    (width_pixels is null and height_pixels is null)
    or (width_pixels between 1 and 16384 and height_pixels between 1 and 16384)
  ),
  add constraint media_assets_alt_text_check check (
    alt_text is null or char_length(alt_text) between 1 and 1000
  ),
  add constraint media_assets_checksum_check check (
    checksum_sha256 is null or checksum_sha256 ~ '^[0-9a-f]{64}$'
  ),
  add constraint media_assets_focal_point_check check (
    (focal_point_x is null and focal_point_y is null)
    or (focal_point_x between 0 and 1 and focal_point_y between 0 and 1)
  ),
  add constraint media_assets_provenance_privacy_check check (
    source_lineage_reference is null
    or (
      char_length(source_lineage_reference) between 1 and 500
      and source_lineage_reference !~* '(prompt|api[_ -]?key|credential)\s*[:=]'
    )
  );

with ordered_assets as (
  select
    id,
    row_number() over (
      partition by content_item_id
      order by created_at, id
    ) - 1 as next_position
  from media_assets
)
update media_assets asset
set position = ordered.next_position
from ordered_assets ordered
where ordered.id = asset.id;

alter table media_assets
  alter column position set not null;

create function private.assign_media_asset_position()
returns trigger
language plpgsql
security invoker
set search_path = public, private
as $$
begin
  perform 1
  from content_items
  where id = new.content_item_id
  for update;

  if new.position is null then
    select coalesce(max(asset.position) + 1, 0)
    into new.position
    from media_assets asset
    where asset.content_item_id = new.content_item_id;
  end if;

  if new.position not between 0 and 9 then
    raise exception using errcode = '23514', message = 'content_asset_count_exceeded';
  end if;

  return new;
end;
$$;

create trigger media_assets_assign_position
before insert on media_assets
for each row execute function private.assign_media_asset_position();

alter table media_assets
  add constraint media_assets_content_position_uidx
  unique (content_item_id, position)
  deferrable initially immediate;

create unique index media_assets_content_cover_uidx
  on media_assets (content_item_id)
  where is_cover;

create index media_assets_content_release_idx
  on media_assets (content_item_id, required_for_release, position);

create function private.content_composition_provider_ready(p_content_item_id uuid)
returns boolean
language sql
stable
security invoker
set search_path = public, private
as $$
  select coalesce((
    select case
      when content.media_type in ('text', 'poll') then not exists (
        select 1 from media_assets asset where asset.content_item_id = content.id
      )
      else exists (
        select 1 from media_assets asset
        where asset.content_item_id = content.id and asset.required_for_release is true
      ) and not exists (
        select 1 from media_assets asset
        where asset.content_item_id = content.id
          and asset.required_for_release is true
          and (asset.provider_playable is not true or asset.ready_at is null)
      )
    end
    from content_items content
    where content.id = p_content_item_id
  ), false);
$$;

create function private.content_composition_safety_ready(p_content_item_id uuid)
returns boolean
language sql
stable
security invoker
set search_path = public, private
as $$
  select coalesce((
    select
      safety.state = 'approved'
      and safety.provider_release_allowed is true
      and private.content_performer_readiness(content.id)
      and private.content_composition_provider_ready(content.id)
      and case
        when content.media_type in ('text', 'poll') then true
        else not exists (
          select 1
          from media_assets asset
          where asset.content_item_id = content.id
            and asset.required_for_release is true
            and (
              not private.content_safety_automated_asset_evidence_ready(content.id, asset.id)
              or not coalesce((
                select
                  scan.provider = 'internal'
                  and scan.normalized_signal = 'clear'
                  and scan.provider_event_id is not null
                  and scan.payload_hash ~ '^[0-9a-f]{64}$'
                  and scan.model_or_ruleset_version is not null
                from provider_media_scan_events scan
                where scan.media_safety_case_id = safety.id
                  and scan.media_asset_id = asset.id
                  and scan.scan_type = 'manual_review'
                  and scan.release_eligible is true
                order by scan.observed_at desc, scan.created_at desc, scan.id desc
                limit 1
              ), false)
            )
        )
      end
    from content_items content
    join media_safety_cases safety
      on safety.content_item_id = content.id and safety.state <> 'superseded'
    where content.id = p_content_item_id
  ), false);
$$;

revoke all on function private.content_composition_provider_ready(uuid) from public, anon, authenticated;
revoke all on function private.content_composition_safety_ready(uuid) from public, anon, authenticated;

comment on function private.content_composition_provider_ready(uuid) is
  'Requires every release-required media asset to be provider-ready; text and polls require no media assets.';
comment on function private.content_composition_safety_ready(uuid) is
  'Requires canonical approval and performer readiness, plus complete normalized automated and manual evidence for every release-required media asset.';

create table content_polls (
  content_item_id uuid primary key references content_items(id) on delete cascade,
  question text not null check (char_length(question) between 1 and 500),
  closes_at timestamptz,
  state text not null default 'open' check (state in ('open', 'closed', 'cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (closes_at is null or closes_at > created_at)
);

create table content_poll_options (
  id uuid primary key default gen_random_uuid(),
  content_item_id uuid not null references content_polls(content_item_id) on delete cascade,
  position smallint not null check (position between 0 and 3),
  option_text text not null check (char_length(option_text) between 1 and 200),
  vote_count bigint not null default 0 check (vote_count >= 0),
  created_at timestamptz not null default now(),
  unique (content_item_id, position),
  unique (content_item_id, id)
);

create table content_poll_votes (
  content_item_id uuid not null references content_polls(content_item_id) on delete cascade,
  option_id uuid not null,
  voter_user_id uuid not null references users(id) on delete cascade,
  idempotency_key text not null,
  request_hash text not null check (request_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (content_item_id, voter_user_id),
  unique (voter_user_id, idempotency_key),
  foreign key (content_item_id, option_id)
    references content_poll_options(content_item_id, id) on delete restrict
);

create index content_poll_votes_option_idx
  on content_poll_votes (option_id, voter_user_id);

create index content_poll_votes_voter_idx
  on content_poll_votes (voter_user_id, updated_at desc);

alter table content_polls enable row level security;
alter table content_poll_options enable row level security;
alter table content_poll_votes enable row level security;

comment on table content_polls is
  'Poll state subordinate to one canonical content_items draft/publication lifecycle.';
comment on column media_assets.position is
  'Server-owned zero-based order; at most ten assets are permitted per content item.';
comment on column media_assets.source_lineage_reference is
  'Opaque provenance reference only; private prompts, credentials, and raw provider payloads are forbidden.';

create function private.clear_poll_children_for_parent_delete()
returns trigger
language plpgsql
security invoker
set search_path = public, private
as $$
begin
  delete from content_poll_votes
  where content_item_id = old.content_item_id;

  delete from content_poll_options
  where content_item_id = old.content_item_id;

  return old;
end;
$$;

create trigger content_polls_clear_children
before delete on content_polls
for each row execute function private.clear_poll_children_for_parent_delete();

create function private.enforce_content_asset_shape()
returns trigger
language plpgsql
security invoker
set search_path = public, private
as $$
declare
  v_content_item_id uuid;
  v_media_type text;
  v_asset_count integer;
  v_invalid_kind_count integer;
begin
  if tg_table_name = 'content_items' then
    v_content_item_id := case when tg_op = 'DELETE' then old.id else new.id end;
  else
    v_content_item_id := case
      when tg_op = 'DELETE' then old.content_item_id
      else new.content_item_id
    end;
  end if;

  select media_type into v_media_type
  from content_items
  where id = v_content_item_id;

  if not found then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  select
    count(*),
    count(*) filter (where
      (v_media_type = 'image' and asset_kind <> 'image')
      or (v_media_type in ('bit', 'clip', 'vod', 'live_replay') and asset_kind <> 'video')
      or (v_media_type in ('text', 'poll'))
    )
  into v_asset_count, v_invalid_kind_count
  from media_assets
  where content_item_id = v_content_item_id;

  if v_asset_count > 10 then
    raise exception using errcode = '23514', message = 'content_asset_count_exceeded';
  end if;

  if v_invalid_kind_count > 0 then
    raise exception using errcode = '23514', message = 'content_asset_kind_invalid';
  end if;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

create constraint trigger media_assets_enforce_content_shape
after insert or update of content_item_id, asset_kind or delete on media_assets
deferrable initially deferred
for each row execute function private.enforce_content_asset_shape();

create constraint trigger content_items_enforce_asset_shape
after update of media_type on content_items
deferrable initially deferred
for each row execute function private.enforce_content_asset_shape();

create function private.bump_content_asset_revision()
returns trigger
language plpgsql
security invoker
set search_path = public, private
as $$
begin
  update content_items
  set asset_revision = asset_revision + 1, updated_at = now()
  where id = case when tg_op = 'DELETE' then old.content_item_id else new.content_item_id end;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

create trigger media_assets_bump_asset_revision
after insert or update of position, asset_kind, alt_text, is_cover, focal_point_x, focal_point_y or delete
on media_assets
for each row execute function private.bump_content_asset_revision();

create function private.prevent_poll_option_rewrite_after_vote()
returns trigger
language plpgsql
security invoker
set search_path = public, private
as $$
begin
  if exists (
    select 1
    from content_poll_votes vote
    where vote.content_item_id = old.content_item_id
  ) then
    raise exception using errcode = '23514', message = 'poll_options_locked_after_first_vote';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

create trigger content_poll_options_lock_after_vote
before update of position, option_text or delete on content_poll_options
for each row execute function private.prevent_poll_option_rewrite_after_vote();

create function private.sync_poll_vote_counts()
returns trigger
language plpgsql
security invoker
set search_path = public, private
as $$
begin
  if tg_op in ('UPDATE', 'DELETE') then
    update content_poll_options
    set vote_count = vote_count - 1
    where id = old.option_id;
  end if;

  if tg_op in ('INSERT', 'UPDATE') then
    update content_poll_options
    set vote_count = vote_count + 1
    where id = new.option_id;
  end if;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

create trigger content_poll_votes_sync_counts
after insert or update of option_id or delete on content_poll_votes
for each row execute function private.sync_poll_vote_counts();

create function private.enforce_poll_shape()
returns trigger
language plpgsql
security invoker
set search_path = public, private
as $$
declare
  v_content_item_id uuid;
  v_media_type text;
  v_publish_state text;
  v_body_text text;
  v_option_count integer;
begin
  if tg_table_name = 'content_items' then
    v_content_item_id := case when tg_op = 'DELETE' then old.id else new.id end;
  else
    v_content_item_id := case
      when tg_op = 'DELETE' then old.content_item_id
      else new.content_item_id
    end;
  end if;

  select media_type, publish_state, body_text
  into v_media_type, v_publish_state, v_body_text
  from content_items
  where id = v_content_item_id;

  if not found then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  if v_media_type = 'poll' then
    if v_publish_state not in ('draft', 'unpublished') and not exists (
      select 1 from content_polls poll where poll.content_item_id = v_content_item_id
    ) then
      raise exception using errcode = '23514', message = 'poll_definition_required';
    end if;

    if exists (
      select 1 from content_polls poll where poll.content_item_id = v_content_item_id
    ) then
      select count(*) into v_option_count
      from content_poll_options option
      where option.content_item_id = v_content_item_id;

      if v_option_count not between 2 and 4 then
        raise exception using errcode = '23514', message = 'poll_requires_two_to_four_options';
      end if;
    end if;
  elsif exists (
    select 1 from content_polls poll where poll.content_item_id = v_content_item_id
  ) then
    raise exception using errcode = '23514', message = 'poll_definition_requires_poll_content';
  end if;

  if v_media_type = 'text'
     and v_publish_state not in ('draft', 'unpublished')
     and v_body_text is null then
    raise exception using errcode = '23514', message = 'text_body_required';
  end if;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

create constraint trigger content_items_enforce_poll_shape
after insert or update of media_type, publish_state, body_text on content_items
deferrable initially deferred
for each row execute function private.enforce_poll_shape();

create constraint trigger content_polls_enforce_shape
after insert or update or delete on content_polls
deferrable initially deferred
for each row execute function private.enforce_poll_shape();

create constraint trigger content_poll_options_enforce_shape
after insert or update or delete on content_poll_options
deferrable initially deferred
for each row execute function private.enforce_poll_shape();
