-- Admin organization member mutation workflow support.
-- Member mutations are software governance only: no balances, custody, payouts, ranking, or payment truth.

create index organization_memberships_admin_lookup_idx
  on organization_memberships (organization_id, id, state);

create index organization_memberships_recent_updates_idx
  on organization_memberships (organization_id, updated_at desc, created_at desc);
