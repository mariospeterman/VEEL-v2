update payment_intents
set product_type = 'event_ticket'
where product_type = 'event_access_pass';
