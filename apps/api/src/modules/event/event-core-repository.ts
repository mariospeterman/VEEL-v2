import { randomUUID } from "node:crypto";
import type postgres from "postgres";
import type { EventRepository } from "./types.js";
import { EventIdempotencyConflictError } from "./event-errors.js";
import { stripRequestHash } from "./event-repository-mappers.js";
import { eventFromRows, eventSelectSql } from "./event-repository-projection.js";
import type { EventRow } from "./event-repository-rows.js";

export function createEventCoreRepositoryMethods(
  sql: postgres.Sql
): Pick<EventRepository, "createEvent" | "findEvent" | "updateEvent"> {
  return {
    async createEvent(input) {
      const rows = await sql<EventRow[]>`
        with creator as (
          select id
          from users
          where supabase_user_id = ${input.supabaseUserId}
          limit 1
        ),
        existing_event as (
          select e.*
          from events e
          join creator c on c.id = e.creator_user_id
          where e.idempotency_key = ${input.idempotencyKey}
          limit 1
        ),
        inserted_event as (
          insert into events (
            id,
            creator_user_id,
            title,
            description,
            starts_at,
            ends_at,
            event_type,
            location_type,
            location_label,
            location_lat,
            location_lng,
            access_rule,
            idempotency_key,
            request_hash
          )
          select
            ${randomUUID()},
            id,
            ${input.body.title.trim()},
            ${input.body.description?.trim() || null},
            ${input.body.startsAt},
            ${input.body.endsAt ?? null},
            ${input.body.location.type},
            ${input.body.location.type},
            ${input.body.location.label?.trim() || null},
            ${input.body.location.latitude ?? null},
            ${input.body.location.longitude ?? null},
            ${input.body.accessRule},
            ${input.idempotencyKey},
            ${input.requestHash}
          from creator
          where not exists (select 1 from existing_event)
          returning *
        ),
        selected_event as (
          select * from inserted_event
          union all
          select * from existing_event
          limit 1
        ),
        inserted_access_pass_types as (
          insert into event_access_pass_types (
            id,
            event_id,
            label,
            price_minor,
            currency,
            capacity,
            sale_starts_at,
            sale_ends_at,
            per_user_limit
          )
          select
            gen_random_uuid(),
            se.id,
            ticket_type->>'label',
            nullif(ticket_type->>'priceMinor', '')::bigint,
            ticket_type->>'currency',
            (ticket_type->>'capacity')::integer,
            nullif(ticket_type->>'saleStartsAt', '')::timestamptz,
            nullif(ticket_type->>'saleEndsAt', '')::timestamptz,
            coalesce((ticket_type->>'perUserLimit')::integer, 1)
          from selected_event se,
            jsonb_array_elements(${sql.json(input.body.ticketTypes)}::jsonb) ticket_type
          where exists (select 1 from inserted_event)
          returning id
        )
        ${eventSelectSql(sql)}
        join selected_event se on se.id = e.id
      `;
      const event = await eventFromRows(sql, rows);

      if (event.requestHash !== input.requestHash) {
        throw new EventIdempotencyConflictError();
      }

      return stripRequestHash(event);
    },
    async findEvent(input) {
      const rows = await sql<EventRow[]>`
        with actor as (
          select id
          from users
          where supabase_user_id = ${input.supabaseUserId}
          limit 1
        )
        ${eventSelectSql(sql)}
        where e.id = ${input.eventId}
          and (e.state = 'published' or e.creator_user_id = (select id from actor))
        limit 1
      `;

      return rows[0] ? stripRequestHash(await eventFromRows(sql, rows)) : null;
    },
    async updateEvent(input) {
      const rows = await sql<EventRow[]>`
        with actor as (
          select id
          from users
          where supabase_user_id = ${input.supabaseUserId}
          limit 1
        ),
        updated_event as (
          update events e
          set
            title = coalesce(${input.body.title?.trim() || null}, title),
            description = coalesce(${input.body.description?.trim() || null}, description),
            starts_at = coalesce(${input.body.startsAt ?? null}, starts_at),
            ends_at = coalesce(${input.body.endsAt ?? null}, ends_at),
            access_rule = coalesce(${input.body.accessRule ?? null}, access_rule),
            location_type = coalesce(${input.body.location?.type ?? null}, location_type),
            location_label = coalesce(${input.body.location?.label?.trim() || null}, location_label),
            location_lat = coalesce(${input.body.location?.latitude ?? null}, location_lat),
            location_lng = coalesce(${input.body.location?.longitude ?? null}, location_lng),
            state = coalesce(${input.body.state ?? null}, state),
            updated_at = now()
          from actor
          where e.id = ${input.eventId}
            and e.creator_user_id = actor.id
          returning e.*
        )
        ${eventSelectSql(sql)}
        join updated_event ue on ue.id = e.id
      `;

      return rows[0] ? stripRequestHash(await eventFromRows(sql, rows)) : null;
    }
  };
}
