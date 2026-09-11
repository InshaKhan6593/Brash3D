-- Admin-controlled opening hours, replacing hard-coded slot generation.
--
-- Availability used to come from `generate_series(9, 18)` inside
-- ensureAvailability(): ten one-hour slots, every day of the week, for every
-- active seller, with no way to close a Sunday or a public holiday. These two
-- tables move that decision into data the admin panel can edit.
--
-- `horarios_plantilla` is the recurring week. `excepciones_calendario` overrides
-- one date — a holiday, an outlet closure, or a day with different hours.

CREATE TABLE horarios_plantilla (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  vendedor_id uuid NOT NULL REFERENCES vendedores(id) ON DELETE CASCADE,
  -- Matches EXTRACT(DOW): 0 = Sunday through 6 = Saturday.
  dia_semana smallint NOT NULL CHECK (dia_semana BETWEEN 0 AND 6),
  abierto boolean NOT NULL DEFAULT true,
  hora_apertura time NOT NULL DEFAULT '09:00',
  hora_cierre time NOT NULL DEFAULT '19:00',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (vendedor_id, dia_semana),
  -- Slots are whole hours, and a day must contain at least one.
  CONSTRAINT horarios_plantilla_rango_check CHECK (hora_cierre > hora_apertura),
  CONSTRAINT horarios_plantilla_horas_enteras_check CHECK (
    EXTRACT(MINUTE FROM hora_apertura) = 0 AND EXTRACT(SECOND FROM hora_apertura) = 0
    AND EXTRACT(MINUTE FROM hora_cierre) = 0 AND EXTRACT(SECOND FROM hora_cierre) = 0
  )
);

CREATE TABLE excepciones_calendario (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  vendedor_id uuid NOT NULL REFERENCES vendedores(id) ON DELETE CASCADE,
  fecha date NOT NULL,
  -- false closes the date outright; true reopens it, optionally with its own
  -- hours. NULL hours on an open exception fall back to the weekly template.
  abierto boolean NOT NULL DEFAULT false,
  hora_apertura time,
  hora_cierre time,
  motivo text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (vendedor_id, fecha),
  CONSTRAINT excepciones_rango_check CHECK (
    hora_apertura IS NULL OR hora_cierre IS NULL OR hora_cierre > hora_apertura
  ),
  -- A closed date cannot also carry hours; that combination has no meaning.
  CONSTRAINT excepciones_cerrado_sin_horas_check CHECK (
    abierto OR (hora_apertura IS NULL AND hora_cierre IS NULL)
  )
);

CREATE INDEX excepciones_calendario_fecha_index ON excepciones_calendario (vendedor_id, fecha);

CREATE TRIGGER update_horarios_plantilla_updated_at BEFORE UPDATE ON horarios_plantilla
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Seed every seller with the schedule that was hard-coded until now: all seven
-- days, 09:00 to 19:00, which is the ten slots generate_series(9, 18) produced.
-- Reproducing current behaviour exactly means this migration changes no
-- customer-visible availability; closing Sunday is then an admin decision made
-- in the panel, not a silent side effect of deploying.
INSERT INTO horarios_plantilla (vendedor_id, dia_semana, abierto, hora_apertura, hora_cierre)
SELECT v.id, d.dia, true, '09:00', '19:00'
FROM vendedores v
CROSS JOIN generate_series(0, 6) AS d(dia)
ON CONFLICT (vendedor_id, dia_semana) DO NOTHING;

ALTER TABLE horarios_plantilla ENABLE ROW LEVEL SECURITY;
ALTER TABLE excepciones_calendario ENABLE ROW LEVEL SECURITY;

-- Guarded for the same reason as migration 015: these are Supabase's roles, and
-- plain PostgreSQL (local Docker, the CI service) does not have them.
DO $$
DECLARE
  target_role text;
BEGIN
  FOREACH target_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = target_role) THEN
      EXECUTE format('REVOKE ALL ON horarios_plantilla, excepciones_calendario FROM %I', target_role);
    END IF;
  END LOOP;
END
$$;
