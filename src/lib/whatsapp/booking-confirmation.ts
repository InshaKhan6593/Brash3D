import "server-only"

import { customerSessionPath, customerSessionUrl } from "@/lib/customer-link"
import { logger } from "@/lib/logger"
import { bookingConfirmationContext, rotateCustomerAccess } from "@/lib/store/sessionStore"
import { appUrl, bookingTemplate, businessNumber } from "@/lib/whatsapp/config"
import { copy, dateLocale } from "@/lib/whatsapp/messages"
import { sendTemplate, sendText, type SendOutcome } from "@/lib/whatsapp/send"

/**
 * The message that puts a customer's order link somewhere they will find it
 * again.
 *
 * This is the gap the client named: a booking is made days ahead, nobody keeps
 * a browser tab that long, and until this message exists the link lives only in
 * the page they are about to close. A WhatsApp thread is where these customers
 * already live, and it is still there on the day of the session.
 *
 * Template first, because at booking time the 24-hour window is shut -- the
 * customer has not written to us, and Meta refuses free text. Free text is the
 * fallback rather than the other way round, and it only lands for a customer
 * who happens to have an open window, which in practice means a tester.
 *
 * A fresh access token is minted for the link. `createCustomerAccess` only ever
 * inserts, so the customer's other links keep working; this is one more
 * capability, not a replacement.
 */
export async function sendBookingConfirmation(
  checkoutSessionId: string,
  origin: string
): Promise<SendOutcome> {
  if (!businessNumber()) return { status: "disabled" }

  const context = await bookingConfirmationContext(checkoutSessionId)
  if (!context) {
    logger.warn("No booking found for a confirmation message", { checkoutSessionId })
    return { status: "failed", detail: "Booking not found", windowClosed: false }
  }

  const token = await rotateCustomerAccess(context.sessionId)
  const firstName = context.nombre.split(" ")[0] || context.nombre
  const when = context.fechaHora.toLocaleString(dateLocale(), {
    weekday: "long", day: "numeric", month: "long",
    hour: "numeric", minute: "2-digit",
    timeZone: "America/New_York",
  })

  const template = bookingTemplate()
  const outcome = template
    // The URL button's variable is only the part appended to the base URL fixed
    // at approval time: everything after `/session/`.
    ? await sendTemplate(context.telefono, template, [firstName, when, context.outlet],
      customerSessionPath(context.sessionId, token).replace("/session/", ""))
    : await sendText(context.telefono, copy().bookingConfirmation(
      firstName, when, context.outlet,
      // `APP_URL` wins over the request's own origin. A webhook delivered to a
      // tunnel or to localhost gives an origin that is correct for the request
      // and useless in a message -- WhatsApp will not linkify `localhost`, so
      // the customer is sent a link they cannot tap.
      customerSessionUrl(appUrl() ?? origin, context.sessionId, token)))

  logger.info("Booking confirmation sent over WhatsApp", {
    sessionId: context.sessionId,
    via: template ? "template" : "free_text",
    outcome: outcome.status,
    ...(outcome.status === "failed" ? { detail: outcome.detail } : {}),
  })
  return outcome
}
