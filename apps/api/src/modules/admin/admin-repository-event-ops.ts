import type postgres from "postgres";
import type { AdminRepository, AdminMutualsSafety } from "./types.js";
import {
  EventRow,
  EventAccessPassTypeRow,
  AccessPassRow,
  LiveRoomRow,
  MediaAssetRow,
  AgeCheckRow,
  IdentityCheckRow,
  AiSessionRow,
  AiToolCallRow,
  pageSize,
  page,
  cursorFor,
  toEvent,
  toEventAccessPass,
  toLiveRoom,
  toMediaAsset,
  toAgeCheck,
  toIdentityCheck,
  toAiSession,
  toAiToolCall
} from "./admin-repository-mappers.js";

export function createEventOpsRepository(
  sql: postgres.Sql
): Pick<AdminRepository, "listEvents" | "listAccessPasses" | "listLiveRooms" | "listMediaAssets" | "listAgeChecks" | "listIdentityChecks" | "listAiSessions" | "listAiToolCalls" | "getMutualsSafety"> {
  return {
    async listEvents(input) {
      const eventRows = await sql<EventRow[]>`
        select
          id,
          title,
          description,
          starts_at,
          ends_at,
          access_rule,
          location_type,
          location_label,
          location_lat::text,
          location_lng::text,
          state,
          created_at
        from events
        where (${input.cursor ?? null}::timestamptz is null or starts_at < ${input.cursor ?? null}::timestamptz)
        order by starts_at desc
        limit ${pageSize + 1}
      `;
      const visibleRows = eventRows.slice(0, pageSize);
      const eventIds = visibleRows.map((row) => row.id);
      const accessPassRows =
        eventIds.length > 0
          ? await sql<EventAccessPassTypeRow[]>`
              select
                tt.id,
                tt.event_id,
                tt.label,
                tt.price_minor,
                tt.currency,
                tt.capacity,
                tt.sale_starts_at,
                tt.sale_ends_at,
                tt.per_user_limit,
                tt.state,
                count(te.id) as issued_count
              from event_access_pass_types tt
              left join event_access_passes te
                on te.access_pass_type_id = tt.id
                and te.state in ('active', 'checked_in')
              where tt.event_id in ${sql(eventIds)}
              group by tt.id
              order by tt.created_at asc
            `
          : [];
      const accessPassTypesByEvent = new Map<string, EventAccessPassTypeRow[]>();
      for (const row of accessPassRows) {
        const rows = accessPassTypesByEvent.get(row.event_id) ?? [];
        rows.push(row);
        accessPassTypesByEvent.set(row.event_id, rows);
      }

      return {
        items: visibleRows.map((row) => toEvent(row, accessPassTypesByEvent.get(row.id) ?? [])),
        nextCursor: cursorFor(eventRows.length > pageSize ? eventRows[pageSize] : null)
      };
    },
    async listAccessPasses(input) {
      const rows = await sql<AccessPassRow[]>`
        select
          id,
          event_id,
          access_pass_type_id,
          holder_user_id,
          payment_intent_id,
          state,
          checked_in_at,
          created_at
        from event_access_passes
        where (${input.cursor ?? null}::timestamptz is null or created_at < ${input.cursor ?? null}::timestamptz)
        order by created_at desc
        limit ${pageSize + 1}
      `;

      return page(rows, toEventAccessPass);
    },
    async listLiveRooms(input) {
      const rows = await sql<LiveRoomRow[]>`
        select
          id,
          creator_user_id,
          title,
          provider,
          provider_stream_id,
          provider_playback_id,
          provider_state,
          state,
          access_rule,
          pass_price_minor,
          currency,
          (playback_url is not null) as has_playback_url,
          (host_stream_key is not null) as has_host_stream_key,
          starts_at,
          ended_at,
          created_at,
          updated_at
        from live_rooms
        where (${input.cursor ?? null}::timestamptz is null or created_at < ${input.cursor ?? null}::timestamptz)
        order by created_at desc
        limit ${pageSize + 1}
      `;

      return page(rows, toLiveRoom);
    },
    async listMediaAssets(input) {
      const rows = await sql<MediaAssetRow[]>`
        select
          id,
          content_item_id,
          provider,
          provider_asset_id,
          provider_state,
          provider_playable,
          (playback_url is not null) as has_playback_url,
          ready_at,
          provider_checked_at,
          created_at
        from media_assets
        where (${input.cursor ?? null}::timestamptz is null or created_at < ${input.cursor ?? null}::timestamptz)
        order by created_at desc
        limit ${pageSize + 1}
      `;

      return page(rows, toMediaAsset);
    },
    async listAgeChecks(input) {
      const rows = await sql<AgeCheckRow[]>`
        select
          id,
          user_id,
          provider,
          provider_reference,
          state,
          jurisdiction,
          rule,
          (provider_reference is not null and provider_reference <> '') as has_provider_reference,
          verified_at,
          expires_at,
          created_at
        from age_verifications
        where (${input.cursor ?? null}::timestamptz is null or created_at < ${input.cursor ?? null}::timestamptz)
        order by created_at desc
        limit ${pageSize + 1}
      `;

      return page(rows, toAgeCheck);
    },
    async listIdentityChecks(input) {
      const rows = await sql<IdentityCheckRow[]>`
        select
          id,
          user_id,
          provider,
          provider_reference,
          verification_type,
          state,
          country_code,
          document_type,
          liveness_state,
          wallet_ownership_state,
          (provider_reference is not null and provider_reference <> '') as has_provider_reference,
          (legal_name_hash is not null and legal_name_hash <> '') as has_legal_name_hash,
          verified_at,
          expires_at,
          created_at
        from identity_verifications
        where (${input.cursor ?? null}::timestamptz is null or created_at < ${input.cursor ?? null}::timestamptz)
        order by created_at desc
        limit ${pageSize + 1}
      `;

      return page(rows, toIdentityCheck);
    },
    async listAiSessions(input) {
      const rows = await sql<AiSessionRow[]>`
        select
          id,
          actor_user_id,
          scope,
          state,
          coalesce(array_length(allowed_tools, 1), 0) as allowed_tool_count,
          created_at,
          expires_at
        from ai_sessions
        where (${input.cursor ?? null}::timestamptz is null or created_at < ${input.cursor ?? null}::timestamptz)
        order by created_at desc
        limit ${pageSize + 1}
      `;

      return page(rows, toAiSession);
    },
    async listAiToolCalls(input) {
      const rows = await sql<AiToolCallRow[]>`
        select
          id,
          session_id,
          actor_user_id,
          scope,
          tool_name,
          state,
          confirmation_state,
          subject_type,
          subject_id,
          input_summary,
          output_summary,
          created_at
        from ai_tool_calls
        where (${input.cursor ?? null}::timestamptz is null or created_at < ${input.cursor ?? null}::timestamptz)
        order by created_at desc
        limit ${pageSize + 1}
      `;

      return page(rows, toAiToolCall);
    },
    async getMutualsSafety() {
      const rows = await sql<{
        open_reports: string | number;
        active_matches: string | number;
        stale_matches: string | number;
      }[]>`
        select
          0 as open_reports,
          count(*) filter (where state = 'active') as active_matches,
          count(*) filter (where state = 'stale') as stale_matches
        from mutuals
      `;
      const row = rows[0];

      return {
        openReports: Number(row?.open_reports ?? 0),
        activeMutuals: Number(row?.active_matches ?? 0),
        staleMutuals: Number(row?.stale_matches ?? 0),
        socialMoneyBoundary: "money_never_buys_people_visibility_matches_or_social_priority"
      } satisfies AdminMutualsSafety;
    },
  };
}
