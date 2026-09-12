import { afterEach, describe, expect, it } from "vitest"
import { transaction } from "@/lib/db"
import { resolveBoxDestination } from "@/lib/store/shippingStore"
import { cleanup, createCustomer, createSession, createShipment, LOCAL_TEAM_ID, newFixtures } from "@/test/fixtures"

/**
 * A consolidated box travels to one place. Before this logic existed the
 * destination team was an inlined UUID and the country the literal 'Colombia',
 * so these rules had nowhere to live -- and no panel can reach them, because
 * the seller UI only ever offers shipments that are already Colombian.
 */
describe("resolveBoxDestination", () => {
  const fixtures = newFixtures()

  afterEach(async () => {
    await cleanup(fixtures)
  })

  async function shipmentFor(country?: string): Promise<string> {
    const customerId = await createCustomer(fixtures, country ? { country } : {})
    const sessionId = await createSession(fixtures, customerId, { state: "completada" })
    return createShipment(sessionId, "preparacion")
  }

  it("takes the destination and the receiving team from the customers in the box", async () => {
    const shipments = [await shipmentFor(), await shipmentFor()]

    const destination = await transaction((client) => resolveBoxDestination(client, shipments))

    expect(destination.country).toBe("Colombia")
    expect(destination.teamId).toBe(LOCAL_TEAM_ID)
  })

  it("refuses to put two countries in one box", async () => {
    const shipments = [await shipmentFor("Colombia"), await shipmentFor("Perú")]

    await expect(transaction((client) => resolveBoxDestination(client, shipments)))
      .rejects.toThrow("DESTINATION_MIXED")
  })

  it("refuses a destination with no local team rather than writing a dangling box", async () => {
    const shipments = [await shipmentFor("Perú")]

    await expect(transaction((client) => resolveBoxDestination(client, shipments)))
      .rejects.toThrow("NO_LOCAL_TEAM")
  })

  it("reports a selection that no longer matches any shipment", async () => {
    await expect(transaction((client) => resolveBoxDestination(client, ["11111111-1111-4111-8111-111111111111"])))
      .rejects.toThrow("SHIPMENT_SELECTION_CHANGED")
  })

  // A country typed by hand, or left blank by an older row, must still reach the
  // Colombian team rather than failing -- every existing customer predates the
  // registry.
  it("treats a blank country as the default destination", async () => {
    const shipments = [await shipmentFor("   ")]

    const destination = await transaction((client) => resolveBoxDestination(client, shipments))

    expect(destination.country).toBe("Colombia")
    expect(destination.teamId).toBe(LOCAL_TEAM_ID)
  })
})
