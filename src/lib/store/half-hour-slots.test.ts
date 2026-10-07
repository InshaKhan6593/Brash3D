import { randomUUID } from "node:crypto"
import { afterEach, describe, expect, it } from "vitest"
import { query } from "@/lib/db"
import type { BookingDuration } from "@/lib/booking-duration"
import {
  addProductToSession,
  cancelBookingHold,
  createBookingWithSession,
  extendSession,
  startSession,
} from "@/lib/store/sessionStore"
import { cleanup, freeHalfHours, newFixtures, type Fixtures } from "@/test/fixtures"

/*
 * Time is sold in half hours: an hour is 20 USD, each further 30 minutes 10
 * USD, and only one customer is served at a time. A booking covers several
 * consecutive half-hour slots, and the seller can extend a live call by 30
 * minutes -- billed on the invoice -- when nobody is booked straight after.
 */

let fixtures: Fixtures
let dayOffset = 900

afterEach(async () => {
  if (fixtures) await cleanup(fixtures)
})

/** A fresh far-future day with `count` free half hours from 02:00. */
async function day(count: number): Promise<string[]> {
  dayOffset += 1
  return freeHalfHours(fixtures, dayOffset, 2, count)
}

function customer() {
  const id = randomUUID().slice(0, 10)
  return {
    nombre: `Slots ${id}`,
    email: `slots-${id}@example.test`,
    telefono: `+5793${id.replace(/\D/g, "0").slice(0, 8)}`,
    ciudad: "Bogota",
    pais: "Colombia",
  }
}

async function book(slotId: string, minutes: BookingDuration = 60) {
  const result = await createBookingWithSession(customer(), slotId, minutes)
  fixtures.customers.push(result.session.clienteId)
  fixtures.bookings.push(result.booking.id)
  fixtures.sessions.push(result.session.id)
  return result
}

async function available(ids: string[]): Promise<boolean[]> {
  const result = await query<{ id: string; disponible: boolean }>(
    "SELECT id::text, disponible FROM disponibilidad WHERE id = ANY($1::uuid[])",
    [ids]
  )
  const byId = new Map(result.rows.map((row) => [row.id, row.disponible]))
  return ids.map((id) => byId.get(id) as boolean)
}

/** Paid and started, as the seller sees it at the start of the call. */
async function liveSession(slotId: string, minutes: BookingDuration = 60) {
  const { booking, session } = await book(slotId, minutes)
  await query("UPDATE reservas SET estado = 'confirmada', confirmed_at = now() WHERE id = $1::uuid", [booking.id])
  await startSession(session.id)
  return session.id
}

describe("booking in half hours", () => {
  it("prices and blocks a 1 h 30 booking across three half hours", async () => {
    fixtures = newFixtures()
    const slots = await day(4)

    const { booking, session } = await book(slots[0], 90)

    expect(booking.montoReserva).toBe(30)
    expect(session.duracionMinutos).toBe(90)
    expect(await available(slots)).toEqual([false, false, false, true])
  })

  it("charges 20 USD for an hour and 40 for two", async () => {
    fixtures = newFixtures()
    const hour = await book((await day(2))[0], 60)
    const twoHours = await book((await day(4))[0], 120)

    expect(hour.booking.montoReserva).toBe(20)
    expect(twoHours.booking.montoReserva).toBe(40)
  })

  it("refuses a booking that overlaps another customer's", async () => {
    fixtures = newFixtures()
    const slots = await day(4)
    await book(slots[0], 60)

    // 02:30 is the second half of the first customer's hour.
    await expect(book(slots[1], 60)).rejects.toThrow("SLOT_NOT_AVAILABLE")
  })

  it("allows the next customer straight after", async () => {
    fixtures = newFixtures()
    const slots = await day(4)
    await book(slots[0], 60)

    await expect(book(slots[2], 60)).resolves.toBeTruthy()
    expect(await available(slots)).toEqual([false, false, false, false])
  })

  it("refuses a booking that would run past closing time", async () => {
    fixtures = newFixtures()
    const slots = await day(3)

    // 03:00 is the last half hour of the day, so an hour from there does not fit.
    await expect(book(slots[2], 60)).rejects.toThrow("SLOT_NOT_AVAILABLE")
  })

  it("frees every half hour when an unpaid hold is released", async () => {
    fixtures = newFixtures()
    const slots = await day(3)
    const { booking } = await book(slots[0], 90)

    await cancelBookingHold(booking.id, "test_release")

    expect(await available(slots)).toEqual([true, true, true])
  })

  it("frees every half hour when an unpaid hold expires", async () => {
    fixtures = newFixtures()
    const slots = await day(2)
    const { booking } = await book(slots[0], 60)
    await query("UPDATE reservas SET hold_expires_at = now() - interval '1 minute' WHERE id = $1::uuid", [booking.id])

    // A new booking sweeps expired holds before checking the span.
    await expect(book(slots[0], 60)).resolves.toBeTruthy()
  })
})

