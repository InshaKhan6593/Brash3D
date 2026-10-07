import { beforeAll, describe, expect, it } from "vitest"
import { customerBookingEmail, sellerBookingEmail, type RenderedEmail } from "@/lib/email/booking-email"
import { googleCalendarUrl, icsInvite, type CalendarEvent } from "@/lib/email/calendar"

// 7 October 2026, 17:00 in Miami (EDT, UTC-4) = 16:00 in Bogotá.
const start = new Date("2026-10-07T21:00:00Z")

const input = {
  customerName: "Camila Rodríguez",
  startsAt: start,
  durationMinutes: 90,
  amountPaid: 30,
  orderUrl: "https://brash3-d.vercel.app/session/abc?token=xyz",
  calendarUrl: "https://calendar.google.com/calendar/render?action=TEMPLATE",
  customerTimeZone: "America/Bogota",
  customerPhone: "+573001234567",
  customerCity: "Bogotá",
}

const event: CalendarEvent = {
  uid: "reserva-1@brash3d",
  start,
  end: new Date(start.getTime() + 90 * 60_000),
  title: "Sesión de compra en vivo · Camila Rodríguez",
  description: "Videollamada por WhatsApp; tu carrito en vivo:",
  location: "Videollamada de WhatsApp",
  url: input.orderUrl,
  organizer: { name: "Mi Global Shopper", email: "reservas@example.com" },
  attendee: { name: "Camila Rodríguez", email: "camila@example.com" },
}

describe("the customer's confirmation email", () => {
  let email: RenderedEmail
  beforeAll(async () => {
    email = await customerBookingEmail(input)
  })

  it("states the Florida time range and the Colombia time when they differ", () => {
    expect(email.text).toMatch(/Hora de Florida \(Miami\): 5:00 p\.\s?m\. – 6:30 p\.\s?m\./)
    expect(email.text).toMatch(/Hora en Colombia: 4:00 p\.\s?m\. – 5:30 p\.\s?m\./)
  })

  it("carries the length, the amount paid and the order link", () => {
    expect(email.text).toContain("Duración: 1 h 30 min")
    expect(email.text).toContain("Reserva pagada: 30.00 USD")
    expect(email.html).toContain(input.orderUrl)
    expect(email.html).toContain("cid:mi-global-shopper-logo")
  })

  it("names a referral reward instead of a zero charge", async () => {
    expect((await customerBookingEmail({ ...input, amountPaid: 0 })).text).toContain("recompensa")
  })

  it("escapes the customer's name in the HTML", async () => {
    const html = (await customerBookingEmail({ ...input, customerName: "<b>Eve</b>" })).html
    expect(html).not.toContain("<b>Eve</b>")
    expect(html).toContain("&lt;b&gt;Eve&lt;/b&gt;")
  })
})

describe("the seller's copy", () => {
  it("is in English with the customer's WhatsApp number and the panel link", async () => {
    const email = await sellerBookingEmail({ ...input, sellerPanelUrl: "https://brash3-d.vercel.app/seller?sessionId=abc" })
    expect(email.subject).toContain("New booking: Camila Rodríguez")
    expect(email.html).toContain("https://wa.me/573001234567")
    expect(email.text).toContain("Open live session: https://brash3-d.vercel.app/seller?sessionId=abc")
  })
})

describe("the calendar invitation", () => {
  const ics = icsInvite(event, new Date("2026-10-01T00:00:00Z"))

  it("spans the booked time in UTC", () => {
    expect(ics).toContain("DTSTART:20261007T210000Z")
    expect(ics).toContain("DTEND:20261007T223000Z")
  })

  it("uses CRLF line endings and folds every line within 75 octets", () => {
    const lines = ics.split("\r\n")
    expect(ics.replace(/\r\n/g, "")).not.toContain("\n")
    for (const line of lines) expect(Buffer.byteLength(line, "utf8")).toBeLessThanOrEqual(75)
  })

  it("escapes commas and semicolons in text fields", () => {
    expect(ics.replace(/\r\n /g, "")).toContain("DESCRIPTION:Videollamada por WhatsApp\\; tu carrito en vivo:")
  })

  it("links Google Calendar to the same span", () => {
    const url = new URL(googleCalendarUrl(event))
    expect(url.searchParams.get("dates")).toBe("20261007T210000Z/20261007T223000Z")
    expect(url.searchParams.get("details")).toContain(input.orderUrl)
  })
})
