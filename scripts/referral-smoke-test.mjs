import assert from "node:assert/strict"
import process from "node:process"
import nextEnv from "@next/env"
import pg from "pg"

const { loadEnvConfig } = nextEnv
loadEnvConfig(process.cwd())

const baseUrl = process.env.SMOKE_BASE_URL || "http://localhost:3000"
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL })
const stamp = Date.now()
const referrerEmail = `referrer-smoke-${stamp}@example.com`
const referredEmail = `referred-smoke-${stamp}@example.com`
const referralCode = `BR3D-SMOKE-${stamp}`
let referrerId
let referredId
let rewardId
let bookingId
let sessionId
let slotId

try {
  const referrer = await pool.query(`
    INSERT INTO clientes (nombre, email, telefono, ciudad, pais, codigo_referido)
    VALUES ('Referral Smoke Referrer', $1, $2, 'Bogota', 'Colombia', $3)
    RETURNING id::text
  `, [referrerEmail, `+1555${String(stamp).slice(-7)}`, referralCode])
  referrerId = referrer.rows[0].id

  const referred = await pool.query(`
    INSERT INTO clientes (nombre, email, telefono, ciudad, pais, codigo_referido, referido_por_id)
    VALUES ('Referral Smoke Referred', $1, $2, 'Cali', 'Colombia', $3, $4::uuid)
    RETURNING id::text
  `, [referredEmail, `+1444${String(stamp).slice(-7)}`, `BR3D-REFERRED-${stamp}`, referrerId])
  referredId = referred.rows[0].id

  const reward = await pool.query(`
    INSERT INTO referidos_recompensas (
      referidor_id, referido_id, monto_recompensa, estado, fecha_expiracion
    ) VALUES ($1::uuid, $2::uuid, 20.00, 'pendiente', now() + interval '1 day')
    RETURNING id::text
  `, [referrerId, referredId])
  rewardId = reward.rows[0].id

  const slotsResponse = await fetch(`${baseUrl}/api/slots`)
  const slotsBody = await slotsResponse.json()
  const slot = slotsBody.slots.find((candidate) => candidate.available)
  assert.ok(slot, "Expected an available appointment slot")
  slotId = slot.id

  const bookingResponse = await fetch(`${baseUrl}/api/bookings`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: baseUrl, "x-forwarded-for": "127.0.0.252" },
    body: JSON.stringify({
      nombre: "Referral Smoke Referrer",
      email: referrerEmail,
      telefono: `+1555${String(stamp).slice(-7)}`,
      ciudad: "Bogota",
      slotId,
    }),
  })
  const bookingBody = await bookingResponse.json()
  assert.equal(bookingResponse.status, 201)
  assert.equal(bookingBody.rewardApplied, true)
  bookingId = bookingBody.booking.id
  sessionId = bookingBody.session.id
  assert.equal(bookingBody.booking.estado, "confirmada")
  assert.equal(bookingBody.booking.montoReserva, 0)

  const bookingState = await pool.query(`
    SELECT estado, monto_reserva::text, recompensa_referido_id::text
    FROM reservas WHERE id::text = $1
  `, [bookingId])
  assert.deepEqual(bookingState.rows[0], {
    estado: "confirmada",
    monto_reserva: "0.00",
    recompensa_referido_id: rewardId,
  })

  const customerCookie = bookingResponse.headers.get("set-cookie")?.split(";", 1)[0]
  const historyResponse = await fetch(`${baseUrl}/api/customer-history?sessionId=${encodeURIComponent(sessionId)}`, {
    headers: { cookie: customerCookie },
  })
  const historyBody = await historyResponse.json()
  assert.equal(historyResponse.status, 200)
  assert.equal(historyBody.history.customer.referralCode, referralCode)
  assert.equal(historyBody.history.availableReferralRewards, 0)

  console.log("Referral smoke test passed: reward redemption and secure customer history")
} finally {
  const client = await pool.connect()
  try {
    await client.query("BEGIN")
    if (sessionId) {
      await client.query("DELETE FROM customer_session_access WHERE session_id::text = $1", [sessionId])
      await client.query("DELETE FROM sesiones_compra WHERE id::text = $1", [sessionId])
    }
    if (bookingId) {
      await client.query("DELETE FROM staff_notifications WHERE reserva_id::text = $1", [bookingId])
      await client.query("UPDATE reservas SET recompensa_referido_id = NULL WHERE id::text = $1", [bookingId])
    }
    if (rewardId) await client.query("DELETE FROM referidos_recompensas WHERE id::text = $1", [rewardId])
    if (bookingId) await client.query("DELETE FROM reservas WHERE id::text = $1", [bookingId])
    if (referredId) await client.query("DELETE FROM clientes WHERE id::text = $1", [referredId])
    if (referrerId) await client.query("DELETE FROM clientes WHERE id::text = $1", [referrerId])
    if (slotId) await client.query("UPDATE disponibilidad SET disponible = true WHERE id::text = $1", [slotId])
    await client.query("DELETE FROM request_rate_limits WHERE key = 'booking:127.0.0.252'")
    await client.query("COMMIT")
  } catch (error) {
    await client.query("ROLLBACK")
    throw error
  } finally {
    client.release()
    await pool.end()
  }
}
