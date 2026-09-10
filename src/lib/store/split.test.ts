import { randomUUID } from "node:crypto"
import { afterEach, describe, expect, it } from "vitest"
import { query } from "@/lib/db"
import { attachSessionCheckout, processSessionCheckoutEvent } from "@/lib/store/sessionStore"
import { listBoxManifests } from "@/lib/store/shippingStore"
import {
  cleanup,
  createBox,
  createCustomer,
  createSession,
  createShipment,
  newFixtures,
  type Fixtures,
} from "@/test/fixtures"

let fixtures: Fixtures

afterEach(async () => {
  if (fixtures) await cleanup(fixtures)
})

async function payInitial(sessionId: string) {
  const checkoutId = `cs_split_${randomUUID().replaceAll("-", "")}`
  expect(await attachSessionCheckout(sessionId, "inicial", checkoutId)).toBe(true)
  const eventId = `evt_split_${randomUUID().replaceAll("-", "")}`
  fixtures.webhookEvents.push(eventId)
  const outcome = await processSessionCheckoutEvent({
    eventId, checkoutSessionId: checkoutId, stage: "inicial", paid: true,
  })
  return outcome
}

async function amounts(sessionId: string) {
  const row = await query<{ initial: string; final: string; percentage: string }>(`
    SELECT monto_pagado_inicial::text AS initial, monto_pagado_final::text AS final,
      porcentaje_inicial::text AS percentage
    FROM sesiones_compra WHERE id = $1::uuid
  `, [sessionId])
  return {
    initial: Number(row.rows[0].initial),
    final: Number(row.rows[0].final),
    percentage: Number(row.rows[0].percentage),
  }
}

describe("configurable payment split", () => {
  // The client: "if there is someone that pays 85% and the 15 when the products
  // are deliver ok... or someone that works for 65% and 35%".
  it.each([
    [65, 129.26, 69.6],
    [85, 169.03, 29.83],
    [50, 99.43, 99.43],
    [100, 198.86, 0],
  ])("charges %i%% up front on a $198.86 invoice", async (percentage, expectedInitial, expectedFinal) => {
    fixtures = newFixtures()
    const customer = await createCustomer(fixtures)
    const sessionId = await createSession(fixtures, customer, {
      state: "completada", total: 198.86, initialPercentage: percentage,
    })

    expect(await payInitial(sessionId)).toBe("confirmed")
    const paid = await amounts(sessionId)
    expect(paid.initial).toBeCloseTo(expectedInitial, 2)

    const logged = await query<{ monto: string }>(
      "SELECT monto::text FROM payment_logs WHERE sesion_id = $1::uuid", [sessionId]
    )
    expect(Number(logged.rows[0].monto)).toBeCloseTo(expectedInitial, 2)
    // What is left to collect on delivery.
    expect(198.86 - expectedInitial).toBeCloseTo(expectedFinal, 2)
  })

  it("refuses a final checkout when the customer already paid in full", async () => {
    fixtures = newFixtures()
    const customer = await createCustomer(fixtures)
    const sessionId = await createSession(fixtures, customer, {
      state: "completada", total: 500, initialPercentage: 100,
    })
    await payInitial(sessionId)
    await createShipment(sessionId, "recibido_equipo_local")

    const attached = await attachSessionCheckout(sessionId, "final", `cs_none_${randomUUID()}`)
    expect(attached).toBe(false)
  })

  it("still allows a final checkout when a balance remains", async () => {
    fixtures = newFixtures()
    const customer = await createCustomer(fixtures)
    const sessionId = await createSession(fixtures, customer, {
      state: "completada", total: 500, initialPercentage: 85,
    })
    await payInitial(sessionId)
    await createShipment(sessionId, "recibido_equipo_local")

    expect(await attachSessionCheckout(sessionId, "final", `cs_yes_${randomUUID()}`)).toBe(true)
  })

  it("keeps the database constraint on impossible percentages", async () => {
    fixtures = newFixtures()
    const customer = await createCustomer(fixtures)
    await expect(
      createSession(fixtures, customer, { initialPercentage: 0 })
    ).rejects.toThrow()
    await expect(
      createSession(fixtures, customer, { initialPercentage: 101 })
    ).rejects.toThrow()
  })

  it("reports no outstanding balance on the box manifest for a prepaid order", async () => {
    fixtures = newFixtures()
    const customer = await createCustomer(fixtures)
    const sessionId = await createSession(fixtures, customer, {
      state: "completada", total: 300, initialPercentage: 100,
    })
    await payInitial(sessionId)
    const boxId = await createBox(fixtures)
    await createShipment(sessionId, "recibido_equipo_local", boxId)

    const boxes = await listBoxManifests()
    const box = boxes.find((item) => item.id === boxId)
    expect(box).toBeDefined()
    expect(box!.packages[0].remainingBalance).toBe(0)
    expect(box!.settlement.pending).toBe(0)
  })

  it("reports the correct outstanding balance for an 85/15 order", async () => {
    fixtures = newFixtures()
    const customer = await createCustomer(fixtures)
    const sessionId = await createSession(fixtures, customer, {
      state: "completada", total: 200, initialPercentage: 85,
    })
    await payInitial(sessionId)
    const boxId = await createBox(fixtures)
    await createShipment(sessionId, "recibido_equipo_local", boxId)

    const boxes = await listBoxManifests()
    const box = boxes.find((item) => item.id === boxId)
    expect(box!.packages[0].remainingBalance).toBeCloseTo(30, 2)
    expect(box!.settlement.pending).toBeCloseTo(30, 2)
  })
})
