import type postgres from "postgres";
import { bindCursorScope } from "../../shared/keyset-pagination.js";
import type { AdminRepository, AdminMutualsSafety } from "./types.js";
import { countOpenReports } from "./admin-report-authority.js";
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
  decodeTimestampIdCursor,
  encodeTimestampIdCursor,
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
      const cursorScope = bindCursorScope("GET /v1/admin/events", {
        sort: "starts_at:desc,id:desc"
      });
      const cursor = decodeTimestampIdCursor(cursorScope, input.cursor);
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
        where (
          ${cursor.timestamp}::timestamptz is null
          or starts_at < ${cursor.timestamp}::timestamptz
          or (
            starts_at = ${cursor.timestamp}::timestamptz
            and (${cursor.id}::uuid is null or id < ${cursor.id}::uuid)
          )
        )
        order by starts_at desc, id desc
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
        nextCursor: eventRows.length > pageSize && visibleRows.at(-1)
          ? encodeTimestampIdCursor(
              cursorScope,
              visibleRows[visibleRows.length - 1]!.starts_at,
              visibleRows[visibleRows.length - 1]!.id
            )
          : null
      };
    },
    async listAccessPasses(input) {
      const cursorScope = bindCursorScope("GET /v1/admin/event-access-passes", {
        sort: "created_at:desc,id:desc"
      });
      const cursor = decodeTimestampIdCursor(cursorScope, input.cursor);
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
        where (
          ${cursor.timestamp}::timestamptz is null
          or created_at < ${cursor.timestamp}::timestamptz
          or (
            created_at = ${cursor.timestamp}::timestamptz
            and (${cursor.id}::uuid is null or id < ${cursor.id}::uuid)
          )
        )
        order by created_at desc, id desc
        limit ${pageSize + 1}
      `;

      return page(rows, toEventAccessPass, (row) =>
        encodeTimestampIdCursor(cursorScope, row.created_at, row.id)
      );
    },
    async listLiveRooms(input) {
      const cursorScope = bindCursorScope("GET /v1/admin/live/rooms", {
        sort: "created_at:desc,id:desc"
      });
      const cursor = decodeTimestampIdCursor(cursorScope, input.cursor);
      const rows = await sql<LiveRoomRow[]>`
        select
          live_rooms.id,
          live_rooms.creator_user_id,
          live_rooms.title,
          live_rooms.provider,
          live_rooms.provider_stream_id,
          live_rooms.provider_playback_id,
          live_rooms.provider_state,
          live_rooms.state,
          live_rooms.access_rule,
          live_rooms.event_price_minor,
          live_rooms.currency,
          live_rooms.members_only_chat,
          live_rooms.members_included_in_paid_event,
          live_rooms.replay_window_hours,
          (live_rooms.playback_url is not null) as has_playback_url,
          (live_rooms.host_stream_key is not null) as has_host_stream_key,
          safety_session.state as monitoring_state,
          coalesce(
            safety_session.state = 'monitoring'
            and safety_session.heartbeat_expires_at > now()
            and safety_session.held_at is null,
            false
          ) as monitoring_healthy,
          safety_session.heartbeat_expires_at as monitoring_heartbeat_expires_at,
          safety_session.hold_reason_code as monitoring_hold_reason_code,
          exists (
            select 1 from live_safety_provider_actions provider_action
            where provider_action.room_id = live_rooms.id
              and provider_action.state in ('queued', 'processing', 'retry', 'dead_letter')
          ) as pending_provider_action,
          live_rooms.starts_at,
          live_rooms.ended_at,
          live_rooms.created_at,
          live_rooms.updated_at
        from live_rooms
        left join live_safety_sessions safety_session on safety_session.room_id = live_rooms.id
        where (
          ${cursor.timestamp}::timestamptz is null
          or live_rooms.created_at < ${cursor.timestamp}::timestamptz
          or (
            live_rooms.created_at = ${cursor.timestamp}::timestamptz
            and (${cursor.id}::uuid is null or live_rooms.id < ${cursor.id}::uuid)
          )
        )
        order by live_rooms.created_at desc, live_rooms.id desc
        limit ${pageSize + 1}
      `;

      const visibleRows = rows.slice(0, pageSize);
      const lastVisible = rows.length > pageSize ? visibleRows.at(-1) ?? null : null;
      return {
        items: visibleRows.map(toLiveRoom),
        nextCursor: lastVisible
          ? encodeTimestampIdCursor(cursorScope, lastVisible.created_at, lastVisible.id)
          : null
      };
    },
    async listMediaAssets(input) {
      const cursorScope = bindCursorScope("GET /v1/admin/media/assets", {
        sort: "created_at:desc,id:desc"
      });
      const cursor = decodeTimestampIdCursor(cursorScope, input.cursor);
      const rows = await sql<MediaAssetRow[]>`
        select
          id,
          content_item_id,
          asset_kind,
          position,
          provider,
          provider_asset_id,
          provider_state,
          provider_playable,
          (playback_url is not null) as has_playback_url,
          ready_at,
          provider_checked_at,
          retired_at,
          provider_cleanup_state,
          provider_cleanup_error_code,
          created_at
        from media_assets
        where (
          ${cursor.timestamp}::timestamptz is null
          or created_at < ${cursor.timestamp}::timestamptz
          or (
            created_at = ${cursor.timestamp}::timestamptz
            and (${cursor.id}::uuid is null or id < ${cursor.id}::uuid)
          )
        )
        order by created_at desc, id desc
        limit ${pageSize + 1}
      `;

      return page(rows, toMediaAsset, (row) =>
        encodeTimestampIdCursor(cursorScope, row.created_at, row.id)
      );
    },
    async listAgeChecks(input) {
      const cursorScope = bindCursorScope("GET /v1/admin/age-kyc/age-checks", {
        sort: "created_at:desc,id:desc"
      });
      const cursor = decodeTimestampIdCursor(cursorScope, input.cursor);
      const rows = await sql<AgeCheckRow[]>`
        select
          id,
          subject_id as user_id,
          provider,
          provider_reference,
          case
            when status = 'valid' and (expires_at is null or expires_at > now()) then 'verified'
            when status = 'pending' then 'pending'
            else 'failed'
          end as state,
          jurisdiction,
          metadata ->> 'rule' as rule,
          (provider_reference is not null and provider_reference <> '') as has_provider_reference,
          verified_at,
          expires_at,
          created_at
        from verification_records
        where subject_type = 'user'
          and purpose = 'age_access'
          and (
            ${cursor.timestamp}::timestamptz is null
            or created_at < ${cursor.timestamp}::timestamptz
            or (
              created_at = ${cursor.timestamp}::timestamptz
              and (${cursor.id}::uuid is null or id < ${cursor.id}::uuid)
            )
          )
        order by created_at desc, id desc
        limit ${pageSize + 1}
      `;

      return page(rows, toAgeCheck, (row) =>
        encodeTimestampIdCursor(cursorScope, row.created_at, row.id)
      );
    },
    async listIdentityChecks(input) {
      const cursorScope = bindCursorScope("GET /v1/admin/age-kyc/identity-checks", {
        sort: "created_at:desc,id:desc"
      });
      const cursor = decodeTimestampIdCursor(cursorScope, input.cursor);
      const rows = await sql<IdentityCheckRow[]>`
        select
          id,
          case when subject_type = 'user' then subject_id else null end as user_id,
          subject_type,
          subject_id,
          purpose,
          provider,
          coalesce(provider_reference, '') as provider_reference,
          case
            when purpose = 'age_access' then 'age'
            when purpose in ('org_kyb', 'enterprise_review') then 'kyb'
            else 'kyc'
          end as verification_type,
          case status
            when 'valid' then 'verified'
            when 'pending' then 'pending'
            when 'expired' then 'expired'
            when 'revoked' then 'cancelled'
            else 'failed'
          end as state,
          jurisdiction as country_code,
          method as document_type,
          null::text as liveness_state,
          null::text as wallet_ownership_state,
          (provider_reference is not null and provider_reference <> '') as has_provider_reference,
          false as has_legal_name_hash,
          verified_at,
          expires_at,
          created_at
        from verification_records
        where purpose <> 'age_access'
          and (
          ${cursor.timestamp}::timestamptz is null
          or created_at < ${cursor.timestamp}::timestamptz
          or (
            created_at = ${cursor.timestamp}::timestamptz
            and (${cursor.id}::uuid is null or id < ${cursor.id}::uuid)
          )
          )
        order by created_at desc, id desc
        limit ${pageSize + 1}
      `;

      return page(rows, toIdentityCheck, (row) =>
        encodeTimestampIdCursor(cursorScope, row.created_at, row.id)
      );
    },
    async listAiSessions(input) {
      const cursorScope = bindCursorScope("GET /v1/admin/ai/sessions", {
        sort: "created_at:desc,id:desc"
      });
      const cursor = decodeTimestampIdCursor(cursorScope, input.cursor);
      const rows = await sql<AiSessionRow[]>`
        with operation_sessions as (
          select
            session.id,
            session.actor_user_id,
            'assistant'::text as transport,
            null::uuid as connection_id,
            session.scope,
            session.state,
            coalesce(array_length(session.allowed_tools, 1), 0) as allowed_tool_count,
            null::text as client_name,
            null::text as client_type,
            null::text as auth_mode,
            array[]::text[] as granted_scopes,
            null::timestamptz as last_used_at,
            session.created_at,
            session.expires_at
          from ai_sessions session
          union all
          select
            connection.id,
            connection.actor_user_id,
            'mcp'::text as transport,
            connection.id as connection_id,
            connection.role_type as scope,
            case
              when connection.state = 'active' and connection.expires_at <= now() then 'expired'
              else connection.state
            end as state,
            0 as allowed_tool_count,
            connection.client_name,
            connection.client_type,
            connection.auth_mode,
            connection.scopes as granted_scopes,
            connection.last_used_at,
            connection.created_at,
            connection.expires_at
          from mcp_connections connection
        )
        select
          id,
          actor_user_id,
          transport,
          connection_id,
          scope,
          state,
          allowed_tool_count,
          client_name,
          client_type,
          auth_mode,
          granted_scopes,
          last_used_at,
          created_at,
          expires_at
        from operation_sessions
        where (
          ${cursor.timestamp}::timestamptz is null
          or created_at < ${cursor.timestamp}::timestamptz
          or (
            created_at = ${cursor.timestamp}::timestamptz
            and (${cursor.id}::uuid is null or id < ${cursor.id}::uuid)
          )
        )
        order by created_at desc, id desc
        limit ${pageSize + 1}
      `;

      return page(rows, toAiSession, (row) =>
        encodeTimestampIdCursor(cursorScope, row.created_at, row.id)
      );
    },
    async listAiToolCalls(input) {
      const cursorScope = bindCursorScope("GET /v1/admin/ai/tool-calls", {
        sort: "created_at:desc,id:desc"
      });
      const cursor = decodeTimestampIdCursor(cursorScope, input.cursor);
      const rows = await sql<AiToolCallRow[]>`
        with operation_tool_calls as (
          select
            tool_call.id,
            tool_call.session_id,
            null::uuid as connection_id,
            tool_call.actor_user_id,
            'assistant'::text as transport,
            tool_call.scope,
            tool_call.tool_name,
            null::text as tool_version,
            tool_call.state,
            tool_call.confirmation_state,
            null::text as risk_level,
            array[]::text[] as required_scopes,
            tool_call.subject_type,
            tool_call.subject_id,
            tool_call.input_summary,
            tool_call.output_summary,
            tool_call.created_at
          from ai_tool_calls tool_call
          union all
          select
            tool_call.id,
            tool_call.connection_id as session_id,
            tool_call.connection_id,
            tool_call.actor_user_id,
            'mcp'::text as transport,
            connection.role_type as scope,
            tool_call.tool_name,
            tool_call.tool_version,
            tool_call.state,
            'not_required'::text as confirmation_state,
            tool_call.risk_level,
            tool_call.required_scopes,
            null::text as subject_type,
            null::text as subject_id,
            tool_call.input_summary,
            tool_call.output_summary,
            tool_call.created_at
          from mcp_tool_calls tool_call
          join mcp_connections connection on connection.id = tool_call.connection_id
        )
        select
          id,
          session_id,
          connection_id,
          actor_user_id,
          transport,
          scope,
          tool_name,
          tool_version,
          state,
          confirmation_state,
          risk_level,
          required_scopes,
          subject_type,
          subject_id,
          input_summary,
          output_summary,
          created_at
        from operation_tool_calls
        where (
          ${cursor.timestamp}::timestamptz is null
          or created_at < ${cursor.timestamp}::timestamptz
          or (
            created_at = ${cursor.timestamp}::timestamptz
            and (${cursor.id}::uuid is null or id < ${cursor.id}::uuid)
          )
        )
        order by created_at desc, id desc
        limit ${pageSize + 1}
      `;

      return page(rows, toAiToolCall, (row) =>
        encodeTimestampIdCursor(cursorScope, row.created_at, row.id)
      );
    },
    async getMutualsSafety() {
      const [openReportCount, rows] = await Promise.all([
        countOpenReports(sql),
        sql<{
          active_matches: string | number;
          stale_matches: string | number;
        }[]>`
          select
            count(*) filter (where state = 'active') as active_matches,
            count(*) filter (where state = 'stale') as stale_matches
          from mutuals
        `
      ]);
      const row = rows[0];

      return {
        openReports: openReportCount,
        activeMutuals: Number(row?.active_matches ?? 0),
        staleMutuals: Number(row?.stale_matches ?? 0),
        socialMoneyBoundary: "money_never_buys_people_visibility_matches_or_social_priority"
      } satisfies AdminMutualsSafety;
    },
  };
}
