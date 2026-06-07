import { randomUUID } from "node:crypto";
import type postgres from "postgres";

export async function ensureLiveReplayContent(
  transaction: postgres.TransactionSql,
  input: {
    roomId: string;
    providerAssetId: string;
    providerPlaybackId: string | null | undefined;
    playbackUrl: string | null | undefined;
  }
): Promise<void> {
  const contentId = randomUUID();
  const mediaAssetId = randomUUID();

  await transaction`
    with room as (
      select id, creator_user_id, title, replay_content_item_id
      from live_rooms
      where id = ${input.roomId}
      for update
    ),
    inserted_content as (
      insert into content_items (
        id,
        creator_user_id,
        media_type,
        state,
        caption,
        visibility,
        nsfw_label,
        moderation_state
      )
      select
        ${contentId},
        creator_user_id,
        'live_replay',
        'processing',
        title,
        'private',
        'none',
        'pending'
      from room
      where replay_content_item_id is null
      returning id
    ),
    target_content as (
      select replay_content_item_id as id
      from room
      where replay_content_item_id is not null
      union all
      select id
      from inserted_content
      limit 1
    ),
    linked_room as (
      update live_rooms
      set
        replay_content_item_id = (select id from target_content),
        updated_at = now()
      where id = ${input.roomId}
        and replay_content_item_id is null
      returning replay_content_item_id
    ),
    upserted_replay as (
      insert into live_replay_assets (
        id,
        room_id,
        content_item_id,
        provider_asset_id,
        provider_playback_id,
        state,
        playback_url,
        ready_at
      )
      select
        ${randomUUID()},
        ${input.roomId},
        id,
        ${input.providerAssetId},
        ${input.providerPlaybackId ?? null},
        'ready',
        ${input.playbackUrl ?? null},
        now()
      from target_content
      on conflict (room_id, provider_asset_id) do update
      set
        content_item_id = coalesce(live_replay_assets.content_item_id, excluded.content_item_id),
        provider_playback_id = excluded.provider_playback_id,
        state = 'ready',
        playback_url = excluded.playback_url,
        ready_at = coalesce(live_replay_assets.ready_at, excluded.ready_at)
      returning content_item_id
    )
    insert into media_assets (
      id,
      content_item_id,
      provider,
      provider_asset_id,
      provider_state,
      playback_url,
      provider_playable,
      ready_at
    )
    select
      ${mediaAssetId},
      content_item_id,
      'livepeer',
      ${input.providerAssetId},
      'ready',
      ${input.playbackUrl ?? null},
      true,
      now()
    from upserted_replay
    on conflict (provider, provider_asset_id) do update
    set
      provider_state = excluded.provider_state,
      playback_url = excluded.playback_url,
      provider_playable = true,
      ready_at = coalesce(media_assets.ready_at, excluded.ready_at)
  `;

  await transaction`
    insert into audit_events (
      id,
      actor_user_id,
      subject_type,
      subject_id,
      action,
      metadata
    )
    select
      ${randomUUID()},
      creator_user_id,
      'live_room',
      id,
      'live_replay_handoff_ready',
      ${transaction.json({
        provider: "livepeer",
        providerAssetId: input.providerAssetId,
        providerPlaybackId: input.providerPlaybackId ?? null
      })}
    from live_rooms
    where id = ${input.roomId}
  `;
}
