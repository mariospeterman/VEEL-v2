-- Content access projection foundation for media viewer surfaces.
-- Entitlement grants and payment settlement are added in later payment/unlock slices.

create table content_access_rules (
  id uuid primary key,
  content_item_id uuid not null references content_items(id),
  access_type text not null,
  product_type text,
  price_minor bigint,
  currency text,
  starts_at timestamptz,
  ends_at timestamptz,
  state text not null default 'active',
  created_at timestamptz not null default now()
);

create index content_access_rules_active_idx
  on content_access_rules (content_item_id, created_at desc)
  where state = 'active';
