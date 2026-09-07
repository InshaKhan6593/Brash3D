-- Per-customer shipment lifecycle created after the initial 65% payment.

ALTER TYPE envio_estado ADD VALUE IF NOT EXISTS 'recibido_equipo_local' BEFORE 'entregado';

ALTER TABLE envios
  ALTER COLUMN caja_id DROP NOT NULL,
  ADD COLUMN sesion_id uuid REFERENCES sesiones_compra(id),
  ADD COLUMN etiqueta_codigo varchar(100),
  ADD COLUMN direccion_entrega text,
  ADD COLUMN ciudad_entrega varchar(100),
  ADD COLUMN metodo_pago_recibido varchar(32),
  ADD COLUMN asignacion_pago_final varchar(32),
  ADD COLUMN monto_fondo_local numeric(10,2) NOT NULL DEFAULT 0;

CREATE UNIQUE INDEX envios_sesion_unique ON envios (sesion_id) WHERE sesion_id IS NOT NULL;

ALTER TABLE envios
  ADD CONSTRAINT envios_payment_method_check CHECK (
    metodo_pago_recibido IS NULL OR metodo_pago_recibido IN ('stripe', 'efectivo', 'transferencia')
  ),
  ADD CONSTRAINT envios_payment_allocation_check CHECK (
    asignacion_pago_final IS NULL OR asignacion_pago_final IN ('ingreso_llc_usa', 'fondo_local_colombia')
  );
