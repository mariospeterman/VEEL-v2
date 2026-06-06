import { createHash, randomUUID } from "node:crypto";
import postgres from "postgres";
import type {
  Event,
  EventRepository,
  EventTicketType,
  Ticket,
  TicketOffer,
  TicketRequest
} from "./types.js";

export class EventRepositoryConfigurationError extends Error {
  constructor() {
    super("DATABASE_URL_NOT_CONFIGURED");
    this.name = "EventRepositoryConfigurationError";
  }
}

export class EventIdempotencyConflictError extends Error {
  constructor() {
    super("EVENT_IDEMPOTENCY_CONFLICT");
    this.name = "EventIdempotencyConflictError";
  }
}

interface EventRow {
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
  request_hash?: string;
}

interface TicketTypeRow {
  id: string;
  event_id: string;
  label: string;
  price_minor: string | number | null;
  currency: EventTicketType["currency"];
  capacity: number;
  issued_count: string | number;
  sale_starts_at: Date | null;
  sale_ends_at: Date | null;
  per_user_limit: number;
  state: EventTicketType["state"];
}

interface TicketRow {
  id: string;
  event_id: string;
  access_pass_type_id: string;
  holder_user_id: string;
  payment_intent_id: string | null;
  qr_token: string;
  state: Ticket["state"];
  checked_in_at: Date | null;
  created_at: Date;
}

interface TicketRequestRow {
  id: string;
  event_id: string;
  access_pass_type_id: string;
  state: TicketRequest["state"];
  created_at: Date;
}

