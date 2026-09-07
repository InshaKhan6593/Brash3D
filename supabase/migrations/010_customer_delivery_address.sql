-- Capture the customer-confirmed Colombia delivery address before the 65% payment.

ALTER TABLE sesiones_compra
  ADD COLUMN direccion_entrega text,
  ADD COLUMN ciudad_entrega varchar(100),
  ADD COLUMN direccion_confirmada_at timestamptz;
