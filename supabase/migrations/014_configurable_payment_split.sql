-- The client confirmed the 65/35 split is not fixed: some customers pay 100%
-- up front, others 85/15 or 65/35, and the seller sets the figure per order.
-- The column names encoded the old assumption, so they are renamed alongside.

ALTER TABLE sesiones_compra RENAME COLUMN monto_pagado_65 TO monto_pagado_inicial;
ALTER TABLE sesiones_compra RENAME COLUMN monto_pagado_35 TO monto_pagado_final;
ALTER TABLE sesiones_compra RENAME COLUMN payment_intent_65_id TO payment_intent_inicial_id;
ALTER TABLE sesiones_compra RENAME COLUMN payment_intent_35_id TO payment_intent_final_id;
ALTER TABLE sesiones_compra RENAME COLUMN checkout_session_65_id TO checkout_session_inicial_id;
ALTER TABLE sesiones_compra RENAME COLUMN checkout_session_35_id TO checkout_session_final_id;

ALTER INDEX sesiones_checkout_65_unique RENAME TO sesiones_checkout_inicial_unique;
ALTER INDEX sesiones_checkout_35_unique RENAME TO sesiones_checkout_final_unique;

-- The share charged when the session closes. 100 means the customer pays in
-- full up front and there is no balance to collect on delivery.
ALTER TABLE sesiones_compra
  ADD COLUMN porcentaje_inicial numeric(5,2) NOT NULL DEFAULT 65.00;

ALTER TABLE sesiones_compra
  ADD CONSTRAINT sesiones_porcentaje_inicial_check
  CHECK (porcentaje_inicial > 0 AND porcentaje_inicial <= 100);

COMMENT ON COLUMN sesiones_compra.porcentaje_inicial IS
  'Percentage of the invoice charged when the session closes; the remainder is collected on delivery.';
