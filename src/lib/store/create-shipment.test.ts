import { afterEach, describe, expect, it } from "vitest"
import { updateDeliveryStatus } from "@/lib/store/sessionStore"
import { cleanup, createCustomer, createSession, createShipment, newFixtures, type Fixtures } from "@/test/fixtures"

let fixtures: Fixtures

afterEach(async () => {
  if (fixtures) await cleanup(fixtures)
})

/**
 * The seller now creates the individual shipment straight from the session
 * listing, rather than opening the panel to press a second button. That makes
 * this the write behind a one-click action, so what it does on the happy path
 * and every reason it refuses both matter — the seller has no panel to open and
 * inspect when it says no.
 */
describe("creating the individual shipment", () => {
  it("creates the shipment and returns a label code to show the seller", async () => {
    fixtures = newFixtures()
    const customer = await createCustomer(fixtures, { nombre: "Camila Rodríguez" })
    const sessionId = await createSession(fixtures, customer, {
      state: "completada", total: 198.86, paidInitial: 129.26,
    })

    const session = await updateDeliveryStatus(sessionId, "preparacion")

    expect(session?.envio?.estado).toBe("preparacion")
    // The code is what the seller copies onto the package, so it has to come
    // back from this call rather than be fetched separately.
    expect(session?.envio?.labelCode).toBeTruthy()
    // Accents and spaces are stripped: this is written on a box by hand.
    expect(session?.envio?.labelCode).toMatch(/^BR3D-CAMILARODRIGUEZ-[0-9A-F]{8}$/)
  })

  it("carries the customer's confirmed address onto the shipment", async () => {
    fixtures = newFixtures()
    const customer = await createCustomer(fixtures)
    const sessionId = await createSession(fixtures, customer, {
      state: "completada", total: 198.86, paidInitial: 129.26,
    })

    const session = await updateDeliveryStatus(sessionId, "preparacion")

    expect(session?.envio?.deliveryAddress).toBe("Calle 100 #10-20")
    expect(session?.envio?.deliveryCity).toBe("Bogota")
  })

  it("refuses before the up-front payment is confirmed", async () => {
    // The gate the menu item shares: no money, no shipment.
    fixtures = newFixtures()
    const customer = await createCustomer(fixtures)
    const sessionId = await createSession(fixtures, customer, {
      state: "completada", total: 198.86, paidInitial: 0,
    })

    expect(await updateDeliveryStatus(sessionId, "preparacion")).toBeNull()
  })

  it("refuses when the customer has not confirmed a delivery address", async () => {
    // Paid, but nowhere to send it. The shipment copies the address, so
    // creating one here would produce a label with no destination.
    fixtures = newFixtures()
    const customer = await createCustomer(fixtures)
    const sessionId = await createSession(fixtures, customer, {
      state: "completada", total: 198.86, paidInitial: 129.26, withAddress: false,
    })

    expect(await updateDeliveryStatus(sessionId, "preparacion")).toBeNull()
  })

  it("refuses a second shipment for the same order", async () => {
    // Double-clicking the menu item must not produce two packages.
    fixtures = newFixtures()
    const customer = await createCustomer(fixtures)
    const sessionId = await createSession(fixtures, customer, {
      state: "completada", total: 198.86, paidInitial: 129.26,
    })
    await createShipment(sessionId, "preparacion")

    expect(await updateDeliveryStatus(sessionId, "preparacion")).toBeNull()
  })

  it("refuses a session the seller has not closed", async () => {
    fixtures = newFixtures()
    const customer = await createCustomer(fixtures)
    const sessionId = await createSession(fixtures, customer, { paidInitial: 129.26 })

    expect(await updateDeliveryStatus(sessionId, "preparacion")).toBeNull()
  })
})
