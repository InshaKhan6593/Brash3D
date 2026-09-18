-- Whether this customer asked for their cart on WhatsApp.
--
-- Consent, not capability. Meta's 24-hour window governs *how* a message may be
-- sent -- free text inside it, an approved template outside -- but nothing in
-- the platform records whether the customer wanted messages at all. Sending an
-- unasked-for template is how a business number earns a low quality rating and
-- eventually a sending restriction, so the customer opts in from their order
-- page and the seller's product echo follows that flag.
--
-- Per order rather than per customer: a buyer may want the running commentary
-- during a live call and nothing at all for a routine repeat order. Defaulting
-- to false means an existing session never starts messaging somebody who did
-- not ask.
ALTER TABLE sesiones_compra
  ADD COLUMN IF NOT EXISTS whatsapp_updates boolean NOT NULL DEFAULT false;

-- When they turned it on, for answering "why did I get this message".
ALTER TABLE sesiones_compra
  ADD COLUMN IF NOT EXISTS whatsapp_updates_at timestamptz;