export function createPostgresEventRepository(databaseUrl?: string): EventRepository {
  if (!databaseUrl) {
    return {
      async createEvent() {
        throw new EventRepositoryConfigurationError();
      },
      async findEvent() {
        throw new EventRepositoryConfigurationError();
      },
      async updateEvent() {
        throw new EventRepositoryConfigurationError();
      },
      async findTicketOffer() {
        throw new EventRepositoryConfigurationError();
      },
      async recordTicketPurchaseRequest() {
        throw new EventRepositoryConfigurationError();
      },
      async grantFreeTicket() {
        throw new EventRepositoryConfigurationError();
      },
      async createTicketRequest() {
        throw new EventRepositoryConfigurationError();
      },
      async checkInTicket() {
        throw new EventRepositoryConfigurationError();
      },
      async listTickets() {
        throw new EventRepositoryConfigurationError();
      }
    };
  }

  const sql = postgres(databaseUrl, {
    max: 5,
    idle_timeout: 20,
    prepare: false
  });

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
        inserted_ticket_types as (
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
    },
    async findTicketOffer(input) {
      const event = await this.findEvent({
        supabaseUserId: input.supabaseUserId,
        eventId: input.eventId
      });

      if (!event || event.state !== "published") {
        return null;
      }

      const ticketType = event.ticketTypes.find((candidate) => candidate.id === input.ticketTypeId);

      if (!ticketType || ticketType.state !== "active") {
        return null;
      }

      const ticketRows = await sql<TicketRow[]>`
        with actor as (
          select id
          from users
          where supabase_user_id = ${input.supabaseUserId}
          limit 1
        )
        select
          te.id,
          te.event_id,
          te.access_pass_type_id,
          te.holder_user_id,
          te.payment_intent_id,
          te.qr_token,
          te.state,
          te.checked_in_at,
          te.created_at
        from event_access_passes te
        join actor on actor.id = te.holder_user_id
        where te.event_id = ${input.eventId}
          and te.access_pass_type_id = ${input.ticketTypeId}
          and te.state in ('active', 'checked_in')
        order by te.created_at desc
        limit 1
      `;

      return {
        event,
        ticketType,
        alreadyIssuedTicket: ticketRows[0] ? toTicket(ticketRows[0]) : null
      } satisfies TicketOffer;
    },
    async recordTicketPurchaseRequest(input) {
      await sql`
        with buyer as (
          select id
          from users
          where supabase_user_id = ${input.supabaseUserId}
          limit 1
        )
        insert into event_access_purchase_requests (
          payment_intent_id,
          event_id,
          access_pass_type_id,
          buyer_user_id,
          amount_minor,
          currency
        )
        select
          ${input.paymentIntentId},
          ${input.eventId},
          ${input.ticketTypeId},
          id,
          ${input.amountMinor},
          ${input.currency}
        from buyer
        on conflict (payment_intent_id) do nothing
      `;
    },
    async grantFreeTicket(input) {
      const rows = await grantTicket(sql, {
        supabaseUserId: input.supabaseUserId,
        eventId: input.eventId,
        ticketTypeId: input.ticketTypeId,
        paymentIntentId: null
      });

      return rows[0] ? toTicket(rows[0]) : null;
    },
    async createTicketRequest(input) {
      const rows = await sql<TicketRequestRow[]>`
        with requester as (
          select id
          from users
          where supabase_user_id = ${input.supabaseUserId}
          limit 1
        )
        insert into event_access_requests (
          id,
          event_id,
          access_pass_type_id,
          requester_user_id,
          note
        )
        select
          ${randomUUID()},
          ${input.eventId},
          ${input.ticketTypeId},
          id,
          ${input.note ?? null}
        from requester
        on conflict (event_id, access_pass_type_id, requester_user_id) do update
        set note = coalesce(excluded.note, event_access_requests.note)
        returning id, event_id, access_pass_type_id, state, created_at
      `;

      return rows[0] ? toTicketRequest(rows[0]) : null;
    },
    async checkInTicket(input) {
      const rows = await sql<TicketRow[]>`
        with actor as (
          select id
          from users
          where supabase_user_id = ${input.supabaseUserId}
          limit 1
        ),
        matched_ticket as (
          select te.*
          from event_access_passes te
          join events e on e.id = te.event_id
          where te.id = ${input.ticketId}
            and te.qr_token_hash = ${hashQrToken(input.qrToken)}
            and (e.creator_user_id = (select id from actor) or private.is_staff_member())
          limit 1
        ),
        updated_ticket as (
          update event_access_passes te
          set
            state = case when state = 'active' then 'checked_in' else state end,
            checked_in_at = case when state = 'active' then now() else checked_in_at end,
            updated_at = now()
          from matched_ticket mt
          where te.id = mt.id
            and te.state in ('active', 'checked_in')
          returning te.*
        )
        select
          id,
          event_id,
          access_pass_type_id,
          holder_user_id,
          payment_intent_id,
          qr_token,
          state,
          checked_in_at,
          created_at
        from updated_ticket
      `;

      return rows[0] ? toTicket(rows[0]) : null;
    },
    async listTickets(input) {
      const rows = await sql<TicketRow[]>`
        with actor as (
          select id
          from users
          where supabase_user_id = ${input.supabaseUserId}
          limit 1
        )
        select
          te.id,
          te.event_id,
          te.access_pass_type_id,
          te.holder_user_id,
          te.payment_intent_id,
          te.qr_token,
          te.state,
          te.checked_in_at,
          te.created_at
        from event_access_passes te
        join actor on actor.id = te.holder_user_id
        where (${input.cursor ?? null}::timestamptz is null or te.created_at < ${input.cursor ?? null}::timestamptz)
        order by te.created_at desc
        limit ${input.limit + 1}
      `;

      const pageRows = rows.slice(0, input.limit);
      const extraRow = rows[input.limit];

      return {
        items: pageRows.map(toTicket),
        nextCursor: extraRow ? extraRow.created_at.toISOString() : null
      };
    },
    async close() {
      await sql.end({ timeout: 5 });
    }
  };
}

