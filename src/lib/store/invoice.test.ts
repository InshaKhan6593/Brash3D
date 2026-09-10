import { afterEach, beforeAll, describe, expect, it } from "vitest"
import { query } from "@/lib/db"
import {
  addProductToSession,
  closeSession,
  updateProductQuantity,
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

async function sessionWithProducts(
  prices: Array<{ precio: number; cantidad?: number }>,
  rates: { taxRate?: number; feeRate?: number } = {}
) {
  fixtures = newFixtures()
  const customer = await createCustomer(fixtures)
  const sessionId = await createSession(fixtures, customer, rates)
  let session = null
  for (const price of prices) {
    session = await addProductToSession(sessionId, {
      nombre: "Tenis Nike Pegasus",
      precio: price.precio,
      cantidad: price.cantidad ?? 1,
    })
  }
  return { sessionId, session: session! }
}

describe("invoice totals", () => {
  it("applies the default Florida tax and Brash3D commission", async () => {
    const { session } = await sessionWithProducts([{ precio: 163 }])
    expect(session.subtotal).toBe(163)
    expect(session.impuesto).toBeCloseTo(11.41, 2)
    expect(session.comision).toBeCloseTo(24.45, 2)
    expect(session.total).toBeCloseTo(198.86, 2)
  })

  it("uses the rates stored on the session, not the environment defaults", async () => {
    const { session } = await sessionWithProducts([{ precio: 200 }], { taxRate: 0.1, feeRate: 0.2 })
    expect(session.impuesto).toBeCloseTo(20, 2)
    expect(session.comision).toBeCloseTo(40, 2)
    expect(session.total).toBeCloseTo(260, 2)
    expect(session.tasaImpuesto).toBe(0.1)
    expect(session.tasaComision).toBe(0.2)
  })

  it("keeps total equal to subtotal plus tax plus commission for awkward amounts", async () => {
    for (const precio of [0.01, 0.07, 33.33, 99.99, 1234.56]) {
      const { session } = await sessionWithProducts([{ precio }])
      expect(session.total).toBeCloseTo(session.subtotal + session.impuesto + session.comision, 2)
      // Money is stored to the cent; nothing may carry a third decimal.
      expect(Number(session.impuesto.toFixed(2))).toBe(session.impuesto)
      expect(Number(session.comision.toFixed(2))).toBe(session.comision)
      await cleanup(fixtures)
    }
  })

  it("multiplies by quantity", async () => {
    const { session } = await sessionWithProducts([{ precio: 50, cantidad: 3 }])
    expect(session.subtotal).toBe(150)
  })

  it("recalculates when a quantity changes", async () => {
    const { sessionId, session } = await sessionWithProducts([{ precio: 100 }])
    const product = session.productos[0]
    const updated = await updateProductQuantity(sessionId, product.id, 1)
    expect(updated?.subtotal).toBe(200)
    expect(updated?.total).toBeCloseTo(200 + 14 + 30, 2)
  })

  it("sums several products", async () => {
    const { session } = await sessionWithProducts([{ precio: 95 }, { precio: 68 }])
    expect(session.subtotal).toBe(163)
    expect(session.total).toBeCloseTo(198.86, 2)
  })

  it("closes a session and freezes the invoice", async () => {
    const { sessionId } = await sessionWithProducts([{ precio: 163 }])
    const closed = await closeSession(sessionId)
    expect(closed?.estado).toBe("completada")
    expect(closed?.total).toBeCloseTo(198.86, 2)
  })

  it("refuses to close a session with an empty cart", async () => {
    fixtures = newFixtures()
    const customer = await createCustomer(fixtures)
    const sessionId = await createSession(fixtures, customer)
    const closed = await closeSession(sessionId)
    expect(closed).toBeNull()
  })
})
