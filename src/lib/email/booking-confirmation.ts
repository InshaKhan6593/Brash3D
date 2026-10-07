import "server-only"

import { DEFAULT_COUNTRY } from "@/lib/countries"
import { customerSessionUrl } from "@/lib/customer-link"
import { customerBookingEmail, LOGO_CID, sellerBookingEmail } from "@/lib/email/booking-email"
import { MI_GLOBAL_SHOPPER_LOGO_PNG_BASE64 } from "@/lib/email/logos"
import { icsInvite, googleCalendarUrl, type CalendarEvent } from "@/lib/email/calendar"
import { addressOf, canSendEmail, emailFrom, staffEmailOverride } from "@/lib/email/config"
import { sendEmail, type EmailAttachment, type EmailOutcome } from "@/lib/email/send"
import { logger } from "@/lib/logger"
import { bookingEmailContext, rotateCustomerAccess } from "@/lib/store/sessionStore"
import { appUrl } from "@/lib/whatsapp/config"

// Embedded rather than linked, so the header never shows a broken image.
const LOGOS: EmailAttachment[] = [
  { filename: "mi-global-shopper.png", content: MI_GLOBAL_SHOPPER_LOGO_PNG_BASE64, encoding: "base64", contentType: "image/png", contentId: LOGO_CID },
]

/**
 * Emails the booking confirmation: to the customer with their order link and a
 * calendar invitation, and to the seller with the same invitation.
 *
 * The email carries the same link the WhatsApp confirmation does, minted
 * afresh -- tokens are additive, so every link the customer already holds
 * keeps working. It reaches the customer whose phone WhatsApp cannot, and puts
 * the appointment in both calendars, which is what the client asked for.
 *
 * Never throws: it runs after the booking is confirmed and paid, and neither a
 * mail outage nor a missing key may undo that.
 */
export async function emailBookingConfirmation(
  where: { checkoutSessionId: string } | { sessionId: string },
  origin: string
): Promise<{ customer: EmailOutcome; seller: EmailOutcome }> {
  const disabled = { status: "disabled" } as const
  if (!canSendEmail()) return { customer: disabled, seller: disabled }

  try {
    const context = await bookingEmailContext(where)
    if (!context) {
      logger.warn("No confirmed booking found for a confirmation email", where)
      return { customer: disabled, seller: disabled }
    }

    // `APP_URL` wins: a webhook delivered to localhost or a tunnel has an
    // origin that is right for the request and useless in someone's inbox.
    const base = appUrl() ?? origin
    const token = await rotateCustomerAccess(context.sessionId)
    const orderUrl = customerSessionUrl(base, context.sessionId, token)
    const start = context.fechaHora
    const end = new Date(start.getTime() + context.duracionMinutos * 60_000)
    const organizer = { name: "Mi Global Shopper", email: addressOf(emailFrom()) }
    const event = (attendee: { name: string; email: string }, url: string): CalendarEvent => ({
      uid: `${context.reservaId}@brash3d`,
      start,
      end,
      title: `Sesión de compra en vivo · ${context.nombre}`,
      description: "Videollamada por WhatsApp con tu comprador personal de Mi Global Shopper. Tu carrito en vivo:",
      location: "Videollamada de WhatsApp",
      url,
      organizer,
      attendee,
    })

    const customerEvent = event({ name: context.nombre, email: context.email }, orderUrl)
    const shared = {
      customerName: context.nombre,
      startsAt: start,
      durationMinutes: context.duracionMinutos,
      amountPaid: context.montoReserva,
      customerTimeZone: DEFAULT_COUNTRY.timeZone,
      customerPhone: context.telefono,
      customerCity: context.ciudad ?? undefined,
      store: context.tienda ?? undefined,
    }
    const customerEmail = await customerBookingEmail({ ...shared, orderUrl, calendarUrl: googleCalendarUrl(customerEvent) })
    const customer = await sendEmail({
      to: context.email,
      ...customerEmail,
      attachments: [...LOGOS, { filename: "cita.ics", content: icsInvite(customerEvent), contentType: "text/calendar; charset=utf-8; method=REQUEST" }],
    })

    const sellerPanelUrl = `${base}/seller?sessionId=${encodeURIComponent(context.sessionId)}`
    const sellerTo = staffEmailOverride() ?? context.sellerEmail
    const sellerEvent = event({ name: context.sellerName, email: sellerTo }, sellerPanelUrl)
    const sellerEmail = await sellerBookingEmail({ ...shared, orderUrl, calendarUrl: googleCalendarUrl(sellerEvent), sellerPanelUrl })
    const seller = await sendEmail({
      to: sellerTo,
      ...sellerEmail,
      attachments: [...LOGOS, { filename: "booking.ics", content: icsInvite(sellerEvent), contentType: "text/calendar; charset=utf-8; method=REQUEST" }],
    })

    logger.info("Booking confirmation emailed", {
      sessionId: context.sessionId,
      customer: customer.status,
      seller: seller.status,
    })
    return { customer, seller }
  } catch (error) {
    logger.error("Booking confirmation email failed", { error: error instanceof Error ? error.message : String(error) })
    const failed = { status: "failed", detail: "unexpected error" } as const
    return { customer: failed, seller: failed }
  }
}
