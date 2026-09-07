-- Surface locally confirmed bookings that predate persistent notifications.

INSERT INTO staff_notifications (
  seller_id, type, title, message, reserva_id, created_at
)
SELECT sc.vendedor_id, 'booking_payment_confirmed',
  'Booking payment received',
  c.nombre || ' paid the $20 booking fee.',
  r.id, COALESCE(r.confirmed_at, r.updated_at, r.created_at)
FROM reservas r
JOIN sesiones_compra sc ON sc.reserva_id = r.id
JOIN clientes c ON c.id = r.cliente_id
WHERE r.estado IN ('confirmada', 'completada')
ON CONFLICT (type, reserva_id) WHERE reserva_id IS NOT NULL DO NOTHING;
