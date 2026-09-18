import { describe, expect, it } from "vitest"
import { appointmentParts, formatAppointment, OUTLET_TIME_ZONE } from "@/lib/appointment"
import { DEFAULT_COUNTRY } from "@/lib/countries"

const BOGOTA = DEFAULT_COUNTRY.timeZone

// The booking that exposed this: slot 2026-09-18 17:00 at the Miami outlet,
// stored as 21:00Z by `AT TIME ZONE 'America/New_York'`.
const SUMMER_SLOT = new Date("2026-09-18T21:00:00Z")

describe("showing one appointment to two countries", () => {
  it("shows the customer their own country's time, not the outlet's", () => {
    const parts = appointmentParts(SUMMER_SLOT, "en-US", BOGOTA)
    expect(parts.local).toContain("4:00")
    expect(parts.local).toContain("September 18")
    expect(parts.outlet).toContain("5:00")
  })

  // The defect itself. The order page called toLocaleString with no timeZone,
  // so the same order read differently on every device -- and disagreed with a
  // WhatsApp message, which has no device to read a zone from at all.
  it("gives the same answer regardless of where it is rendered", () => {
    const fromAnywhere = formatAppointment(SUMMER_SLOT, "en-US", BOGOTA)
    expect(fromAnywhere).toBe(formatAppointment(SUMMER_SLOT, "en-US", DEFAULT_COUNTRY.timeZone))
    // A reader in Karachi previously saw "Saturday, September 19 at 2:00 AM"
    // for this very booking. The customer's country is what decides now.
    expect(fromAnywhere).toContain("September 18")
    expect(fromAnywhere).not.toContain("September 19")
  })

  it("names both clocks while they differ", () => {
    expect(formatAppointment(SUMMER_SLOT, "en-US", BOGOTA)).toMatch(/4:00.*·.*5:00.*Miami/)
  })

  // Why this was worth fixing rather than leaving. Colombia is UTC-5 all year;
  // Miami is UTC-4 in summer and UTC-5 in winter. Anybody who checked this in
  // December would have found the two in perfect agreement and concluded there
  // was nothing wrong.
  it("drops the outlet time in winter, when the two clocks agree", () => {
    const winter = new Date("2026-12-18T22:00:00Z") // 5:00 PM in both zones
    const parts = appointmentParts(winter, "en-US", BOGOTA)
    const local = winter.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: BOGOTA })
    expect(local).toBe(parts.outlet)
    expect(formatAppointment(winter, "en-US", BOGOTA)).not.toContain("Miami")
  })

  it("formats in the reader's language", () => {
    const es = formatAppointment(SUMMER_SLOT, "es-CO", BOGOTA)
    const en = formatAppointment(SUMMER_SLOT, "en-US", BOGOTA)
    expect(es).toContain("septiembre")
    expect(en).toContain("September")
  })

  it("keeps the outlet zone the one the booking insert converts with", () => {
    // `createBookingWithSession` stores a slot with
    // `AT TIME ZONE 'America/New_York'`. If these two ever diverge, a slot is
    // displayed against a different clock than it was stored against.
    expect(OUTLET_TIME_ZONE).toBe("America/New_York")
  })
})
