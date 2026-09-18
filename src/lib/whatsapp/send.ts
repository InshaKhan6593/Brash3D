import "server-only"

import { logger } from "@/lib/logger"
import { accessToken, apiVersion, canSend, phoneNumberId, productTemplate, templateLanguage } from "@/lib/whatsapp/config"
import { isSendable } from "@/lib/phone"
import { copy } from "@/lib/whatsapp/messages"

/**
 * Why nothing here throws.
 *
 * Specification section 7.1 is explicit about the failure rule: "If the
 * WhatsApp send fails, don't roll back the cart insert: the item is still
 * correctly on the invoice, the customer just won't get that one text, and
 * they'll still see it on the web cart's running total."
 *
 * That is the right call, and it has to be enforced here rather than left to
 * every caller remembering a try/catch. The cart is the authoritative record;
 * WhatsApp is a parallel convenience. A Meta outage must never cost the seller
 * a product on a live invoice.
 */
export type SendOutcome =
  | { status: "sent"; messageId: string }
  /** Meta rejected it. `windowClosed` is the one the seller can act on. */
  | { status: "failed"; code?: number; detail: string; windowClosed: boolean }
  /** No credentials configured. Not an error: the integration is optional. */
  | { status: "disabled" }

/**
 * Meta's error for "this person has not messaged you in the last 24 hours".
 * Worth naming, because it is the only failure with a remedy the seller can
 * apply during the call: ask the customer to tap the WhatsApp button.
 */
const RE_ENGAGEMENT_ERROR = 131047

export async function sendText(to: string, body: string): Promise<SendOutcome> {
  if (!canSend()) return { status: "disabled" }

  const recipient = to.replace(/\D/g, "")
  // Numbers stored before normalisation existed are still whatever was typed.
  // Meta wants E.164, so a national number reaches nobody -- and could reach
  // the wrong somebody. Refused here rather than sent hopefully.
  if (!isSendable(recipient)) {
    return { status: "failed", detail: "The customer has no usable phone number", windowClosed: false }
  }

  try {
    const response = await fetch(
      `https://graph.facebook.com/${apiVersion()}/${phoneNumberId()}/messages`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken()}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          to: recipient,
          type: "text",
          // Link previews are suppressed: a product line is not a link, and the
          // preview card would push the running total off a phone screen.
          text: { preview_url: false, body },
        }),
      }
    )

    const payload = await response.json().catch(() => null) as {
      messages?: Array<{ id?: string }>
      error?: { message?: string; code?: number }
    } | null

    if (!response.ok || payload?.error) {
      const code = payload?.error?.code
      const detail = payload?.error?.message ?? `HTTP ${response.status}`
      logger.warn("WhatsApp send rejected", { code, detail, status: response.status })
      return { status: "failed", code, detail, windowClosed: code === RE_ENGAGEMENT_ERROR }
    }

    const messageId = payload?.messages?.[0]?.id ?? ""
    return { status: "sent", messageId }
  } catch (error) {
    // A network failure reaching Meta. Logged, swallowed, never propagated.
    logger.warn("WhatsApp send failed to reach Meta", { error })
    return {
      status: "failed",
      detail: error instanceof Error ? error.message : "Unknown network error",
      windowClosed: false,
    }
  }
}

/**
 * Sends an approved template, which needs no open window.
 *
 * This is the only way to reach a customer who has not messaged the business in
 * the last 24 hours -- which, for a booking made days before the session, is
 * every customer. `parameters` fill the template's `{{1}}`, `{{2}}` … in order.
 */
