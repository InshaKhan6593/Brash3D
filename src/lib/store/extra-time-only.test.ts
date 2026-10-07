import { randomUUID } from "node:crypto"
import { afterEach, describe, expect, it } from "vitest"
import { query } from "@/lib/db"
import { isExtraTimeOnly } from "@/lib/order-kind"
import {
  attachSessionCheckout,
  cancelSessionWithoutPurchase,
  createBookingWithSession,
  extendSession,
  getSession,
  processSessionCheckoutEvent,
  startSession,
  updateDeliveryStatus,
} from "@/lib/store/sessionStore"
import { cleanup, createCustomer, createSession, freeHalfHours, newFixtures, type Fixtures } from "@/test/fixtures"

/*
 * The seller extended the call and the customer then bought nothing. The extra
 * time is a service, charged like the booking fee whether or not anything is
 * bought: the session closes as an invoice for the extension alone, paid in
 * full up front, with nothing to ship.
 */

let fixtures: Fixtures
let dayOffset = 980

afterEach(async () => {
  if (fixtures) await cleanup(fixtures)
})

function person() {
  const id = randomUUID().slice(0, 10)
  return {
    nombre: `Extra ${id}`,
    email: `extra-${id}@example.test`,
    telefono: `+5794${id.replace(/\D/g, "0").slice(0, 8)}`,
    ciudad: "Bogota",
    pais: "Colombia",
  }
}

/** A paid, started session on its own far-future day, optionally extended. */
async function liveSession(extensions: number) {
  dayOffset += 1
  const [start] = await freeHalfHours(fixtures, dayOffset, 2, 2 + extensions)
  const { booking, session } = await createBookingWithSession(person(), start, 60)
  fixtures.customers.push(session.clienteId)
  fixtures.bookings.push(booking.id)
  fixtures.sessions.push(session.id)
  await query("UPDATE reservas SET estado = 'confirmada', confirmed_at = now() WHERE id = $1::uuid", [booking.id])
  await startSession(session.id)
  for (let index = 0; index < extensions; index += 1) {
    expect((await extendSession(session.id)).status).toBe("extended")
  }
  return session
}

/** Pays the up-front invoice the way the Stripe webhook does. */
async function payUpFront(sessionId: string) {
  const checkoutId = `cs_test_${randomUUID()}`
  expect(await attachSessionCheckout(sessionId, "inicial", checkoutId)).toBe(true)
  const eventId = `evt_test_${randomUUID()}`
  fixtures.webhookEvents.push(eventId)
  return processSessionCheckoutEvent({
    eventId, checkoutSessionId: checkoutId, paymentIntentId: `pi_test_${randomUUID()}`, stage: "inicial", paid: true,
  })
}

async function rewardsEarnedBy(referrerId: string): Promise<number> {
  const result = await query<{ n: string }>(
    "SELECT count(*)::text AS n FROM referidos_recompensas WHERE referidor_id = $1::uuid",
    [referrerId]
  )
  return Number(result.rows[0].n)
}

describe("a session that ends with extra time and no purchase", () => {
  it("closes as an invoice for the extra time, paid in full up front", async () => {
    fixtures = newFixtures()
    const session = await liveSession(1)

    const ended = await cancelSessionWithoutPurchase(session.id)

    expect(ended?.estado).toBe("completada")
    expect(ended?.subtotal).toBe(0)
    expect(ended?.impuesto).toBe(0)
    expect(ended?.comision).toBe(0)
    expect(ended?.total).toBe(10)
    expect(ended?.porcentajeInicial).toBe(100)
    expect(ended && isExtraTimeOnly(ended)).toBe(true)
  })

  it("charges every half hour added", async () => {
    fixtures = newFixtures()
    const session = await liveSession(2)

    const ended = await cancelSessionWithoutPurchase(session.id)

    expect(ended?.total).toBe(20)
  })

  it("is still cancelled outright when the call was not extended", async () => {
    fixtures = newFixtures()
    const session = await liveSession(0)

    const ended = await cancelSessionWithoutPurchase(session.id)

    expect(ended?.estado).toBe("cancelada")
    expect(ended && isExtraTimeOnly(ended)).toBe(false)
  })

  it("records the payment, with no delivery address needed", async () => {
    fixtures = newFixtures()
    const session = await liveSession(1)
    await cancelSessionWithoutPurchase(session.id)

    expect(await payUpFront(session.id)).toBe("confirmed")

    const paid = await getSession(session.id)
    expect(paid?.montoPagadoInicial).toBe(10)
    expect(paid?.deliveryAddress).toBeUndefined()
  })

  it("never creates a shipment, even once paid", async () => {
    fixtures = newFixtures()
    const session = await liveSession(1)
    await cancelSessionWithoutPurchase(session.id)
    await payUpFront(session.id)
    // Even with an address on the row, there is nothing to ship.
    await query("UPDATE sesiones_compra SET direccion_entrega = 'Calle 1 #2-3', ciudad_entrega = 'Bogota' WHERE id = $1::uuid", [session.id])

    expect(await updateDeliveryStatus(session.id, "preparacion")).toBeNull()
    expect((await getSession(session.id))?.envio).toBeUndefined()
  })
})

describe("extra time and referral rewards", () => {
  it("does not reward the referrer for a payment of extra time alone", async () => {
    fixtures = newFixtures()
    const referrer = await createCustomer(fixtures)
    const session = await liveSession(1)
    await query("UPDATE clientes SET referido_por_id = $2::uuid WHERE id = $1::uuid", [session.clienteId, referrer])
    await cancelSessionWithoutPurchase(session.id)

    await payUpFront(session.id)

    expect(await rewardsEarnedBy(referrer)).toBe(0)
  })

  it("still rewards the referrer for the customer's first real purchase afterwards", async () => {
    fixtures = newFixtures()
    const referrer = await createCustomer(fixtures)
    const session = await liveSession(1)
    await query("UPDATE clientes SET referido_por_id = $2::uuid WHERE id = $1::uuid", [session.clienteId, referrer])
    await cancelSessionWithoutPurchase(session.id)
    await payUpFront(session.id)

    const purchase = await createSession(fixtures, session.clienteId, { state: "completada", total: 120, initialPercentage: 65 })
    await query("UPDATE sesiones_compra SET subtotal = 100 WHERE id = $1::uuid", [purchase])
    expect(await payUpFront(purchase)).toBe("confirmed")

    expect(await rewardsEarnedBy(referrer)).toBe(1)
  })
})
