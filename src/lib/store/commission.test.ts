import { afterEach, beforeAll, describe, expect, it } from "vitest"
import { query } from "@/lib/db"
import {
  addProductToSession,
  closeSession,
  setCommissionRate,
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

async function sessionWithCart(precio: number) {
  fixtures = newFixtures()
  const customer = await createCustomer(fixtures)
  const sessionId = await createSession(fixtures, customer)
  await addProductToSession(sessionId, { nombre: "Tenis Nike Pegasus", precio, cantidad: 1 })
  return sessionId
}

/**
 * The client charges a different commission per deal: 10% against a customer's
 * budget, 15% on an ordinary split, 20-30% when Brash3D fronts the purchase.
 * The specification fixed it at 15% for the whole business (§3, `FEE_RATE`).
 */
describe("per-order commission", () => {
  it.each([
    [10, 16.3, 190.71],
    [15, 24.45, 198.86],
    [20, 32.6, 207.01],
    [30, 48.9, 223.31],
  ])("prices a 163 USD cart at %i%% commission", async (rate, expectedFee, expectedTotal) => {
    const sessionId = await sessionWithCart(163)
    const session = await setCommissionRate(sessionId, rate)
    expect(session?.tasaComision).toBeCloseTo(rate / 100, 4)
    expect(session?.comision).toBeCloseTo(expectedFee, 2)
    expect(session?.total).toBeCloseTo(expectedTotal, 2)
    // The tax is the state's and must not move with the commission.
    expect(session?.impuesto).toBeCloseTo(11.41, 2)
  })

  // The seller agrees the rate on the phone and sets it before pressing Start,
  // so the customer never watches the total move mid-call.
  it("applies to products added after the rate is set", async () => {
    fixtures = newFixtures()
    const customer = await createCustomer(fixtures)
    const sessionId = await createSession(fixtures, customer)
    await setCommissionRate(sessionId, 25)
    const session = await addProductToSession(sessionId, {
      nombre: "Chaqueta Windrunner", precio: 100, cantidad: 1,
    })
    expect(session?.comision).toBeCloseTo(25, 2)
    expect(session?.total).toBeCloseTo(132, 2)
  })

  it("keeps the total equal to subtotal plus tax plus commission", async () => {
    for (const rate of [0, 7.5, 12.25, 33.33]) {
      const sessionId = await sessionWithCart(99.99)
      const session = await setCommissionRate(sessionId, rate)
      expect(session?.total).toBeCloseTo(session!.subtotal + session!.impuesto + session!.comision, 2)
      // Money is stored to the cent; nothing may carry a third decimal.
      expect(Number(session!.comision.toFixed(2))).toBe(session!.comision)
      await cleanup(fixtures)
    }
  })

  // The invoice the customer has been quoted must not reprice behind them.
  it("refuses to change the commission once the invoice is closed", async () => {
    const sessionId = await sessionWithCart(163)
    const closed = await closeSession(sessionId, 65)
    expect(closed?.total).toBeCloseTo(198.86, 2)

    expect(await setCommissionRate(sessionId, 30)).toBeNull()

    const after = await query<{ comision: string; total: string }>(
      "SELECT comision::text, total::text FROM sesiones_compra WHERE id = $1::uuid",
      [sessionId]
    )
    expect(Number(after.rows[0].comision)).toBeCloseTo(24.45, 2)
    expect(Number(after.rows[0].total)).toBeCloseTo(198.86, 2)
  })

  it("answers null for a session that does not exist", async () => {
    fixtures = newFixtures()
    expect(await setCommissionRate("00000000-0000-0000-0000-000000000000", 20)).toBeNull()
  })

  // `sesiones_rate_range_check` stores the rate as a fraction under `>= 0 AND
  // < 1`. The API validates before reaching here; this pins the floor beneath it.
  it("is refused by the database outside the stored range", async () => {
    const sessionId = await sessionWithCart(163)
    await expect(setCommissionRate(sessionId, 100)).rejects.toThrow()
    await expect(setCommissionRate(sessionId, -5)).rejects.toThrow()
  })
})
