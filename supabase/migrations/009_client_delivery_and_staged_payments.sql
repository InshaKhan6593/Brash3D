-- Client-specified Colombia local-team operations and staged Stripe checkouts.

ALTER TYPE caja_estado ADD VALUE IF NOT EXISTS 'recibida' BEFORE 'entregada';

INSERT INTO equipos_locales (id, nombre, ciudad, pais, responsable, email)
VALUES (
  '20000000-0000-4000-8000-000000000001',
  'Brash3D SAS Colombia', 'Bogota', 'Colombia', 'Local delivery team',
  'colombia@brash3d.com'
)
ON CONFLICT (id) DO UPDATE SET
  nombre = EXCLUDED.nombre, ciudad = EXCLUDED.ciudad, pais = EXCLUDED.pais,
  responsable = EXCLUDED.responsable, email = EXCLUDED.email;

ALTER TABLE sesiones_compra
  ADD COLUMN checkout_session_65_id varchar(255),
  ADD COLUMN checkout_session_35_id varchar(255);

CREATE UNIQUE INDEX sesiones_checkout_65_unique
  ON sesiones_compra (checkout_session_65_id)
  WHERE checkout_session_65_id IS NOT NULL;
CREATE UNIQUE INDEX sesiones_checkout_35_unique
  ON sesiones_compra (checkout_session_35_id)
  WHERE checkout_session_35_id IS NOT NULL;

ALTER TABLE cajas_consolidadas
  ADD COLUMN pais varchar(100) NOT NULL DEFAULT 'Colombia',
  ADD COLUMN courier varchar(255),
  ADD COLUMN numero_guia varchar(100),
  ADD COLUMN recibida_at timestamptz;

ALTER TABLE staff_notifications DROP CONSTRAINT staff_notifications_type_check;
ALTER TABLE staff_notifications ADD CONSTRAINT staff_notifications_type_check CHECK (
  type IN ('booking_payment_confirmed', 'initial_payment_confirmed', 'final_payment_confirmed')
);
