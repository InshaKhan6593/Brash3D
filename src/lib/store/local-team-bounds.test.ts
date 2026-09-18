import { afterEach, describe, expect, it } from "vitest"
import { query } from "@/lib/db"
import { listLocalTeamDeliveries } from "@/lib/store/sessionStore"
import { listBoxManifests } from "@/lib/store/shippingStore"
import { DELIVERED_QUEUE_DAYS } from "@/lib/local-team"
import {
  cleanup,
  createBox,
  createCustomer,
  createSession,
  createShipment,
  newFixtures,
  LOCAL_TEAM_ID,
  type Fixtures,
} from "@/test/fixtures"

let fixtures: Fixtures

afterEach(async () => {
  if (fixtures) await cleanup(fixtures)
})

/** The two states the Colombia panel acts on: on its way, and arrived. */
const LOCAL_TEAM_BOX_STATES = ["enviada", "recibida"] as const

/**
 * Both queries behind the Colombia panel are bounded, and both bounds were
 * wrong in a way that hid real work rather than merely slowing the page down.
 */
describe("what the Colombia panel is allowed to miss", () => {
  // Reproduced against the development database before this was fixed: with 35
  // newer `pendiente` boxes, all three genuine ones disappeared. Undispatched
  // boxes are simply what accumulates while the seller prepares shipments, so
  // the receiving team would have been shown an empty screen with a package
  // physically on its way to them.
  it("does not let undispatched boxes push a box in transit out of the list", async () => {
    fixtures = newFixtures()
    const inTransit = await createBox(fixtures, "enviada")
    // Newer than the box above, and more of them than the query's limit.
    for (let index = 0; index < 35; index += 1) {
      await createBox(fixtures, "pendiente")
    }

    const boxes = await listBoxManifests(undefined, LOCAL_TEAM_ID, LOCAL_TEAM_BOX_STATES)

    expect(boxes.map((box) => box.id)).toContain(inTransit)
    expect(boxes.every((box) => box.status === "enviada" || box.status === "recibida")).toBe(true)
  })

  async function deliveredOrder(boxId: string, deliveredDaysAgo: number) {
    const customer = await createCustomer(fixtures)
    const sessionId = await createSession(fixtures, customer, {
      state: "completada", total: 198.86, initialPercentage: 65, paidInitial: 129.26,
    })
    await createShipment(sessionId, "entregado", boxId)
    await query(
      "UPDATE envios SET fecha_entrega_real = now() - ($2 * interval '1 day') WHERE sesion_id = $1::uuid",
      [sessionId, deliveredDaysAgo]
    )
    return sessionId
  }

  // `entregado` is terminal and nothing clears it, so an unbounded queue
  // returns every order the business has ever delivered, with all its product
  // lines, every five seconds, for the life of the company.
  it("drops a delivery confirmed long ago and keeps a recent one", async () => {
    fixtures = newFixtures()
    const boxId = await createBox(fixtures)
    const recent = await deliveredOrder(boxId, 1)
    const old = await deliveredOrder(boxId, DELIVERED_QUEUE_DAYS + 5)

    const queue = await listLocalTeamDeliveries(LOCAL_TEAM_ID)
    const ids = queue.map((session) => session.id)

    expect(ids).toContain(recent)
    expect(ids).not.toContain(old)
  })

  // The bound must never reach work that is not finished. A package sitting in
  // country waiting to be handed over stays on the queue however long it has
  // been there -- that is precisely the order the team needs chasing.
  it("keeps an undelivered package however old it is", async () => {
    fixtures = newFixtures()
    const boxId = await createBox(fixtures)
    const customer = await createCustomer(fixtures)
    const sessionId = await createSession(fixtures, customer, {
      state: "completada", total: 198.86, initialPercentage: 65, paidInitial: 129.26,
    })
    await createShipment(sessionId, "recibido_equipo_local", boxId)
    await query(
      "UPDATE sesiones_compra SET fecha_fin = now() - interval '400 days' WHERE id = $1::uuid",
      [sessionId]
    )

    const queue = await listLocalTeamDeliveries(LOCAL_TEAM_ID)
    expect(queue.map((session) => session.id)).toContain(sessionId)
  })
})
