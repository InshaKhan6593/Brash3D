import { describe, expect, it } from "vitest"
import { matchesBookingFilter } from "@/lib/booking-filters"
import type { SesionCompra } from "@/lib/types"

const NOW = new Date("2026-09-10T18:00:00.000Z")

/** A booking whose slot began three hours ago and which nobody has closed. */
function session(overrides: Partial<SesionCompra> = {}): SesionCompra {
  return {
    estado: "en_progreso",
    bookingEstado: "confirmada",
    fechaHoraProgramada: new Date("2026-09-10T15:00:00.000Z"),
    fechaInicio: new Date("2026-09-10T15:00:00.000Z"),
    startedAt: undefined,
    ...overrides,
  } as SesionCompra
}

describe("matchesBookingFilter", () => {
  // The regression: a live session whose slot time had passed appeared under no
  // filter except "today" and "all", so the seller lost sight of the order they
  // were actively working on.
  it("keeps a live session in 'open' after its slot time has passed", () => {
    expect(matchesBookingFilter(session(), "open", NOW)).toBe(true)
  })

  it("keeps a live session in 'in_progress' even before anyone pressed start", () => {
    expect(matchesBookingFilter(session({ startedAt: undefined }), "in_progress", NOW)).toBe(true)
  })

  it("still lists a session that has not started yet", () => {
    const later = session({ fechaHoraProgramada: new Date("2026-09-10T22:00:00.000Z") })
    expect(matchesBookingFilter(later, "open", NOW)).toBe(true)
  })

  it("drops a closed session from 'open' and moves it to 'completed'", () => {
    const closed = session({ estado: "completada" })
    expect(matchesBookingFilter(closed, "open", NOW)).toBe(false)
    expect(matchesBookingFilter(closed, "completed", NOW)).toBe(true)
  })

  it("drops a cancelled booking from 'open'", () => {
    expect(matchesBookingFilter(session({ bookingEstado: "cancelada" }), "open", NOW)).toBe(false)
  })

  // A session ended because the customer bought nothing is finished business.
  // "Open" means unfinished, and it keyed only on `completada`, so a
  // no-purchase session would have sat in the seller's default view for good.
  it("drops a session ended without a purchase from 'open'", () => {
    const noPurchase = session({ estado: "cancelada", bookingEstado: "confirmada" })
    expect(matchesBookingFilter(noPurchase, "open", NOW)).toBe(false)
    expect(matchesBookingFilter(noPurchase, "in_progress", NOW)).toBe(false)
    expect(matchesBookingFilter(noPurchase, "all", NOW)).toBe(true)
  })

  it("matches 'today' on the local calendar day, whatever the time of day", () => {
    expect(matchesBookingFilter(session(), "today", NOW)).toBe(true)
    const yesterday = session({ fechaHoraProgramada: new Date("2026-09-09T15:00:00.000Z") })
    expect(matchesBookingFilter(yesterday, "today", NOW)).toBe(false)
  })

  it("matches 'payment_pending' only on an unpaid booking", () => {
    expect(matchesBookingFilter(session({ bookingEstado: "pendiente_pago" }), "payment_pending", NOW)).toBe(true)
    expect(matchesBookingFilter(session(), "payment_pending", NOW)).toBe(false)
  })

  it("'all' matches everything, including cancelled and closed", () => {
    expect(matchesBookingFilter(session({ bookingEstado: "cancelada" }), "all", NOW)).toBe(true)
    expect(matchesBookingFilter(session({ estado: "completada" }), "all", NOW)).toBe(true)
  })

  // Every booking must be reachable through at least one filter, or it becomes
  // invisible the way this one did.
  it("leaves no booking unreachable by every filter", () => {
    const cases = [
      session(),
      session({ estado: "completada" }),
      session({ bookingEstado: "pendiente_pago" }),
      session({ bookingEstado: "cancelada" }),
      session({ fechaHoraProgramada: new Date("2026-09-01T15:00:00.000Z") }),
    ]
    for (const candidate of cases) {
      const reachable = (["today", "open", "payment_pending", "in_progress", "completed"] as const)
        .some((filter) => matchesBookingFilter(candidate, filter, NOW))
      expect(reachable).toBe(true)
    }
  })
})
