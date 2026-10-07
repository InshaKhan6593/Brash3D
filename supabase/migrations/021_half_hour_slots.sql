-- Half-hour slots, bookings that span several of them, and seller extensions.
--
-- Until now a slot was a whole hour and a booking was exactly one slot, so the
-- `disponible` flag on that one row was the whole truth. The client sells time
-- in half hours: an hour costs 20 USD, each further 30 minutes 10 USD, a
-- customer may book 1 h 30, and the seller may extend a live call by 30 minutes
-- when nothing is booked straight after it. Only one customer is served at a
-- time.
--
-- So `disponibilidad` becomes a 30-minute grid, and a reserva covers
-- `duracion_minutos` of it starting at its own `disponibilidad_id`. Which rows
-- a booking blocks is derived from those two facts, and a trigger keeps the
-- `disponible` flag in step with it -- every writer of a reserva (booking,
-- payment webhook, hold expiry, release, extension) frees or blocks the right
-- rows without each having to repeat the arithmetic.

ALTER TABLE reservas
  ADD COLUMN duracion_minutos smallint NOT NULL DEFAULT 60,
  ADD CONSTRAINT reservas_duracion_check CHECK (
    duracion_minutos BETWEEN 30 AND 720 AND duracion_minutos % 30 = 0
  );

-- What the seller added during the call, and what it costs. Kept on the
-- session, beside the rest of the invoice, at the price it was charged, so a
-- later price change cannot reprice an invoice already quoted.
ALTER TABLE sesiones_compra
  ADD COLUMN minutos_extension smallint NOT NULL DEFAULT 0,
  ADD COLUMN cargo_extension numeric(10, 2) NOT NULL DEFAULT 0,
  ADD CONSTRAINT sesiones_extension_check CHECK (
    minutos_extension >= 0 AND minutos_extension % 30 = 0 AND cargo_extension >= 0
  );

-- Every existing slot row now describes the first half of its hour.
UPDATE disponibilidad SET hora_fin = hora_inicio + interval '30 minutes';

-- Whether a booking still holding or owning time covers this half hour.
--
-- `time - time` yields an interval and never wraps at midnight, which
-- `hora_inicio + interval` would: 23:30 plus an hour is 00:30, earlier than the
-- start it was added to.
CREATE FUNCTION franja_ocupada(
  p_vendedor uuid,
  p_fecha date,
  p_hora time,
  p_excluir_reserva uuid DEFAULT NULL
) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT EXISTS (
    SELECT 1
    FROM reservas r
    JOIN disponibilidad f ON f.id = r.disponibilidad_id
    WHERE f.vendedor_id = p_vendedor
      AND f.fecha = p_fecha
      AND p_hora >= f.hora_inicio
      AND p_hora - f.hora_inicio < make_interval(mins => r.duracion_minutos)
      AND (p_excluir_reserva IS NULL OR r.id <> p_excluir_reserva)
      AND (
        r.estado IN ('confirmada', 'completada')
        OR (r.estado = 'pendiente_pago' AND r.hold_expires_at > now())
      )
  )
$$;

-- Recomputes the flag for the half hours a booking spans. Writes only the rows
-- whose flag actually changes, so it never touches -- or waits on -- a row
-- another booking has locked without changing.
CREATE FUNCTION sincronizar_franjas(
  p_vendedor uuid,
  p_fecha date,
  p_desde time,
  p_minutos integer
) RETURNS void
LANGUAGE sql AS $$
  UPDATE disponibilidad d
  SET disponible = NOT franja_ocupada(d.vendedor_id, d.fecha, d.hora_inicio)
  WHERE d.vendedor_id = p_vendedor
    AND d.fecha = p_fecha
    AND d.hora_inicio >= p_desde
    AND d.hora_inicio - p_desde < make_interval(mins => p_minutos)
    AND d.disponible IS DISTINCT FROM NOT franja_ocupada(d.vendedor_id, d.fecha, d.hora_inicio)
$$;

CREATE FUNCTION reservas_sincronizar_franjas() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  slot record;
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    SELECT vendedor_id, fecha, hora_inicio INTO slot FROM disponibilidad WHERE id = OLD.disponibilidad_id;
    IF FOUND THEN
      -- The longer of the two spans, so a booking that shrank frees its tail.
      PERFORM sincronizar_franjas(slot.vendedor_id, slot.fecha, slot.hora_inicio,
        GREATEST(OLD.duracion_minutos, CASE WHEN TG_OP = 'UPDATE' THEN NEW.duracion_minutos ELSE 0 END));
    END IF;
  END IF;
  IF TG_OP = 'INSERT'
    OR (TG_OP = 'UPDATE' AND NEW.disponibilidad_id IS DISTINCT FROM OLD.disponibilidad_id) THEN
    SELECT vendedor_id, fecha, hora_inicio INTO slot FROM disponibilidad WHERE id = NEW.disponibilidad_id;
    IF FOUND THEN
      PERFORM sincronizar_franjas(slot.vendedor_id, slot.fecha, slot.hora_inicio, NEW.duracion_minutos);
    END IF;
  END IF;
  RETURN NULL;
END
$$;

CREATE TRIGGER reservas_sincronizar_franjas
  AFTER INSERT OR DELETE OR UPDATE OF estado, hold_expires_at, duracion_minutos, disponibilidad_id
  ON reservas
  FOR EACH ROW EXECUTE FUNCTION reservas_sincronizar_franjas();

-- Existing bookings are an hour each (the column default). The half hours they
-- now cover are generated on the next read of the slot list, and that insert
-- computes the flag with `franja_ocupada`, so they arrive already blocked.
-- Bring the rows that exist today in line now.
UPDATE disponibilidad d
SET disponible = NOT franja_ocupada(d.vendedor_id, d.fecha, d.hora_inicio)
WHERE d.fecha >= current_date
  AND d.disponible IS DISTINCT FROM NOT franja_ocupada(d.vendedor_id, d.fecha, d.hora_inicio);
