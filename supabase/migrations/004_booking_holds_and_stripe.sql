-- Production-safe booking holds and idempotent Stripe webhook processing.

ALTER TABLE reservas
  ADD COLUMN hold_expires_at timestamptz,
  ADD COLUMN checkout_session_id varchar(255),
  ADD COLUMN confirmed_at timestamptz,
  ADD COLUMN cancellation_reason varchar(100);

UPDATE reservas
SET confirmed_at = COALESCE(updated_at, created_at)
WHERE estado IN ('confirmada', 'completada');

CREATE UNIQUE INDEX reservas_checkout_session_unique
  ON reservas (checkout_session_id)
  WHERE checkout_session_id IS NOT NULL;

CREATE INDEX reservas_active_hold_index
  ON reservas (disponibilidad_id, hold_expires_at)
  WHERE estado = 'pendiente_pago';

CREATE UNIQUE INDEX reservas_confirmed_slot_unique
  ON reservas (disponibilidad_id)
  WHERE estado IN ('confirmada', 'completada');

-- Pending legacy rows had no expiry and must not become permanent locks.
UPDATE reservas
SET estado = 'cancelada', cancellation_reason = 'legacy_pending_expired'
WHERE estado = 'pendiente_pago';

ALTER TABLE reservas
  ADD CONSTRAINT reservas_hold_state_check CHECK (
    (estado = 'pendiente_pago' AND hold_expires_at IS NOT NULL AND confirmed_at IS NULL)
    OR (estado IN ('confirmada', 'completada') AND confirmed_at IS NOT NULL)
    OR estado = 'cancelada'
  );

CREATE TABLE stripe_webhook_events (
  event_id varchar(255) PRIMARY KEY,
  event_type varchar(100) NOT NULL,
  processed_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX stripe_webhook_events_processed_index
  ON stripe_webhook_events (processed_at);

UPDATE disponibilidad d
SET disponible = NOT EXISTS (
  SELECT 1
  FROM reservas r
  WHERE r.disponibilidad_id = d.id
    AND (
      r.estado IN ('confirmada', 'completada')
      OR (r.estado = 'pendiente_pago' AND r.hold_expires_at > now())
    )
);
