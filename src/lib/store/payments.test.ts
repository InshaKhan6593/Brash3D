import { randomUUID } from "node:crypto"
import { afterEach, describe, expect, it } from "vitest"
import { query } from "@/lib/db"
import type { PaymentStage } from "@/lib/payment-split"
import { attachSessionCheckout, processSessionCheckoutEvent } from "@/lib/store/sessionStore"
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
  delete process.env.REFERRAL_REWARD_MONTHLY_CAP
})

function eventId(): string {
  return `evt_vitest_${randomUUID().replaceAll("-", "")}`
}

async function payableSession(
  stage: PaymentStage,
  options: { total?: number; referrerId?: string; customerId?: string } = {}
) {
  const total = options.total ?? 198.86
  const customer = options.customerId ?? await createCustomer(fixtures, { referrerId: options.referrerId })
  const sessionId = await createSession(fixtures, customer, {
    state: "completada",
    total,
    paidInitial: stage === "final" ? Number((total * 0.65).toFixed(2)) : 0,
  })
  if (stage === "final") await createShipment(sessionId, "recibido_equipo_local")
  const checkoutId = `cs_vitest_${randomUUID().replaceAll("-", "")}`
  const attached = await attachSessionCheckout(sessionId, stage, checkoutId)
  expect(attached).toBe(true)
  return { sessionId, checkoutId, customer, total }
}

async function paidAmounts(sessionId: string) {
  const row = await query<{ initial: string; final: string }>(
    "SELECT monto_pagado_inicial::text AS initial, monto_pagado_final::text AS final FROM sesiones_compra WHERE id = $1::uuid",
    [sessionId]
  )
  return { initial: Number(row.rows[0].initial), final: Number(row.rows[0].final) }
}

describe("session checkout webhook", () => {
  it("records the initial payment at the session's percentage", async () => {
    fixtures = newFixtures()
    const { sessionId, checkoutId } = await payableSession("inicial")
    const id = eventId()
    fixtures.webhookEvents.push(id)

    const outcome = await processSessionCheckoutEvent({
      eventId: id, checkoutSessionId: checkoutId, paymentIntentId: "pi_test", stage: "inicial", paid: true,
    })

    expect(outcome).toBe("confirmed")
    expect((await paidAmounts(sessionId)).initial).toBeCloseTo(129.26, 2)
  })

  it("records the final payment and marks the shipment delivered via Stripe", async () => {
    fixtures = newFixtures()
    const { sessionId, checkoutId } = await payableSession("final")
    const id = eventId()
    fixtures.webhookEvents.push(id)

    const outcome = await processSessionCheckoutEvent({
      eventId: id, checkoutSessionId: checkoutId, paymentIntentId: "pi_test", stage: "final", paid: true,
    })

    expect(outcome).toBe("confirmed")
    expect((await paidAmounts(sessionId)).final).toBeCloseTo(69.6, 2)

    const shipment = await query<{ estado: string; metodo: string; asignacion: string }>(
      "SELECT estado::text, metodo_pago_recibido AS metodo, asignacion_pago_final AS asignacion FROM envios WHERE sesion_id = $1::uuid",
      [sessionId]
    )
    expect(shipment.rows[0].estado).toBe("entregado")
    expect(shipment.rows[0].metodo).toBe("stripe")
    expect(shipment.rows[0].asignacion).toBe("ingreso_llc_usa")
  })

  it("the two stages together equal the invoice total", async () => {
    fixtures = newFixtures()
    const { sessionId, checkoutId, total } = await payableSession("inicial", { total: 198.86 })
    const first = eventId()
    fixtures.webhookEvents.push(first)
    await processSessionCheckoutEvent({
      eventId: first, checkoutSessionId: checkoutId, stage: "inicial", paid: true,
    })

    const finalCheckout = `cs_vitest_${randomUUID().replaceAll("-", "")}`
    await createShipment(sessionId, "recibido_equipo_local")
    await attachSessionCheckout(sessionId, "final", finalCheckout)
    const second = eventId()
    fixtures.webhookEvents.push(second)
    await processSessionCheckoutEvent({
      eventId: second, checkoutSessionId: finalCheckout, stage: "final", paid: true,
    })

    const amounts = await paidAmounts(sessionId)
    expect(amounts.initial + amounts.final).toBeCloseTo(total, 2)
  })

  it("ignores a replayed event instead of charging twice", async () => {
    fixtures = newFixtures()
    const { sessionId, checkoutId } = await payableSession("inicial")
    const id = eventId()
    fixtures.webhookEvents.push(id)
    const input = { eventId: id, checkoutSessionId: checkoutId, stage: "inicial" as const, paid: true }

    expect(await processSessionCheckoutEvent(input)).toBe("confirmed")
    expect(await processSessionCheckoutEvent(input)).toBe("duplicate")
    expect((await paidAmounts(sessionId)).initial).toBeCloseTo(129.26, 2)
  })

  it("ignores an unpaid checkout", async () => {
    fixtures = newFixtures()
    const { sessionId, checkoutId } = await payableSession("inicial")
    const id = eventId()
    fixtures.webhookEvents.push(id)

    const outcome = await processSessionCheckoutEvent({
      eventId: id, checkoutSessionId: checkoutId, stage: "inicial", paid: false,
    })

    expect(outcome).toBe("ignored")
    expect((await paidAmounts(sessionId)).initial).toBe(0)
  })

  it("ignores an event for an unknown checkout", async () => {
    fixtures = newFixtures()
    const id = eventId()
    fixtures.webhookEvents.push(id)
    const outcome = await processSessionCheckoutEvent({
      eventId: id, checkoutSessionId: "cs_does_not_exist", stage: "inicial", paid: true,
    })
    expect(outcome).toBe("ignored")
  })

  it("writes a payment log and a seller notification", async () => {
    fixtures = newFixtures()
    const { sessionId, checkoutId } = await payableSession("inicial")
    const id = eventId()
    fixtures.webhookEvents.push(id)
    await processSessionCheckoutEvent({
      eventId: id, checkoutSessionId: checkoutId, paymentIntentId: "pi_log", stage: "inicial", paid: true,
    })

    const logs = await query<{ monto: string; tipo: string; estado: string }>(
      "SELECT monto::text, tipo_pago AS tipo, estado FROM payment_logs WHERE sesion_id = $1::uuid",
      [sessionId]
    )
    expect(logs.rows).toHaveLength(1)
    expect(logs.rows[0].tipo).toBe("session_inicial")
    expect(logs.rows[0].estado).toBe("succeeded")
    expect(Number(logs.rows[0].monto)).toBeCloseTo(129.26, 2)

    const notifications = await query<{ type: string }>(
      `SELECT type FROM staff_notifications WHERE type = 'initial_payment_confirmed'
       AND created_at > now() - interval '1 minute'`
    )
    expect(notifications.rows.length).toBeGreaterThan(0)
  })
})

