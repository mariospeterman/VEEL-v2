drop function if exists private.incoming_verification_decision_is_current(
  text, uuid, text, text, timestamptz
);
drop function if exists private.current_verification_decision(text, uuid, text);
drop function if exists private.current_verification_decision_state(text, uuid, text);