export async function sendTemplate(
  to: string,
  templateName: string,
  parameters: string[] = [],
  buttonUrlSuffix?: string
): Promise<SendOutcome> {
  if (!canSend()) return { status: "disabled" }

  const recipient = to.replace(/\D/g, "")
  // Numbers stored before normalisation existed are still whatever was typed.
  // Meta wants E.164, so a national number reaches nobody -- and could reach
  // the wrong somebody. Refused here rather than sent hopefully.
  if (!isSendable(recipient)) {
    return { status: "failed", detail: "The customer has no usable phone number", windowClosed: false }
  }

  const components: unknown[] = []
  if (parameters.length) {
    components.push({
      type: "body",
      parameters: parameters.map((text) => ({ type: "text", text })),
    })
  }
  // A dynamic URL button carries only the part appended to the base URL that
  // was fixed at approval time -- for an order link, the session id and token.
  if (buttonUrlSuffix) {
    components.push({
      type: "button",
      sub_type: "url",
      index: "0",
      parameters: [{ type: "text", text: buttonUrlSuffix }],
    })
  }

  try {
    const response = await fetch(
      `https://graph.facebook.com/${apiVersion()}/${phoneNumberId()}/messages`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken()}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          to: recipient,
          type: "template",
          template: {
            name: templateName,
            language: { code: templateLanguage() },
            ...(components.length ? { components } : {}),
          },
        }),
      }
    )

    const payload = await response.json().catch(() => null) as {
      messages?: Array<{ id?: string }>
      error?: { message?: string; code?: number }
    } | null

    if (!response.ok || payload?.error) {
      const detail = payload?.error?.message ?? `HTTP ${response.status}`
      logger.warn("WhatsApp template rejected", { template: templateName, code: payload?.error?.code, detail })
      return { status: "failed", code: payload?.error?.code, detail, windowClosed: false }
    }

    return { status: "sent", messageId: payload?.messages?.[0]?.id ?? "" }
  } catch (error) {
    logger.warn("WhatsApp template failed to reach Meta", { template: templateName, error })
    return {
      status: "failed",
      detail: error instanceof Error ? error.message : "Unknown network error",
      windowClosed: false,
    }
  }
}

/**
 * A product update, by whichever route is open.
 *
 * Free text first, because inside an open window it is free and reads like a
 * normal message. If Meta refuses it because the customer has not written to us
 * in 24 hours, the same product goes as a template instead -- so the customer
 * receives their cart without anyone having to tap anything, which is the point
 * of the whole arrangement.
 *
 * The fallback is skipped when no product template is configured, which is the
 * correct state before one has been approved.
 */
export async function sendProductUpdate(
  to: string,
  name: string,
  price: number,
  quantity: number
): Promise<SendOutcome> {
  const text = await sendText(to, productLine(name, price, quantity))
  if (!(text.status === "failed" && text.windowClosed)) return text

  const template = productTemplate()
  if (!template) return text

  const label = productLabel(name, quantity)
  logger.info("WhatsApp window closed, falling back to the product template", { template })
  return sendTemplate(to, template, [label, (price * quantity).toFixed(2)])
}

/**
 * A product taken out of the cart, or its quantity changed.
 *
 * Free text only, with no template fallback, and that is deliberate rather than
 * an omission. The approved product template says an item was *added*; sending
 * it for a removal would tell the customer the opposite of what happened, which
 * is worse than saying nothing. So a correction reaches them only while the
 * chat is open -- and if it does not, the web cart still shows the truth, which
 * is the arrangement specification 7.1 sets out for the echo generally.
 *
 * Like every other send here, it returns an outcome instead of throwing. The
 * cart edit has already committed; a Meta outage must not undo it.
 */
export async function sendProductRemoved(to: string, name: string, quantity: number): Promise<SendOutcome> {
  return sendText(to, copy().productRemoved(productLabel(name, quantity)))
}

export async function sendProductQuantityChanged(
  to: string,
  name: string,
  price: number,
  quantity: number
): Promise<SendOutcome> {
  return sendText(to, copy().productUpdated(productLabel(name, quantity), (price * quantity).toFixed(2)))
}

/**
 * The line the customer sees for each product the seller adds.
 *
 * Deliberately one line: it sits in a chat beside a live video call, where the
 * customer is looking at the item itself. Name and price are what the
 * specification asks for, and the web cart carries the full breakdown.
 */
export function productLine(name: string, price: number, quantity: number): string {
  return copy().productAdded(productLabel(name, quantity), (price * quantity).toFixed(2))
}

/**
 * Quantity folded into the product name, because a template's shape is fixed at
 * approval and cannot grow a third parameter later. Free text and the template
 * therefore read identically, which matters when a session switches between
 * them halfway through.
 */
export function productLabel(name: string, quantity: number): string {
  return quantity > 1 ? `${quantity} x ${name}` : name
}
