import { afterEach, describe, expect, it } from "vitest"
import { listLocalTeamDeliveries } from "@/lib/store/sessionStore"
import { listBoxManifests } from "@/lib/store/shippingStore"
import {
  cleanup,
  createBox,
  createCustomer,
  createLocalTeam,
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

// The delivery queue used to be `listSessions()` -- every session ever created,
// with every product -- narrowed by four conditions in JavaScript, on a five
// second poll. The conditions moved into SQL. These pin that they still mean
// the same thing, because a predicate that is wrong in the database is a team
// reading another country's customer addresses, not a slow page.
describe("the Colombia delivery queue", () => {
  async function readyForDelivery(boxId: string) {
    const customer = await createCustomer(fixtures)
    const sessionId = await createSession(fixtures, customer, {
      state: "completada", total: 198.86, initialPercentage: 65, paidInitial: 129.26,
    })
    await createShipment(sessionId, "recibido_equipo_local", boxId)
    return sessionId
  }

  it("includes a closed, paid order whose box the team has received", async () => {
    fixtures = newFixtures()
    const boxId = await createBox(fixtures)
    const sessionId = await readyForDelivery(boxId)

    const queue = await listLocalTeamDeliveries(LOCAL_TEAM_ID)
    expect(queue.map((session) => session.id)).toContain(sessionId)
  })

  it("excludes an order whose box is still in transit to the team", async () => {
    fixtures = newFixtures()
    const boxId = await createBox(fixtures)
    const customer = await createCustomer(fixtures)
    const sessionId = await createSession(fixtures, customer, {
      state: "completada", total: 198.86, initialPercentage: 65, paidInitial: 129.26,
    })
    // `en_transito` is what a shipment holds until the team confirms receipt.
    await createShipment(sessionId, "en_transito", boxId)

    const queue = await listLocalTeamDeliveries(LOCAL_TEAM_ID)
    expect(queue.map((session) => session.id)).not.toContain(sessionId)
  })

  it("excludes an order whose up-front payment has not landed", async () => {
    fixtures = newFixtures()
    const boxId = await createBox(fixtures)
    const customer = await createCustomer(fixtures)
    const sessionId = await createSession(fixtures, customer, {
      state: "completada", total: 198.86, initialPercentage: 65,
    })
    await createShipment(sessionId, "recibido_equipo_local", boxId)

    const queue = await listLocalTeamDeliveries(LOCAL_TEAM_ID)
    expect(queue.map((session) => session.id)).not.toContain(sessionId)
  })

  it("keeps an order that has already been handed over, so the panel can show it as delivered", async () => {
    fixtures = newFixtures()
    const boxId = await createBox(fixtures)
    const customer = await createCustomer(fixtures)
    const sessionId = await createSession(fixtures, customer, {
      state: "completada", total: 198.86, initialPercentage: 65, paidInitial: 129.26,
    })
    await createShipment(sessionId, "entregado", boxId)

    const queue = await listLocalTeamDeliveries(LOCAL_TEAM_ID)
    expect(queue.map((session) => session.id)).toContain(sessionId)
  })

  // The boundary that matters. With one team the scoped and unscoped answers
  // are the same set, which is exactly why it needs a test: a second country is
  // the first time a mistake here shows up, and it shows up as a privacy breach.
  it("hides another country's delivery from a scoped team, and shows both to an admin", async () => {
    fixtures = newFixtures()
    const otherTeamId = await createLocalTeam(fixtures, "Peru")
    const colombiaBox = await createBox(fixtures, "recibida", LOCAL_TEAM_ID)
    const peruBox = await createBox(fixtures, "recibida", otherTeamId)

    const colombiaSession = await readyForDelivery(colombiaBox)
    const peruSession = await readyForDelivery(peruBox)

    const colombiaQueue = await listLocalTeamDeliveries(LOCAL_TEAM_ID)
    expect(colombiaQueue.map((session) => session.id)).toContain(colombiaSession)
    expect(colombiaQueue.map((session) => session.id)).not.toContain(peruSession)

    const peruQueue = await listLocalTeamDeliveries(otherTeamId)
    expect(peruQueue.map((session) => session.id)).toContain(peruSession)
    expect(peruQueue.map((session) => session.id)).not.toContain(colombiaSession)

    // An admin passes no team and oversees every destination.
    const adminQueue = await listLocalTeamDeliveries()
    const adminIds = adminQueue.map((session) => session.id)
    expect(adminIds).toContain(colombiaSession)
    expect(adminIds).toContain(peruSession)
  })
})

describe("box manifests", () => {
  // `listBoxManifests` now loads only the sessions packed into the boxes it is
  // about to return, rather than reading every session and discarding the rest.
  // The packing list it produces must not have changed.
  it("packs each box with its own sessions and leaves another team's box alone", async () => {
    fixtures = newFixtures()
    const otherTeamId = await createLocalTeam(fixtures, "Peru")
    const colombiaBox = await createBox(fixtures, "recibida", LOCAL_TEAM_ID)
    const peruBox = await createBox(fixtures, "recibida", otherTeamId)

    const customer = await createCustomer(fixtures, { nombre: "Camila Rojas" })
    const colombiaSession = await createSession(fixtures, customer, {
      state: "completada", total: 198.86, initialPercentage: 65, paidInitial: 129.26,
    })
    await createShipment(colombiaSession, "recibido_equipo_local", colombiaBox)

    const peruCustomer = await createCustomer(fixtures)
    const peruSession = await createSession(fixtures, peruCustomer, {
      state: "completada", total: 100, initialPercentage: 65, paidInitial: 65,
    })
    await createShipment(peruSession, "recibido_equipo_local", peruBox)

    const scoped = await listBoxManifests(undefined, LOCAL_TEAM_ID)
    const box = scoped.find((candidate) => candidate.id === colombiaBox)
    expect(box).toBeDefined()
    expect(box?.packages.map((item) => item.sessionId)).toEqual([colombiaSession])
    expect(box?.packages[0].customerName).toBe("Camila Rojas")
    expect(box?.customerCount).toBe(1)
    expect(scoped.map((candidate) => candidate.id)).not.toContain(peruBox)
  })
})
