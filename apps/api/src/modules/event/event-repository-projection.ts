import type postgres from "postgres";
import type { Event } from "./types.js";
import { EventRepositoryConfigurationError } from "./event-errors.js";
import { toTicketType } from "./event-repository-mappers.js";
import type { EventRow, TicketTypeRow } from "./event-repository-rows.js";

export function eventSelectSql(sql: postgres.Sql) {
  return sql`
    select
      e.id,
      e.title,
      e.description,
      e.starts_at,
      e.ends_at,
      e.access_rule,
      e.location_type,
      e.location_label,
      e.location_lat,
      e.location_lng,
      e.state,
      e.request_hash
    from events e
  `;
}

export async function eventFromRows(
  sql: postgres.Sql,
  rows: EventRow[],
  requestHash?: string
): Promise<Event & { requestHash?: string }> {
  const row = rows[0];

  if (!row) {
    throw new EventRepositoryConfigurationError();
  }

  const ticketRows = await sql<TicketTypeRow[]>`
    select
      tt.id,
      tt.event_id,
      tt.label,
      tt.price_minor,
      tt.currency,
      tt.capacity,
      count(te.id) filter (where te.state in ('active', 'checked_in')) as issued_count,
      tt.sale_starts_at,
      tt.sale_ends_at,
      tt.per_user_limit,
      tt.state
    from event_access_pass_types tt
    left join event_access_passes te on te.access_pass_type_id = tt.id
    where tt.event_id = ${row.id}
    group by tt.id
    order by tt.created_at asc
  `;

  return {
    id: row.id,
    title: row.title,
    description: row.description,
    startsAt: row.starts_at.toISOString(),
    endsAt: row.ends_at?.toISOString() ?? null,
    accessRule: row.access_rule,
    location: {
      type: row.location_type,
      ...(row.location_label ? { label: row.location_label } : {}),
      ...(row.location_lat !== null ? { latitude: Number(row.location_lat) } : {}),
      ...(row.location_lng !== null ? { longitude: Number(row.location_lng) } : {})
    },
    state: row.state,
    ticketTypes: ticketRows.map(toTicketType),
    ...(requestHash ?? row.request_hash ? { requestHash: requestHash ?? row.request_hash } : {})
  };
}
