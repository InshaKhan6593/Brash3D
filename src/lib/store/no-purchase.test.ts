import { afterEach, beforeAll, describe, expect, it } from "vitest"
import { query } from "@/lib/db"
import {
  addProductToSession,
  cancelSessionWithoutPurchase,
  closeSession,
  getSession,
} from "@/lib/store/sessionStore"
import { cleanup, createCustomer, createSession, newFixtures, type Fixtures } from "@/test/fixtures"

let fixtures: Fixtures

beforeAll(async () => {
  const ready = await query<{ ok: boolean }>(
    "SELECT to_regclass('public.sesiones_compra') IS NOT NULL AS ok"
  )
  if (!ready.rows[0]?.ok) {
    throw new Error("Run `npm run db:migrate` before the store tests")
  }
})

afterEach(async () => {
  if (fixtures) await cleanup(fixtures)
})

async function startedSession() {
  fixtures = newFixtures()
  const customer = await createCustomer(fixtures)
  return createSession(fixtures, customer)
}

/**
 * A live session in which the customer liked nothing.
 *
 * An ordinary outcome at an outlet, and one the system had no exit for:
 * `closeSession` requires `total > 0`, so an empty cart left the appointment in
 * `en_progreso` permanently — counted as live work on the seller's Overview,
 * and showing the customer a cart that would never resolve.
 */
describe("ending a session without a purchase", () => {
  it("closes an empty session as cancelled, with no invoice", async () => {
    const sessionId = await startedSession()

    const session = await cancelSessionWithoutPurchase(sessionId)

    expect(session?.estado).toBe("cancelada")
    expect(session?.total).toBe(0)
    expect(session?.fechaFin).toBeTruthy()
  })

  // The guard that matters: this must never be able to discard an order that
  // has products in it, whatever calls it.
  it("refuses a session that has products in its cart", async () => {
    const sessionId = await startedSession()
    await addProductToSession(sessionId, { nombre: "Tenis Nike Pegasus", precio: 95, cantidad: 1 })

    expect(await cancelSessionWithoutPurchase(sessionId)).toBeNull()
    expect((await getSession(sessionId))?.estado).toBe("en_progreso")
  })

  it("refuses a session that is already closed", async () => {
    const sessionId = await startedSession()
    await addProductToSession(sessionId, { nombre: "Tenis Nike Pegasus", precio: 95, cantidad: 1 })
    await closeSession(sessionId, 65)

    expect(await cancelSessionWithoutPurchase(sessionId)).toBeNull()
    expect((await getSession(sessionId))?.estado).toBe("completada")
  })

  // Closing still refuses an empty cart. The two outcomes are not
  // interchangeable: one creates an invoice the customer owes money against,
  // the other creates nothing at all.
  it("leaves closing an empty session refused", async () => {
    const sessionId = await startedSession()

    expect(await closeSession(sessionId, 65)).toBeNull()
    expect((await getSession(sessionId))?.estado).toBe("en_progreso")
  })
})

/**
 * The commission is confirmed in the close dialog, because closing is the
 * moment the customer is first shown a total — their screen carries only the
 * merchandise subtotal during the call.
 */
describe("closing with a commission", () => {
  it("reprices the invoice at the rate confirmed on close", async () => {
    const sessionId = await startedSession()
    await addProductToSession(sessionId, { nombre: "Tenis Nike Pegasus", precio: 163, cantidad: 1 })

    const session = await closeSession(sessionId, 65, 25)

    expect(session?.estado).toBe("completada")
    expect(session?.tasaComision).toBeCloseTo(0.25, 4)
    expect(session?.comision).toBeCloseTo(40.75, 2)
    expect(session?.total).toBeCloseTo(215.16, 2)
    // The tax is the state's and must not move with the commission.
    expect(session?.impuesto).toBeCloseTo(11.41, 2)
  })

  it("keeps the rate the session already carried when none is given", async () => {
    const sessionId = await startedSession()
    await addProductToSession(sessionId, { nombre: "Tenis Nike Pegasus", precio: 163, cantidad: 1 })

    const session = await closeSession(sessionId, 65)

    expect(session?.tasaComision).toBeCloseTo(0.15, 4)
    expect(session?.total).toBeCloseTo(198.86, 2)
  })

  // Closing locks the invoice, so a rate arriving with a close that is refused
  // must not reprice the cart on its way out.
  it("does not reprice a session it cannot close", async () => {
    const sessionId = await startedSession()
    await addProductToSession(sessionId, { nombre: "Tenis Nike Pegasus", precio: 163, cantidad: 1 })
    await closeSession(sessionId, 65)

    expect(await closeSession(sessionId, 65, 30)).toBeNull()
    expect((await getSession(sessionId))?.tasaComision).toBeCloseTo(0.15, 4)
  })
})
