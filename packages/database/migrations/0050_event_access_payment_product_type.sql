-- Canonicalize Event Access payment product naming.
-- payment_intents.product_type is text, so this is a deterministic data cleanup.

update payment_intents
set product_type = 'event_access_pass'
where product_type = 'event_ticket';
