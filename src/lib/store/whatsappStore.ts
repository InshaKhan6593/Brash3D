import "server-only"

import { query } from "@/lib/db"

/**
 * Meta's customer service window, as the app understands it.
 *
 * The app's copy is advisory. Meta enforces the real boundary and may close a
 * window early; what this is for is telling the seller, before they start
 * adding products, whether the customer has opened the chat at all. Getting
 * that wrong in the optimistic direction costs one rejected send, which is
 * already handled; getting it wrong pessimistically costs the seller a prompt
 * they did not need.
 */
export const WINDOW_HOURS = 24

export interface WhatsAppWindow {
  open: boolean
  lastInboundAt: Date | null
  expiresAt: Date | null
}

const CLOSED: WhatsAppWindow = { open: false, lastInboundAt: null, expiresAt: null }

/** WhatsApp identifies a number as digits with no `+`, spaces or punctuation. */
export function toWaId(phone: string | null | undefined): string {
  return (phone ?? "").replace(/\D/g, "")
}

/**
 * Records that a customer messaged us, which is what opens the window.
 *
 * Upserts on the number rather than inserting per message: only the most recent
 * message matters, and Meta redelivers a webhook it believes was not
 * acknowledged. `GREATEST` keeps the row monotonic so a retry arriving after a
 * newer message cannot move the window backwards.
 */
export async function recordInboundMessage(
  waId: string,
  sentAt: Date,
  messageId?: string
): Promise<void> {
  const id = toWaId(waId)
  if (!id) return
  await query(`
    INSERT INTO whatsapp_message_windows (wa_id, last_inbound_at, last_message_id)
    VALUES ($1, $2, $3)
    ON CONFLICT (wa_id) DO UPDATE SET
      last_inbound_at = GREATEST(whatsapp_message_windows.last_inbound_at, EXCLUDED.last_inbound_at),
      last_message_id = CASE
        WHEN EXCLUDED.last_inbound_at >= whatsapp_message_windows.last_inbound_at
        THEN EXCLUDED.last_message_id
        ELSE whatsapp_message_windows.last_message_id
      END,
      updated_at = now()
  `, [id, sentAt, messageId ?? null])
}

/** Whether this number may be sent free text, and until when. */
export async function windowState(phone: string | null | undefined): Promise<WhatsAppWindow> {
  const id = toWaId(phone)
  if (!id) return CLOSED

  const result = await query<{ last_inbound_at: Date; open: boolean }>(`
    SELECT last_inbound_at, last_inbound_at > now() - ($2 * interval '1 hour') AS open
    FROM whatsapp_message_windows WHERE wa_id = $1
  `, [id, WINDOW_HOURS])

  const row = result.rows[0]
  if (!row) return CLOSED

  const lastInboundAt = new Date(row.last_inbound_at)
  return {
    open: row.open,
    lastInboundAt,
    expiresAt: new Date(lastInboundAt.getTime() + WINDOW_HOURS * 60 * 60 * 1000),
  }
}
