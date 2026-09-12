-- Allow the notification for a duplicate payment that was refunded.
--
-- The balance can be collected two ways, and the two used to overlap: the
-- Colombia team copies a Stripe payment link, the customer turns up with cash,
-- and the link stays payable in Stripe for hours. Paying it charged the
-- customer a second time for a balance already handed over.
--
-- The webhook now refunds such a charge and records it, which includes telling
-- the seller -- a customer charged twice will ask about it. That insert needs
-- its type permitted here. Without this row the whole refund transaction rolls
-- back on the constraint, so the refund would be issued at Stripe and then left
-- unrecorded, which is the very gap this work closes.
--
-- Same shape as 'booking_payment_refunded', added by migration 013 for the
-- late-booking refund.
ALTER TABLE staff_notifications DROP CONSTRAINT staff_notifications_type_check;
ALTER TABLE staff_notifications ADD CONSTRAINT staff_notifications_type_check CHECK (
  type IN (
    'booking_payment_confirmed',
    'initial_payment_confirmed',
    'final_payment_confirmed',
    'booking_payment_refunded',
    'duplicate_payment_refunded'
  )
);
