-- A paid booking waits until the seller explicitly starts the scheduled session.

ALTER TABLE sesiones_compra
  ADD COLUMN started_at timestamptz;

-- Preserve historical/demo sessions that already contain shopping activity.
UPDATE sesiones_compra sc
SET started_at = sc.fecha_inicio
WHERE sc.estado = 'completada'
   OR EXISTS (SELECT 1 FROM productos_carrito pc WHERE pc.sesion_id = sc.id);

CREATE INDEX sesiones_started_at_index ON sesiones_compra (started_at);
