import assert from "node:assert/strict"
import process from "node:process"
import nextEnv from "@next/env"
import pg from "pg"
import Stripe from "stripe"

const { loadEnvConfig } = nextEnv
loadEnvConfig(process.cwd())

const baseUrl = process.env.SMOKE_BASE_URL || "http://localhost:3000"
const stripeSecret = process.env.STRIPE_SECRET_KEY
const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET
assert.ok(stripeSecret?.startsWith("sk_test_"), "Expected a Stripe Test Mode secret key")
assert.ok(webhookSecret?.startsWith("whsec_"), "Expected a Stripe webhook signing secret")

const stripe = new Stripe(stripeSecret)
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL })
const stamp = Date.now()
const referrerEmail = `webhook-referrer-${stamp}@example.com`
const referredEmail = `webhook-referred-${stamp}@example.com`
const referralCode = `BR3D-WEBHOOK-${stamp}`
const checkoutSessionId = `cs_test_referral_${stamp}`
const eventId = `evt_referral_${stamp}`
let referrerId
let referredId
let paidBookingId
let paidSessionId
let redeemedBookingId
let redeemedSessionId
let paidSlotId
let redeemedSlotId

try {
  const slots = await pool.query(`
    SELECT d.id::text, d.vendedor_id::text AS seller_id, d.fecha::text,
      to_char(d.hora_inicio, 'HH24:MI') AS start_time
    FROM disponibilidad d
    JOIN vendedores v ON v.id = d.vendedor_id AND v.activo = true
    WHERE d.disponible = true AND d.fecha >= current_date
    ORDER BY d.fecha, d.hora_inicio
    LIMIT 2
  `)
  assert.equal(slots.rows.length, 2, "Expected two available slots")
  paidSlotId = slots.rows[0].id
  redeemedSlotId = slots.rows[1].id

  const referrer = await pool.query(`
    INSERT INTO clientes (nombre, email, telefono, ciudad, pais, codigo_referido)
    VALUES ('Webhook Referral Referrer', $1, $2, 'Bogota', 'Colombia', $3)
    RETURNING id::text
  `, [referrerEmail, `+1555${String(stamp).slice(-7)}`, referralCode])
  referrerId = referrer.rows[0].id

  const referred = await pool.query(`
    INSERT INTO clientes (nombre, email, telefono, ciudad, pais, codigo_referido, referido_por_id)
    VALUES ('Webhook Referral Referred', $1, $2, 'Cali', 'Colombia', $3, $4::uuid)
    RETURNING id::text
  `, [referredEmail, `+1444${String(stamp).slice(-7)}`, `BR3D-REFERRED-${stamp}`, referrerId])
  referredId = referred.rows[0].id

  const paidBooking = await pool.query(`
    INSERT INTO reservas (cliente_id, disponibilidad_id, fecha_hora, estado, monto_reserva, confirmed_at)
    VALUES ($1::uuid, $2::uuid, now(), 'confirmada', 20.00, now())
    RETURNING id::text
  `, [referredId, paidSlotId])
  paidBookingId = paidBooking.rows[0].id
  const paidSession = await pool.query(`
    INSERT INTO sesiones_compra (
      reserva_id, vendedor_id, cliente_id, estado, total, checkout_session_65_id
    ) VALUES ($1::uuid, $2::uuid, $3::uuid, 'completada', 100.00, $4)
    RETURNING id::text
  `, [paidBookingId, slots.rows[0].seller_id, referredId, checkoutSessionId])
  paidSessionId = paidSession.rows[0].id

  const eventPayload = JSON.stringify({
    id: eventId,
    object: "event",
    type: "checkout.session.completed",
    data: {
      object: {
        id: checkoutSessionId,
        object: "checkout.session",
        payment_status: "paid",
        payment_intent: `pi_referral_${stamp}`,
        metadata: { payment_stage: "session_65" },
      },
    },
  })
  const signature = stripe.webhooks.generateTestHeaderString({ payload: eventPayload, secret: webhookSecret })
  const webhookResponse = await fetch(`${baseUrl}/api/stripe/webhook`, {
    method: "POST",
    headers: { "content-type": "application/json", "stripe-signature": signature },
    body: eventPayload,
  })
  const webhookBody = await webhookResponse.json()
  assert.equal(webhookResponse.status, 200)
  assert.equal(webhookBody.outcome, "confirmed")

  const earnedReward = await pool.query(`
    SELECT id::text, referidor_id::text, referido_id::text, reserva_aplicada_id::text, estado
    FROM referidos_recompensas WHERE referido_id = $1::uuid
  `, [referredId])
  assert.deepEqual(earnedReward.rows[0], {
    id: earnedReward.rows[0].id,
    referidor_id: referrerId,
    referido_id: referredId,
    reserva_aplicada_id: paidBookingId,
    estado: "pendiente",
  })

  const redemptionResponse = await fetch(`${baseUrl}/api/bookings`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: baseUrl, "x-forwarded-for": "127.0.0.251" },
    body: JSON.stringify({
      nombre: "Webhook Referral Referrer",
      email: referrerEmail,
      telefono: `+1555${String(stamp).slice(-7)}`,
      ciudad: "Bogota",
      slotId: redeemedSlotId,
    }),
  })
  const redemptionBody = await redemptionResponse.json()
  assert.equal(redemptionResponse.status, 201)
  assert.equal(redemptionBody.rewardApplied, true)
  redeemedBookingId = redemptionBody.booking.id
  redeemedSessionId = redemptionBody.session.id

  const rewardAfterRedemption = await pool.query(`
    SELECT estado, reserva_recompensa_usada_id::text
    FROM referidos_recompensas WHERE id::text = $1
  `, [earnedReward.rows[0].id])
  assert.deepEqual(rewardAfterRedemption.rows[0], {
    estado: "aplicada",
    reserva_recompensa_usada_id: redeemedBookingId,
  })

  const customerCookie = redemptionResponse.headers.get("set-cookie")?.split(";", 1)[0]
  const historyResponse = await fetch(`${baseUrl}/api/customer-history?sessionId=${encodeURIComponent(redeemedSessionId)}`, {
    headers: { cookie: customerCookie },
  })
  const historyBody = await historyResponse.json()
  assert.equal(historyResponse.status, 200)
  assert.equal(historyBody.history.customer.referralCode, referralCode)
  assert.equal(historyBody.history.availableReferralRewards, 0)

  console.log("Referral webhook smoke test passed: signed 65% payment, earned reward, redemption, and secure history")
} finally {
  const client = await pool.connect()
  try {
    await client.query("BEGIN")
    for (const sessionId of [paidSessionId, redeemedSessionId].filter(Boolean)) {
      await client.query("DELETE FROM customer_session_access WHERE session_id::text = $1", [sessionId])
      await client.query("DELETE FROM payment_logs WHERE sesion_id::text = $1", [sessionId])
      await client.query("DELETE FROM sesiones_compra WHERE id::text = $1", [sessionId])
    }
    if (redeemedBookingId) {
      await client.query("DELETE FROM staff_notifications WHERE reserva_id::text = $1", [redeemedBookingId])
      await client.query("UPDATE reservas SET recompensa_referido_id = NULL WHERE id::text = $1", [redeemedBookingId])
    }
    if (referredId) await client.query("DELETE FROM referidos_recompensas WHERE referido_id::text = $1", [referredId])
    for (const bookingId of [paidBookingId, redeemedBookingId].filter(Boolean)) {
      await client.query("DELETE FROM reservas WHERE id::text = $1", [bookingId])
    }
    await client.query("DELETE FROM stripe_webhook_events WHERE event_id = $1", [eventId])
    await client.query("DELETE FROM staff_notifications WHERE message LIKE $1", [`Webhook Referral Referred's 65% payment was confirmed by Stripe.%`])
    if (referredId) await client.query("DELETE FROM clientes WHERE id::text = $1", [referredId])
    if (referrerId) await client.query("DELETE FROM clientes WHERE id::text = $1", [referrerId])
    for (const slotId of [paidSlotId, redeemedSlotId].filter(Boolean)) {
      await client.query("UPDATE disponibilidad SET disponible = true WHERE id::text = $1", [slotId])
    }
    await client.query("DELETE FROM request_rate_limits WHERE key = 'booking:127.0.0.251'")
    await client.query("COMMIT")
  } catch (error) {
    await client.query("ROLLBACK")
    throw error
  } finally {
    client.release()
    await pool.end()
  }
}
