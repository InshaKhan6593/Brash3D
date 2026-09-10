-- Configurable tax/commission rates, the Colombian local-invoice flag from the
-- specification, and supporting indexes for the monthly referral reward cap.

-- Section 14 of the specification: flag the occasional order that needs a local
-- Brash3D SAS invoice, without building a dual-invoicing system yet.
ALTER TABLE reservas
  ADD COLUMN IF NOT EXISTS requiere_factura_local boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS reservas_factura_local_index
  ON reservas (fecha_hora DESC)
  WHERE requiere_factura_local = true;

-- The rates are captured on the session itself so a later TAX_RATE_FL/FEE_RATE
-- change never silently reprices an invoice that was already quoted, and so the
-- customer view can label the exact percentage that was charged.
ALTER TABLE sesiones_compra
  ADD COLUMN IF NOT EXISTS tasa_impuesto numeric(6,4) NOT NULL DEFAULT 0.0700,
  ADD COLUMN IF NOT EXISTS tasa_comision numeric(6,4) NOT NULL DEFAULT 0.1500;

ALTER TABLE sesiones_compra
  ADD CONSTRAINT sesiones_rate_range_check CHECK (
    tasa_impuesto >= 0 AND tasa_impuesto < 1
    AND tasa_comision >= 0 AND tasa_comision < 1
  );

-- The cap counts rewards granted to one referrer inside the current month.
CREATE INDEX IF NOT EXISTS referidos_recompensas_referidor_month_index
  ON referidos_recompensas (referidor_id, created_at DESC);

-- A booking payment that lands after the hold expired is refunded automatically.
-- Staff still need to see that it happened, because the customer will ask.
ALTER TABLE staff_notifications DROP CONSTRAINT staff_notifications_type_check;
ALTER TABLE staff_notifications ADD CONSTRAINT staff_notifications_type_check CHECK (
  type IN (
    'booking_payment_confirmed',
    'initial_payment_confirmed',
    'final_payment_confirmed',
    'booking_payment_refunded'
  )
);
