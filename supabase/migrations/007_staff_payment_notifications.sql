-- Persistent operational notifications created by trusted backend events.

CREATE TABLE staff_notifications (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  seller_id uuid REFERENCES vendedores(id) ON DELETE CASCADE,
  type varchar(50) NOT NULL CHECK (type IN ('booking_payment_confirmed')),
  title varchar(255) NOT NULL,
  message text NOT NULL,
  reserva_id uuid REFERENCES reservas(id) ON DELETE CASCADE,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX staff_notifications_booking_payment_unique
  ON staff_notifications (type, reserva_id)
  WHERE reserva_id IS NOT NULL;

CREATE INDEX staff_notifications_seller_unread_index
  ON staff_notifications (seller_id, created_at DESC)
  WHERE read_at IS NULL;
