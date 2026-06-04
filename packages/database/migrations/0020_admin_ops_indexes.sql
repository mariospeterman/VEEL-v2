create index payment_intents_created_at_idx
  on payment_intents (created_at desc);

create index payment_intents_submitted_signature_idx
  on payment_intents (submitted_signature)
  where submitted_signature is not null;

create index entitlements_granted_at_idx
  on entitlements (granted_at desc);

create index provider_events_received_at_idx
  on provider_events (received_at desc);