describe("the store the customer asks for", () => {
  it("is kept as typed and shown as the order's outlet", async () => {
    fixtures = newFixtures()
    const slots = await day(2)
    const result = await createBookingWithSession({ ...customer(), tienda: "  Nike en Sawgrass Mills " }, slots[0], 60)
    fixtures.customers.push(result.session.clienteId)
    fixtures.bookings.push(result.booking.id)
    fixtures.sessions.push(result.session.id)

    expect(result.session.outlet).toBe("Nike en Sawgrass Mills")
  })
})

describe("extending a live call", () => {
  it("adds 30 minutes and 10 USD to the invoice, and blocks the next half hour", async () => {
    fixtures = newFixtures()
    const slots = await day(4)
    const sessionId = await liveSession(slots[0])
    await addProductToSession(sessionId, { nombre: "Tenis", precio: 100, cantidad: 1 })

    const result = await extendSession(sessionId)

    expect(result.status).toBe("extended")
    if (result.status !== "extended") return
    expect(result.session.duracionMinutos).toBe(90)
    expect(result.session.minutosExtension).toBe(30)
    expect(result.session.cargoExtension).toBe(10)
    // Merchandise 100, plus the session's tax and commission on it, plus 10.
    const merchandise = result.session.subtotal + result.session.impuesto + result.session.comision
    expect(result.session.total).toBeCloseTo(merchandise + 10, 2)
    expect(await available(slots)).toEqual([false, false, false, true])
  })

  it("can be extended more than once while time is free", async () => {
    fixtures = newFixtures()
    const slots = await day(4)
    const sessionId = await liveSession(slots[0])

    await extendSession(sessionId)
    const second = await extendSession(sessionId)

    expect(second.status).toBe("extended")
    if (second.status !== "extended") return
    expect(second.session.duracionMinutos).toBe(120)
    expect(second.session.cargoExtension).toBe(20)
  })

  it("is refused when the next customer is booked straight after", async () => {
    fixtures = newFixtures()
    const slots = await day(4)
    const sessionId = await liveSession(slots[0])
    await book(slots[2], 60)

    expect((await extendSession(sessionId)).status).toBe("next_slot_taken")
  })

  it("is refused past closing time", async () => {
    fixtures = newFixtures()
    const slots = await day(2)
    const sessionId = await liveSession(slots[0])

    expect((await extendSession(sessionId)).status).toBe("after_closing")
  })

  it("is refused before the call has started", async () => {
    fixtures = newFixtures()
    const slots = await day(3)
    const { session } = await book(slots[0], 60)

    expect((await extendSession(session.id)).status).toBe("not_live")
  })

  it("then refuses a new booking for the time it took", async () => {
    fixtures = newFixtures()
    const slots = await day(4)
    const sessionId = await liveSession(slots[0])
    await extendSession(sessionId)

    await expect(book(slots[2], 60)).rejects.toThrow("SLOT_NOT_AVAILABLE")
  })
})
