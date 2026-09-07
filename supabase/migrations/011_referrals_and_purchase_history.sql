-- Referral codes, one-time booking rewards, and the history lookup support
-- requested for the customer and seller experiences.

ALTER TABLE clientes
  ADD COLUMN IF NOT EXISTS codigo_referido varchar(32);

-- Existing customers need a shareable code too. The UUID prefix is stable,
-- easy to read, and unique for the practical lifetime of this MVP.
UPDATE clientes
SET codigo_referido = 'BR3D-' || upper(replace(left(id::text, 8), '-', ''))
WHERE codigo_referido IS NULL;

ALTER TABLE clientes
  ALTER COLUMN codigo_referido SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS clientes_codigo_referido_unique
  ON clientes (upper(codigo_referido));

-- reserva_aplicada_id identifies the referred customer's paid booking.
-- Keep the booking that spends the referrer's reward separately so the
-- reward ledger remains auditable.
ALTER TABLE referidos_recompensas
  ADD COLUMN IF NOT EXISTS reserva_recompensa_usada_id uuid REFERENCES reservas(id);

CREATE UNIQUE INDEX IF NOT EXISTS referidos_recompensas_booking_used_unique
  ON referidos_recompensas (reserva_recompensa_usada_id)
  WHERE reserva_recompensa_usada_id IS NOT NULL;

ALTER TABLE reservas
  ADD COLUMN IF NOT EXISTS recompensa_referido_id uuid REFERENCES referidos_recompensas(id);

CREATE UNIQUE INDEX IF NOT EXISTS reservas_recompensa_referido_unique
  ON reservas (recompensa_referido_id)
  WHERE recompensa_referido_id IS NOT NULL;
