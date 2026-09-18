-- When each customer last messaged the business on WhatsApp.
--
-- Meta only lets a business send free text to someone who messaged it in the
-- last 24 hours. Specification section 7.1 assumed the live video call opened
-- that window; it does not -- Meta's calling exception covers voice calls on
-- the Business Calling API, a different surface from the seller's own handset.
-- So the customer opens it themselves by tapping a wa.me link on their order
-- page, and this table is how the app knows they did.
--
-- Without it the seller learns the window is shut only when a send is rejected,
-- which happens mid-call with a customer waiting. With it the panel can say so
-- while there is still time to ask them to tap.
--
-- Keyed by WhatsApp's own id (`wa_id`: digits, no `+`) rather than by customer,
-- because the webhook knows only the number that messaged. One customer may
-- also hold several orders, and the window belongs to the number, not the order.
CREATE TABLE IF NOT EXISTS whatsapp_message_windows (
  wa_id text PRIMARY KEY,
  -- When the customer last messaged us. The window is open while this is
  -- within 24 hours; the exact boundary is Meta's to enforce, and the app
  -- treats its own copy as advisory -- see `windowState` in the store.
  last_inbound_at timestamptz NOT NULL,
  -- Meta's id for that message, so a redelivery updates rather than duplicates.
  last_message_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Migration 015 enabled row level security on every table that existed then and
-- revoked what Supabase grants `anon` and `authenticated`. A table created
-- afterwards is exposed through PostgREST by omission unless it does the same,
-- and `npm run db:check` fails on a public table without RLS for that reason.
--
-- No policy is attached deliberately: RLS with no policy denies every role but
-- the table owner, which is how the application connects. Nothing in a browser
-- has any business reading when somebody last sent a WhatsApp message.
ALTER TABLE whatsapp_message_windows ENABLE ROW LEVEL SECURITY;