describe("referral rewards", () => {
  async function rewardCount(referrerId: string): Promise<number> {
    const result = await query<{ count: string }>(
      "SELECT count(*)::text AS count FROM referidos_recompensas WHERE referidor_id = $1::uuid",
      [referrerId]
    )
    return Number(result.rows[0].count)
  }

  async function payFirstSession(referrerId: string) {
    const { sessionId, checkoutId } = await payableSession("inicial", { referrerId })
    const id = eventId()
    fixtures.webhookEvents.push(id)
    await processSessionCheckoutEvent({
      eventId: id, checkoutSessionId: checkoutId, stage: "inicial", paid: true,
    })
    return sessionId
  }

  it("grants one reward on a referred customer's first paid session", async () => {
    fixtures = newFixtures()
    const referrer = await createCustomer(fixtures)
    await payFirstSession(referrer)
    expect(await rewardCount(referrer)).toBe(1)
  })

  it("grants nothing when the customer had no referrer", async () => {
    fixtures = newFixtures()
    const { checkoutId } = await payableSession("inicial")
    const id = eventId()
    fixtures.webhookEvents.push(id)
    await processSessionCheckoutEvent({
      eventId: id, checkoutSessionId: checkoutId, stage: "inicial", paid: true,
    })
    const total = await query<{ count: string }>(
      "SELECT count(*)::text AS count FROM referidos_recompensas WHERE referido_id = ANY($1::uuid[])",
      [fixtures.customers]
    )
    expect(Number(total.rows[0].count)).toBe(0)
  })

  it("does not reward a second session from the same referred customer", async () => {
    fixtures = newFixtures()
    const referrer = await createCustomer(fixtures)
    const referred = await createCustomer(fixtures, { referrerId: referrer })

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const { checkoutId } = await payableSession("inicial", { customerId: referred })
      const id = eventId()
      fixtures.webhookEvents.push(id)
      await processSessionCheckoutEvent({
        eventId: id, checkoutSessionId: checkoutId, stage: "inicial", paid: true,
      })
    }

    // The specification deduplicated by booking, which would have paid twice.
    expect(await rewardCount(referrer)).toBe(1)
  })

  it("stops granting rewards once the monthly cap is reached", async () => {
    fixtures = newFixtures()
    process.env.REFERRAL_REWARD_MONTHLY_CAP = "2"
    const referrer = await createCustomer(fixtures)

    await payFirstSession(referrer)
    await payFirstSession(referrer)
    expect(await rewardCount(referrer)).toBe(2)

    await payFirstSession(referrer)
    expect(await rewardCount(referrer)).toBe(2)
  })

  it("still records the payment when the reward is capped", async () => {
    fixtures = newFixtures()
    process.env.REFERRAL_REWARD_MONTHLY_CAP = "0"
    const referrer = await createCustomer(fixtures)
    const sessionId = await payFirstSession(referrer)

    expect(await rewardCount(referrer)).toBe(0)
    expect((await paidAmounts(sessionId)).initial).toBeCloseTo(129.26, 2)
  })
})
