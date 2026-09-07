-- Constraints and deterministic operational seed data for local development.

ALTER TABLE disponibilidad
  ADD CONSTRAINT disponibilidad_seller_date_time_unique
  UNIQUE (vendedor_id, fecha, hora_inicio);

ALTER TABLE disponibilidad
  ADD CONSTRAINT disponibilidad_time_order_check CHECK (hora_fin > hora_inicio);

ALTER TABLE productos_carrito
  ADD CONSTRAINT productos_carrito_quantity_check CHECK (cantidad > 0),
  ADD CONSTRAINT productos_carrito_price_check CHECK (precio_unitario > 0),
  ADD CONSTRAINT productos_carrito_total_check CHECK (precio_total >= 0);

ALTER TABLE reservas
  ADD CONSTRAINT reservas_amount_check CHECK (monto_reserva >= 0);

ALTER TABLE sesiones_compra
  ADD CONSTRAINT sesiones_amounts_check CHECK (
    subtotal >= 0 AND impuesto >= 0 AND comision >= 0 AND total >= 0
    AND monto_pagado_65 >= 0 AND monto_pagado_35 >= 0
  );

INSERT INTO vendedores (id, nombre, email, telefono, tienda_asignada)
VALUES
  ('10000000-0000-4000-8000-000000000001', 'Maria Garcia', 'maria@brash3d.com', '+1-555-0101', 'Sawgrass Mills'),
  ('10000000-0000-4000-8000-000000000002', 'Juan Perez', 'juan@brash3d.com', '+1-555-0102', 'Dolphin Mall')
ON CONFLICT (email) DO UPDATE SET
  nombre = EXCLUDED.nombre,
  telefono = EXCLUDED.telefono,
  tienda_asignada = EXCLUDED.tienda_asignada;

INSERT INTO disponibilidad (vendedor_id, fecha, hora_inicio, hora_fin, disponible)
SELECT v.id, day::date, make_time(hour, 0, 0), make_time(hour + 1, 0, 0), TRUE
FROM vendedores v
CROSS JOIN generate_series(
  current_date,
  (date_trunc('month', current_date) + interval '2 months - 1 day')::date,
  interval '1 day'
) day
CROSS JOIN generate_series(9, 18) hour
ON CONFLICT (vendedor_id, fecha, hora_inicio) DO NOTHING;
