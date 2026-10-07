-- The store the customer asks their personal shopper to visit.
--
-- The booking page used to name one outlet, Nike Sawgrass, for every slot. The
-- client promotes many stores on Instagram, and a customer arriving from an ad
-- writes the one they saw: "leave a blank space so people will know in which
-- store the personal shopper could go". It is the customer's words, kept as
-- typed, and shown to the seller and in every confirmation.
--
-- Nullable: bookings made before this have none, and fall back to the seller's
-- assigned outlet (`vendedores.tienda_asignada`) wherever a store is shown.

ALTER TABLE reservas
  ADD COLUMN tienda_solicitada varchar(200),
  ADD CONSTRAINT reservas_tienda_solicitada_check CHECK (
    tienda_solicitada IS NULL OR length(btrim(tienda_solicitada)) BETWEEN 2 AND 200
  );
