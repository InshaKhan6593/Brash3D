import { afterEach, describe, expect, it } from "vitest"
import { query } from "@/lib/db"
import { confirmDeliveryAddress } from "@/lib/store/sessionStore"
import { cleanup, createCustomer, createSession, newFixtures, type Fixtures } from "@/test/fixtures"

let fixtures: Fixtures

afterEach(async () => {
  if (fixtures) await cleanup(fixtures)
})

async function storedAddress(sessionId: string) {
  const row = await query<{ address: string | null; city: string | null }>(`
    SELECT direccion_entrega AS address, ciudad_entrega AS city
    FROM sesiones_compra WHERE id = $1::uuid
  `, [sessionId])
  return row.rows[0]
}

describe("delivery address confirmation", () => {
  it("records the address the customer confirms before paying", async () => {
    fixtures = newFixtures()
    const customer = await createCustomer(fixtures)
    const sessionId = await createSession(fixtures, customer, {
      state: "completada", total: 198.86, withAddress: false,
    })

    expect(await confirmDeliveryAddress(sessionId, "Carrera 7 #71-21, apto 502", "Bogota")).toBe(true)
    expect(await storedAddress(sessionId)).toEqual({
      address: "Carrera 7 #71-21, apto 502",
      city: "Bogota",
    })
  })

  it("freezes the address once the up-front payment has landed", async () => {
    // This is the guard that makes a durable customer link safe. The token is
    // in the URL so the order page opens on any device, which means a
    // forwarded link reaches a page that can set a delivery address. Once
    // money is in, the address stops moving -- so a leaked link can only read
    // an order already in flight, never redirect the goods.
    fixtures = newFixtures()
    const customer = await createCustomer(fixtures)
    const sessionId = await createSession(fixtures, customer, {
      state: "completada", total: 198.86, paidInitial: 129.26,
    })

    expect(await confirmDeliveryAddress(sessionId, "Calle falsa 123", "Medellin")).toBe(false)
    const stored = await storedAddress(sessionId)
    expect(stored.address).not.toBe("Calle falsa 123")
    expect(stored.city).not.toBe("Medellin")
  })

  it("refuses a session the seller has not closed yet", async () => {
    // No invoice exists, so there is nothing to deliver and no charge to
    // gate the freeze on.
    fixtures = newFixtures()
    const customer = await createCustomer(fixtures)
    const sessionId = await createSession(fixtures, customer, { withAddress: false })

    expect(await confirmDeliveryAddress(sessionId, "Carrera 7 #71-21", "Bogota")).toBe(false)
    expect((await storedAddress(sessionId)).address).toBeNull()
  })

  it("answers false for a session that does not exist", async () => {
    fixtures = newFixtures()
    expect(await confirmDeliveryAddress(
      "00000000-0000-4000-8000-000000000000", "Carrera 7 #71-21", "Bogota"
    )).toBe(false)
  })
})
