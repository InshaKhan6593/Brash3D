import { randomUUID } from "node:crypto"
import { afterEach, describe, expect, it } from "vitest"
import { query } from "@/lib/db"
import {
  attachSessionCheckout,
  processSessionCheckoutEvent,
  takeOpenCheckoutForStage,
} from "@/lib/store/sessionStore"
import {
  cleanup,
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

function eventId(): string {
  return `evt_dup_${randomUUID().replaceAll("-", "")}`
}

/**
 * An order whose balance the Colombia team has already collected offline, with
 * the Stripe link that was sent for it still attached.
 *
 * This is the real sequence: the team copies the payment link, the customer
 * turns up with cash instead, and the link stays payable in Stripe.
 */
async function settledOfflineWithOpenLink(total = 198.86) {
  const customer = await createCustomer(fixtures)
  const initial = Number((total * 0.65).toFixed(2))
  const sessionId = await createSession(fixtures, customer, {
    state: "completada", total, paidInitial: initial, initialPercentage: 65,
  })
  await createShipment(sessionId, "recibido_equipo_local")
  const checkoutId = `cs_dup_${randomUUID().replaceAll("-", "")}`
  expect(await attachSessionCheckout(sessionId, "final", checkoutId)).toBe(true)
  // The team records the cash, settling the balance.
  await query(
    "UPDATE sesiones_compra SET monto_pagado_final = round(total - round(total * 0.65, 2), 2) WHERE id = $1::uuid",
    [sessionId]
  )
  await query(
    "UPDATE envios SET estado='entregado', metodo_pago_recibido='efectivo' WHERE sesion_id = $1::uuid",
    [sessionId]
  )
  return { sessionId, checkoutId }
}

async function paidFinal(sessionId: string): Promise<number> {
  const row = await query<{ final: string }>(
    "SELECT monto_pagado_final::text AS final FROM sesiones_compra WHERE id = $1::uuid",
    [sessionId]
  )
  return Number(row.rows[0].final)
}

async function paymentLogs(sessionId: string) {
  const rows = await query<{ estado: string; monto: string; tipo_pago: string }>(
    "SELECT estado, monto::text, tipo_pago FROM payment_logs WHERE sesion_id = $1::uuid ORDER BY created_at",
    [sessionId]
  )
  return rows.rows
}

describe("duplicate payment after an offline collection", () => {
  it("refuses money for a balance already collected, without recording the event", async () => {
    // Not recording the event is what lets the caller refund and come back.
    fixtures = newFixtures()
    const { checkoutId } = await settledOfflineWithOpenLink()
    const id = eventId()

    const outcome = await processSessionCheckoutEvent({
      eventId: id, checkoutSessionId: checkoutId, paymentIntentId: "pi_dup", stage: "final", paid: true,
    })

    expect(outcome).toBe("already_settled")
    const recorded = await query("SELECT 1 FROM stripe_webhook_events WHERE event_id = $1", [id])
    expect(recorded.rowCount).toBe(0)
  })

  it("does not overwrite the cash collection with the card charge", async () => {
    // The cash is physically in hand; the card charge is the one to reverse.
    fixtures = newFixtures()
    const { sessionId, checkoutId } = await settledOfflineWithOpenLink()
    const expected = await paidFinal(sessionId)
    const id = eventId()

    await processSessionCheckoutEvent({
      eventId: id, checkoutSessionId: checkoutId, paymentIntentId: "pi_dup", stage: "final", paid: true,
    })

    expect(await paidFinal(sessionId)).toBeCloseTo(expected, 2)
    const method = await query<{ metodo: string }>(
      "SELECT metodo_pago_recibido::text AS metodo FROM envios WHERE sesion_id = $1::uuid", [sessionId]
    )
    expect(method.rows[0].metodo).toBe("efectivo")
  })

  it("records the refund against the order once the caller has reversed it", async () => {
    // The whole point: a real charge must leave a trace. Before this, the
    // event fell through to "ignored" and nothing anywhere showed that Stripe
    // was holding money the customer had already paid in cash.
    fixtures = newFixtures()
    const { sessionId, checkoutId } = await settledOfflineWithOpenLink()
    const id = eventId()
    fixtures.webhookEvents.push(id)

    const outcome = await processSessionCheckoutEvent({
      eventId: id, checkoutSessionId: checkoutId, paymentIntentId: "pi_dup",
      stage: "final", paid: true, duplicateRefunded: true,
    })

    expect(outcome).toBe("already_settled")
    const refunds = (await paymentLogs(sessionId)).filter((row) => row.estado === "refunded")
    expect(refunds).toHaveLength(1)
    expect(Number(refunds[0].monto)).toBeCloseTo(69.6, 2)
    // And the event is now recorded, so a Stripe retry cannot refund twice.
    const recorded = await query("SELECT 1 FROM stripe_webhook_events WHERE event_id = $1", [id])
    expect(recorded.rowCount).toBe(1)
  })

  it("detaches the link so a retry cannot match the order again", async () => {
    fixtures = newFixtures()
    const { sessionId, checkoutId } = await settledOfflineWithOpenLink()
    const id = eventId()
    fixtures.webhookEvents.push(id)

    await processSessionCheckoutEvent({
      eventId: id, checkoutSessionId: checkoutId, paymentIntentId: "pi_dup",
      stage: "final", paid: true, duplicateRefunded: true,
    })

    const row = await query<{ checkout: string | null }>(
      "SELECT checkout_session_final_id AS checkout FROM sesiones_compra WHERE id = $1::uuid", [sessionId]
    )
    expect(row.rows[0].checkout).toBeNull()
  })

  it("hands the open checkout id to the caller exactly once", async () => {
    // `takeOpenCheckoutForStage` is what the offline collection uses to expire
    // the link in Stripe. Returning the id twice would let two collections
    // both try to expire it; returning the new value instead of the old one
    // -- which is what a plain UPDATE ... RETURNING does -- would expire
    // nothing at all.
    fixtures = newFixtures()
    const customer = await createCustomer(fixtures)
    const sessionId = await createSession(fixtures, customer, {
      state: "completada", total: 198.86, paidInitial: 129.26, initialPercentage: 65,
    })
    await createShipment(sessionId, "recibido_equipo_local")
    const checkoutId = `cs_dup_${randomUUID().replaceAll("-", "")}`
    expect(await attachSessionCheckout(sessionId, "final", checkoutId)).toBe(true)

    expect(await takeOpenCheckoutForStage(sessionId, "final")).toBe(checkoutId)
    expect(await takeOpenCheckoutForStage(sessionId, "final")).toBeNull()
  })
})
