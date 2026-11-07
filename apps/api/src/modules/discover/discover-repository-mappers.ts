import type { Event, User } from "./types.js";
import type { CreatorRow, EventRow } from "./discover-repository-rows.js";

export function normalizeSearch(query: string | undefined): string | null {
  const normalized = query?.trim().replace(/^#/, "").toLowerCase();

  return normalized && normalized.length > 0 ? normalized.slice(0, 80) : null;
}

export function toUser(row: CreatorRow): User {
  return {
    id: row.id,
    handle: row.handle ?? "",
    displayName: row.display_name ?? "",
    avatarUrl: row.avatar_url,
    badges: []
  };
}

export function toEvent(row: EventRow): Event {
  const accessPassTypes = Array.isArray(row.access_pass_types) ? row.access_pass_types : [];
  const location: Event["location"] = {
    type: row.location_type,
    ...(row.location_label ? { label: row.location_label } : {}),
    ...(row.location_lat === null ? {} : { latitude: Number(row.location_lat) }),
    ...(row.location_lng === null ? {} : { longitude: Number(row.location_lng) })
  };

  return {
    id: row.id,
    title: row.title,
    description: row.description,
    startsAt: row.starts_at.toISOString(),
    endsAt: row.ends_at?.toISOString() ?? null,
    accessRule: row.access_rule,
    location,
    state: row.state,
    accessPassTypes: accessPassTypes as Event["accessPassTypes"]
  };
}
