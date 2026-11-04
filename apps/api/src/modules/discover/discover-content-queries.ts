import type postgres from "postgres";
import { keysetPage } from "../../shared/keyset-pagination.js";
import {
  accessStateForRule,
  toContentItem
} from "../content/content-repository-mappers.js";
import type { ContentDetailRow } from "../content/content-repository-rows.js";
import {
  decodeContentCursor,
  encodeContentCursor
} from "./discover-cursor.js";
import { normalizeSearch } from "./discover-repository-mappers.js";
import type { ContentItem } from "./types.js";

export interface DiscoverListInput {
  supabaseUserId: string;
  query?: string | undefined;
  slug?: string | undefined;
  cursor?: string | undefined;
  limit: number;
}

type DiscoverContentRow = ContentDetailRow & { created_at: Date };

export async function listContent(
  sql: postgres.Sql,
  input: DiscoverListInput
): Promise<{ items: ContentItem[]; nextCursor: string | null }> {
  const search = normalizeSearch(input.query);
  const cursor = decodeContentCursor(input.cursor);
  const rows = await sql<DiscoverContentRow[]>`
    with viewer as (
      select id
      from users
      where supabase_user_id = ${input.supabaseUserId}
      limit 1
    )
    select
      ci.id,
      ci.media_type,
      ci.distribution_mode,
      ci.expires_at,
      ci.scheduled_for,
      ci.caption,
      ci.body_text,
      ci.asset_revision,
      ci.nsfw_label,
      ci.created_at,
      creator.id as creator_id,
      p.handle,
      p.display_name,
      p.avatar_url,
      creator.id = (select id from viewer) as viewer_is_creator,
      ma.poster_url,
      ma.playback_url,
      ma.provider,
      ma.provider_state,
      ma.provider_playable,
      universal_assets.media_assets,
      poll_projection.poll,
      car.access_type,
      car.product_type,
      eg.id as entitlement_id,
      eg.state as entitlement_state,
      eg.granted_at as entitlement_granted_at,
      eg.ends_at as entitlement_ends_at,
      exists (
        select 1
        from content_reactions cr
        where cr.content_item_id = ci.id
          and cr.user_id = (select id from viewer)
          and cr.reaction_key = 'like'
          and cr.state = 'active'
      ) as liked,
      exists (
        select 1
        from content_saves cs
        where cs.content_item_id = ci.id
          and cs.user_id = (select id from viewer)
          and cs.state = 'active'
      ) as saved,
      (
        select count(*)
        from content_reactions cr
        where cr.content_item_id = ci.id
          and cr.reaction_key = 'like'
          and cr.state = 'active'
      ) as like_count,
      (
        select count(*)
        from comments c
        where c.content_item_id = ci.id
          and c.moderation_state = 'visible'
      ) as comment_count,
      (
        select count(*)
        from share_records sr
        where sr.target_type = 'content'
          and sr.target_id = ci.id
          and sr.state = 'created'
      ) as share_count
    from content_items ci
    join viewer on true
    join private.eligible_content(viewer.id, null) eligible
      on eligible.content_item_id = ci.id
    join users creator on creator.id = ci.creator_user_id
    join profiles p on p.user_id = creator.id
    left join lateral (
      select poster_url, playback_url, provider, provider_state, provider_playable
      from media_assets
      where id = ci.release_media_asset_id
        and content_item_id = ci.id
        and retired_at is null
      order by created_at asc
      limit 1
    ) ma on true
    left join lateral (
      select access_type, product_type
      from content_access_rules
      where content_item_id = ci.id
        and state = 'active'
        and (starts_at is null or starts_at <= now())
        and (ends_at is null or ends_at > now())
      order by created_at desc
      limit 1
    ) car on true
    left join lateral (
      select id, state, granted_at, ends_at
      from entitlements
      where user_id = (select id from viewer)
        and target_type = 'content'
        and target_id = ci.id
        and product_type = 'content_unlock'
        and state = 'active'
        and starts_at <= now()
        and (ends_at is null or ends_at > now())
      order by granted_at desc
      limit 1
    ) eg on true
    left join lateral (
      select coalesce(jsonb_agg(
        jsonb_build_object(
          'id', asset.id,
          'kind', asset.asset_kind,
          'position', asset.position,
          'provider', asset.provider,
          'providerState', asset.provider_state,
          'playbackUrl', asset.playback_url,
          'providerPlayable', asset.provider_playable,
          'providerAssetId', asset.provider_asset_id,
          'posterUrl', asset.poster_url,
          'mimeType', asset.mime_type,
          'widthPixels', asset.width_pixels,
          'heightPixels', asset.height_pixels,
          'durationMs', asset.duration_ms,
          'altText', asset.alt_text,
          'requiredForRelease', asset.required_for_release,
          'isCover', asset.is_cover,
          'focalPointX', asset.focal_point_x,
          'focalPointY', asset.focal_point_y,
          'originClassification', asset.origin_classification,
          'visibleLabelState', asset.visible_label_state,
          'provenanceReviewState', asset.provenance_human_review_state,
          'machineReadableMarkingState', asset.machine_readable_marking_state
        )
        order by asset.position
      ), '[]'::jsonb) as media_assets
      from media_assets asset
      where asset.content_item_id = ci.id
        and asset.retired_at is null
    ) universal_assets on true
    left join lateral (
      select jsonb_build_object(
        'question', poll.question,
        'options', coalesce((
          select jsonb_agg(
            jsonb_build_object(
              'id', option.id,
              'position', option.position,
              'text', option.option_text,
              'voteCount', option.vote_count
            )
            order by option.position
          )
          from content_poll_options option
          where option.content_item_id = poll.content_item_id
        ), '[]'::jsonb),
        'state', poll.state,
        'totalVoteCount', coalesce((
          select sum(option.vote_count)
          from content_poll_options option
          where option.content_item_id = poll.content_item_id
        ), 0),
        'closesAt', poll.closes_at,
        'viewerOptionId', viewer_vote.option_id
      ) as poll
      from content_polls poll
      left join content_poll_votes viewer_vote
        on viewer_vote.content_item_id = poll.content_item_id
        and viewer_vote.voter_user_id = (select id from viewer)
      where poll.content_item_id = ci.id
    ) poll_projection on true
    where (
        ${cursor?.createdAt ?? null}::timestamptz is null
        or (ci.created_at, ci.id) < (
          ${cursor?.createdAt ?? null}::timestamptz,
          ${cursor?.id ?? null}::uuid
        )
      )
      and (
        ${search}::text is null
        or ci.caption ilike '%' || ${search} || '%'
        or ci.body_text ilike '%' || ${search} || '%'
        or p.handle ilike '%' || ${search} || '%'
        or exists (
          select 1
          from content_hashtags ch
          join hashtags h on h.id = ch.hashtag_id
          where ch.content_item_id = ci.id
            and h.state in ('active', 'restricted')
            and h.slug ilike '%' || ${search} || '%'
        )
      )
      and (
        ${input.slug ?? null}::text is null
        or exists (
          select 1
          from content_hashtags ch
          join hashtags h on h.id = ch.hashtag_id
          where ch.content_item_id = ci.id
            and h.slug = ${input.slug ?? null}
            and h.state in ('active', 'restricted')
        )
      )
    order by ci.created_at desc, ci.id desc
    limit ${input.limit + 1}
  `;

  return keysetPage(
    rows,
    input.limit,
    (row) => toContentItem(row, row.poster_url, accessStateForRule(row)),
    (row) => encodeContentCursor(row.created_at, row.id)
  );
}
