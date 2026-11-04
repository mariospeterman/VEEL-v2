import type { Event, Hashtag } from "./types.js";

export interface HashtagRow {
  slug: string;
  display_name: string;
  state: Hashtag["state"];
}

export interface CreatorRow {
  id: string;
  handle: string | null;
  display_name: string | null;
  avatar_url: string | null;
}

export interface EventRow {
  id: string;
  title: string;
  description: string | null;
  starts_at: Date;
  ends_at: Date | null;
  access_rule: Event["accessRule"];
  location_type: NonNullable<Event["location"]>["type"];
  location_label: string | null;
  location_lat: string | number | null;
  location_lng: string | number | null;
  state: Event["state"];
  access_pass_types: unknown;
}
