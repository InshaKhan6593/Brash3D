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
): Promise<{ openedWindow: boolean }> {
  const id = toWaId(waId)
  if (!id) return { openedWindow: false }
  // The prior state is read in the same statement as the write, because it is
  // the only way to tell "the customer has just opened the chat" from "the
  // customer is still talking to us". The CTE sees the row as it was before the
  // upsert, which is exactly the distinction needed.
  const result = await query<{ was_open: boolean | null }>(`
    WITH prior AS (
      SELECT last_inbound_at > now() - ($4 * interval '1 hour') AS was_open
      FROM whatsapp_message_windows WHERE wa_id = $1
    ), upsert AS (
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
      RETURNING wa_id
    )
    SELECT (SELECT was_open FROM prior) AS was_open FROM upsert
  `, [id, sentAt, messageId ?? null, WINDOW_HOURS])

  // No prior row, or a window that had lapsed: this message is what opened it.
  return { openedWindow: result.rows[0]?.was_open !== true }
}

/**
 * The live order belonging to a number, when its customer has asked for
 * WhatsApp updates.
 *
 * Used to answer a customer's first message with a confirmation, and only
 * theirs: writing to somebody who merely messaged the business, and never asked
 * for anything, is how a business number earns a low quality rating.
 */
export async function liveSessionForWaId(waId: string): Promise<{ telefono: string } | null> {
  const id = toWaId(waId)
  if (!id) return null
  const result = await query<{ telefono: string }>(`
    SELECT c.telefono
    FROM sesiones_compra sc
    JOIN clientes c ON c.id = sc.cliente_id
    WHERE sc.estado = 'en_progreso'
      AND sc.whatsapp_updates = true
      AND regexp_replace(COALESCE(c.telefono, ''), '\D', '', 'g') = $1
    ORDER BY sc.started_at DESC NULLS LAST
    LIMIT 1
  `, [id])
  return result.rows[0] ?? null
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
