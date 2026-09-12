import { afterEach, describe, expect, it } from "vitest"
import { transaction } from "@/lib/db"
import { cleanup, createCustomer, createSession, createShipment, newFixtures, type Fixtures } from "@/test/fixtures"

let fixtures: Fixtures

afterEach(async () => {
  if (fixtures) await cleanup(fixtures)
})

/**
 * Reads a table exactly as a customer's Realtime subscription does: as the
 * `authenticated` role, carrying a signed claim naming one session.
 *
 * Everything the policies protect hangs on this being the *only* thing that
 * decides visibility. The subscription filter a browser sends is chosen by the
 * browser, so it is worthless as a boundary -- if these policies leaked, anyone
 * holding the publishable key could watch another customer's cart, address and
 * invoice by asking for their session id.
 */
async function readAs(sessionClaim: string | null, sql: string, params: unknown[] = []) {
  return transaction(async (client) => {
    await client.query("SET LOCAL ROLE authenticated")
    if (sessionClaim === null) {
      await client.query("SELECT set_config('request.jwt.claims', '', true)")
    } else {
      await client.query("SELECT set_config('request.jwt.claims', $1, true)",
        [JSON.stringify({ role: "authenticated", session_id: sessionClaim })])
    }
    const result = await client.query(sql, params)
    // RESET so the pooled connection never carries the role or claim onward.
    await client.query("RESET ROLE")
    return result
  })
}

describe("realtime read policies", () => {
  it("shows a customer their own cart, session and shipment", async () => {
    fixtures = newFixtures()
    const customer = await createCustomer(fixtures)
    const sessionId = await createSession(fixtures, customer, {
      state: "completada", total: 198.86, paidInitial: 129.26,
    })
    await createShipment(sessionId, "preparacion")

    const session = await readAs(sessionId, "SELECT id FROM sesiones_compra WHERE id = $1::uuid", [sessionId])
    const shipment = await readAs(sessionId, "SELECT id FROM envios WHERE sesion_id = $1::uuid", [sessionId])

    expect(session.rowCount).toBe(1)
    expect(shipment.rowCount).toBe(1)
  })

  it("hides another customer's session entirely", async () => {
    // The headline assertion. A token for session A must not read session B,
    // even though the role has SELECT on the table.
    fixtures = newFixtures()
    const mine = await createSession(fixtures, await createCustomer(fixtures), { state: "completada", total: 100 })
    const theirs = await createSession(fixtures, await createCustomer(fixtures), { state: "completada", total: 200 })
    await createShipment(theirs, "preparacion")

    const session = await readAs(mine, "SELECT id FROM sesiones_compra WHERE id = $1::uuid", [theirs])
    const shipment = await readAs(mine, "SELECT id FROM envios WHERE sesion_id = $1::uuid", [theirs])

    expect(session.rowCount).toBe(0)
    expect(shipment.rowCount).toBe(0)
  })

  it("shows nothing at all without a claim", async () => {
    // A browser holding only the publishable key, with no token from us.
    fixtures = newFixtures()
    const sessionId = await createSession(fixtures, await createCustomer(fixtures), { state: "completada", total: 100 })

    const rows = await readAs(null, "SELECT id FROM sesiones_compra WHERE id = $1::uuid", [sessionId])

    expect(rows.rowCount).toBe(0)
  })

  it("does not let a claim reach a table with no policy", async () => {
    // `reservas` is in the realtime publication but was deliberately given no
    // policy and no grant, so it stays closed even to a valid token.
    fixtures = newFixtures()
    const sessionId = await createSession(fixtures, await createCustomer(fixtures), { state: "completada", total: 100 })

    await expect(readAs(sessionId, "SELECT id FROM reservas")).rejects.toThrow(/permission denied/i)
  })

  it("refuses writes even with a valid claim", async () => {
    // Realtime is read-only by design: the invoice must never be settable from
    // a browser, which is the whole reason totals are computed in PostgreSQL.
    fixtures = newFixtures()
    const sessionId = await createSession(fixtures, await createCustomer(fixtures), { state: "completada", total: 100 })

    await expect(
      readAs(sessionId, "UPDATE sesiones_compra SET total = 1 WHERE id = $1::uuid", [sessionId])
    ).rejects.toThrow(/permission denied/i)
  })
})
