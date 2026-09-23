import { randomUUID } from "node:crypto"
import { afterEach, describe, expect, it } from "vitest"
import { query } from "@/lib/db"
import { bookingHoldForSession, cancelBookingHold, createBookingWithSession } from "@/lib/store/sessionStore"
import { cleanup, newFixtures, SELLER_ID, type Fixtures } from "@/test/fixtures"

let fixtures: Fixtures

afterEach(async () => {
  if (fixtures) await cleanup(fixtures)
})

let slotOffset = 0

/** A free slot far enough out that it cannot collide with real availability. */
async function freeSlot(): Promise<string> {
  slotOffset += 1
  const result = await query<{ id: string }>(`
    INSERT INTO disponibilidad (vendedor_id, fecha, hora_inicio, hora_fin, disponible)
    VALUES ($1::uuid, current_date + ($2 * interval '1 day'), make_time($3, 0, 0), make_time($3 + 1, 0, 0), true)
    ON CONFLICT (vendedor_id, fecha, hora_inicio) DO UPDATE SET disponible = true
    RETURNING id::text
  `, [SELLER_ID, 800 + Math.floor(slotOffset / 6), 2 + (slotOffset % 6)])
  fixtures.slots.push(result.rows[0].id)
  return result.rows[0].id
}

function customer() {
  const id = randomUUID().slice(0, 10)
  return {
    nombre: `Hold ${id}`,
    email: `hold-${id}@example.test`,
    telefono: `+5792${id.replace(/\D/g, "0").slice(0, 8)}`,
    ciudad: "Bogota",
    pais: "Colombia",
  }
}

async function book(person: ReturnType<typeof customer>, slotId: string) {
  const result = await createBookingWithSession(person, slotId)
  fixtures.customers.push(result.session.clienteId)
  fixtures.bookings.push(result.booking.id)
  fixtures.sessions.push(result.session.id)
  return result
}

/*
 * A customer who pressed Back on the Stripe page was locked out of their own
 * slot: the booking page showed it free, and booking it again was refused
 * because their own unpaid hold was the thing blocking it. The booking page now
 * reads the hold through `bookingHoldForSession` and releases it through
 * `cancelBookingHold`; these pin the database half of that.
 */
describe("a customer's unpaid booking hold", () => {
  it("is live straight after booking, with the appointment it holds", async () => {
    fixtures = newFixtures()
    const { session, booking } = await book(customer(), await freeSlot())

    const hold = await bookingHoldForSession(session.id)
    expect(hold).toMatchObject({ bookingId: booking.id, estado: "pendiente_pago", active: true })
    expect(hold!.holdExpiresAt!.getTime()).toBeGreaterThan(Date.now())
    expect(hold!.startsAt).toBeInstanceOf(Date)
  })

  // The defect as the customer met it: their own hold blocks them.
  it("blocks the same customer from booking the same slot while it is live", async () => {
    fixtures = newFixtures()
    const person = customer()
    const slotId = await freeSlot()
    await book(person, slotId)

    await expect(createBookingWithSession(person, slotId)).rejects.toThrow("SLOT_NOT_AVAILABLE")
  })

  it("frees the slot once released, so the customer can book it again", async () => {
    fixtures = newFixtures()
    const person = customer()
    const slotId = await freeSlot()
    const first = await book(person, slotId)

    await cancelBookingHold(first.booking.id, "customer_released")

    expect(await bookingHoldForSession(first.session.id)).toMatchObject({ estado: "cancelada", active: false })
    const second = await book(person, slotId)
    expect(await bookingHoldForSession(second.session.id)).toMatchObject({ estado: "pendiente_pago", active: true })
  })

  // Releasing is only ever an unpaid hold. A booking the webhook has already
  // confirmed must survive a release that arrives late.
  it("never releases a booking that has been paid", async () => {
    fixtures = newFixtures()
    const slotId = await freeSlot()
    const { session, booking } = await book(customer(), slotId)
    // What the webhook writes on a paid booking fee.
    await query("UPDATE reservas SET estado = 'confirmada', confirmed_at = now() WHERE id = $1::uuid", [booking.id])

    await cancelBookingHold(booking.id, "customer_released")

    expect(await bookingHoldForSession(session.id)).toMatchObject({ estado: "confirmada", active: false })
    await expect(createBookingWithSession(customer(), slotId)).rejects.toThrow("SLOT_NOT_AVAILABLE")
  })

  it("answers nothing for a session that does not exist", async () => {
    fixtures = newFixtures()
    expect(await bookingHoldForSession(randomUUID())).toBeNull()
  })
})