function eventSelectSql(sql: postgres.Sql) {
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

async function eventFromRows(
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

function stripRequestHash(event: Event & { requestHash?: string }): Event {
  const { requestHash: _requestHash, ...publicEvent } = event;
  return publicEvent;
}

function toTicketType(row: TicketTypeRow): EventTicketType {
  const issued = Number(row.issued_count);

  return {
    id: row.id,
    label: row.label,
    priceMinor: row.price_minor === null ? null : Number(row.price_minor),
    currency: row.currency,
    capacity: row.capacity,
    remaining: Math.max(row.capacity - issued, 0),
    state: issued >= row.capacity ? "sold_out" : row.state,
    saleStartsAt: row.sale_starts_at?.toISOString() ?? null,
    saleEndsAt: row.sale_ends_at?.toISOString() ?? null,
    perUserLimit: row.per_user_limit
  };
}

function toTicket(row: TicketRow): Ticket {
  return {
    id: row.id,
    eventId: row.event_id,
    ticketTypeId: row.access_pass_type_id,
    holderUserId: row.holder_user_id,
    paymentIntentId: row.payment_intent_id,
    state: row.state,
    qrToken: row.qr_token,
    checkedInAt: row.checked_in_at?.toISOString() ?? null,
    createdAt: row.created_at.toISOString()
  };
}

function toTicketRequest(row: TicketRequestRow): TicketRequest {
  return {
    id: row.id,
    eventId: row.event_id,
    ticketTypeId: row.access_pass_type_id,
    state: row.state,
    createdAt: row.created_at.toISOString()
  };
}

function newQrToken(): string {
  return `veel_ticket_${randomUUID().replaceAll("-", "")}`;
}

function hashQrToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

async function grantTicket(
  sql: postgres.Sql,
  input: {
    supabaseUserId: string;
    eventId: string;
    ticketTypeId: string;
    paymentIntentId: string | null;
  }
): Promise<TicketRow[]> {
  const qrToken = newQrToken();

  return sql<TicketRow[]>`
    with holder as (
      select id
      from users
      where supabase_user_id = ${input.supabaseUserId}
      limit 1
    ),
    existing_ticket as (
      select
        te.id,
        te.event_id,
        te.access_pass_type_id,
        te.holder_user_id,
        te.payment_intent_id,
        te.qr_token,
        te.state,
        te.checked_in_at,
        te.created_at
      from event_access_passes te
      join holder on holder.id = te.holder_user_id
      where te.event_id = ${input.eventId}
        and te.access_pass_type_id = ${input.ticketTypeId}
        and te.state in ('active', 'checked_in')
      limit 1
    ),
    ticket_lock as (
      select pg_advisory_xact_lock(hashtextextended(${input.ticketTypeId}, 0))
    ),
    inventory as (
      select
        tt.id,
        tt.event_id,
        tt.capacity,
        count(te.id) filter (where te.state in ('active', 'checked_in')) as issued_count
      from event_access_pass_types tt
      cross join ticket_lock
      left join event_access_passes te on te.access_pass_type_id = tt.id
      where tt.id = ${input.ticketTypeId}
        and tt.event_id = ${input.eventId}
        and tt.state = 'active'
        and not exists (select 1 from existing_ticket)
      group by tt.id
      having count(te.id) filter (where te.state in ('active', 'checked_in')) < tt.capacity
      limit 1
    ),
    inserted_ticket as (
      insert into event_access_passes (
        id,
        event_id,
        access_pass_type_id,
        holder_user_id,
        payment_intent_id,
        qr_token,
        qr_token_hash
      )
      select
        ${randomUUID()},
        inventory.event_id,
        inventory.id,
        holder.id,
        ${input.paymentIntentId},
        ${qrToken},
        ${hashQrToken(qrToken)}
      from holder, inventory
      on conflict (payment_intent_id) do update
      set state = event_access_passes.state
      returning *
    )
    select
      id,
      event_id,
      access_pass_type_id,
      holder_user_id,
      payment_intent_id,
      qr_token,
      state,
      checked_in_at,
      created_at
    from inserted_ticket
    union all
    select
      id,
      event_id,
      access_pass_type_id,
      holder_user_id,
      payment_intent_id,
      qr_token,
      state,
      checked_in_at,
      created_at
    from existing_ticket
    limit 1
  `;
}
