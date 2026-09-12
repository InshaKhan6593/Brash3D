/**
 * Seeds the workflow states that automated API tests need but cannot reach on
 * their own.
 *
 * Most of the order lifecycle is driven here through the real HTTP API, so the
 * fixtures are produced by the same code paths a seller and the Colombia team
 * use. Only two transitions are written directly to the database:
 *
 *   1. Booking-fee confirmation, and
 *   2. Initial-payment confirmation,
 *
 * because both arrive exclusively through the signature-verified Stripe
 * webhook, which cannot be forged from a test. Those two writes replicate
 * `processBookingCheckoutEvent` and `processSessionCheckoutEvent` field for
 * field — including the payment_logs row and the staff notification — so the
 * resulting rows are indistinguishable from a genuine payment.
 *
 * States produced:
 *
 *   F1  completada, invoiced, unpaid          -> POST /api/payments/checkout (inicial)
 *   F2  initial paid, shipment 'preparacion'  -> POST /api/shipping (createBox)
 *   F3  box 'enviada', shipment 'en_transito' -> POST /api/local-team (receiveBox)
 *   F4  shipment 'recibido_equipo_local', 65% -> recordOfflinePayment / final checkout
 *   F5  shipment 'recibido_equipo_local', 100% -> confirmDeliveryWithoutBalance
 *
 * Usage (dev server must be running):
 *   node scripts/seed-test-fixtures.mjs
 *
 * Intended for the demo/test database only. It writes payment rows that no
 * money backs, so never point it at a database carrying real orders.
 */

import { readFileSync } from "node:fs"
import { randomUUID } from "node:crypto"
import pg from "pg"

const BASE = process.env.BASE_URL || "http://localhost:3000"
const ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL || "admin@brash3d.com"
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD

if (!ADMIN_PASSWORD) {
  console.error("Set SEED_ADMIN_PASSWORD to the admin account's password.")
  process.exit(1)
}

const env = Object.fromEntries(
  readFileSync(".env.local", "utf8")
    .split("\n")
    .filter((line) => line.includes("=") && !line.trim().startsWith("#"))
    .map((line) => [line.slice(0, line.indexOf("=")).trim(), line.slice(line.indexOf("=") + 1).trim()])
)

const pool = new pg.Pool({
  connectionString: env.DATABASE_URL,
  ssl: env.DATABASE_SSL_CA_FILE ? { ca: readFileSync(env.DATABASE_SSL_CA_FILE, "utf8") } : undefined,
})

/** The same rounding the application uses, so seeded amounts match to the cent. */
const round2 = (value) => Math.round((value + Number.EPSILON) * 100) / 100
const initialAmount = (total, percentage) => round2((total * Math.min(100, percentage)) / 100)

let cookie = ""

async function api(path, { method = "GET", body } = {}) {
  const response = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      // Every mutating route rejects a request without a matching Origin.
      Origin: BASE,
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  const setCookie = response.headers.getSetCookie?.() || []
  for (const entry of setCookie) {
    if (entry.startsWith("brash3d_staff_session=")) cookie = entry.split(";")[0]
  }
  const text = await response.text()
  let parsed
  try { parsed = JSON.parse(text) } catch { parsed = text }
  if (!response.ok) {
    throw new Error(`${method} ${path} -> ${response.status} ${typeof parsed === "string" ? parsed : JSON.stringify(parsed)}`)
  }
  return parsed
}

const sessionAction = (action, data) => api("/api/sessions", { method: "POST", body: { action, ...data } })

/**
 * Confirms a booking the way the Stripe booking-fee webhook does: the hold is
 * lifted and the slot becomes a genuine appointment.
 */
async function confirmBooking(client, sessionId) {
  const { rows } = await client.query(
    `UPDATE reservas r
        SET estado = 'confirmada',
            confirmed_at = COALESCE(r.confirmed_at, now()),
            hold_expires_at = NULL,
            payment_intent_id = COALESCE(r.payment_intent_id, $2)
       FROM sesiones_compra sc
      WHERE sc.reserva_id = r.id AND sc.id::text = $1 AND r.estado <> 'confirmada'
      RETURNING r.id::text`,
    [sessionId, `pi_fixture_booking_${randomUUID().slice(0, 12)}`]
  )
  return rows.length > 0
}

/**
 * Confirms the up-front payment exactly as `processSessionCheckoutEvent` would:
 * the amount is derived with the application's own rounding, and the ledger row
 * and seller notification are written alongside it.
 */
async function payInitial(client, sessionId, address, city) {
  const { rows } = await client.query(
    `SELECT sc.total::text AS total, sc.porcentaje_inicial::text AS pct,
            sc.vendedor_id::text AS seller_id, c.nombre AS customer_name
       FROM sesiones_compra sc JOIN clientes c ON c.id = sc.cliente_id
      WHERE sc.id::text = $1`,
    [sessionId]
  )
  const row = rows[0]
  if (!row) throw new Error(`session ${sessionId} not found`)

  const amount = initialAmount(Number(row.total), Number(row.pct)).toFixed(2)
  const paymentIntentId = `pi_fixture_inicial_${randomUUID().slice(0, 12)}`

  // The delivery address is captured by the checkout call, before payment.
  await client.query(
    `UPDATE sesiones_compra
        SET direccion_entrega = $2, ciudad_entrega = $3,
            direccion_confirmada_at = COALESCE(direccion_confirmada_at, now())
      WHERE id::text = $1`,
    [sessionId, address, city]
  )
  const updated = await client.query(
    `UPDATE sesiones_compra
        SET monto_pagado_inicial = $3, payment_intent_inicial_id = $2
      WHERE id::text = $1 AND monto_pagado_inicial = 0`,
    [sessionId, paymentIntentId, amount]
  )
  if (!updated.rowCount) return { amount, alreadyPaid: true }

  await client.query(
    `INSERT INTO payment_logs(payment_intent_id, sesion_id, monto, tipo_pago, estado, metadata)
     VALUES ($1, $2::uuid, $3, 'session_inicial', 'succeeded', $4::jsonb)`,
    [paymentIntentId, sessionId, amount, JSON.stringify({ seededFixture: true })]
  )
  await client.query(
    `INSERT INTO staff_notifications(seller_id, type, title, message)
     VALUES ($1::uuid, 'initial_payment_confirmed', 'Initial payment received', $2)`,
    [row.seller_id, `${row.customer_name} paid $${amount} (${Number(row.pct)}% up-front), confirmed by Stripe.`]
  )
  return { amount, alreadyPaid: false }
}

/** Drives a session from booked to closed-and-invoiced through the real API. */
async function invoice(client, { sessionId, products, percentage }) {
  await confirmBooking(client, sessionId)
  await sessionAction("start", { sessionId })
  for (const product of products) {
    await sessionAction("addProduct", { sessionId, ...product })
  }
  const { session } = await sessionAction("close", { sessionId, initialPercentage: percentage })
  return session
}

async function main() {
  console.log(`Signing in to ${BASE} as ${ADMIN_EMAIL}`)
  await api("/api/auth/login", { method: "POST", body: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD } })

  const client = await pool.connect()
  try {
    // Only sessions still open for editing are eligible to become fixtures.
    const { rows: candidates } = await client.query(
      `SELECT sc.id::text AS id, c.nombre AS customer
         FROM sesiones_compra sc
         JOIN clientes c ON c.id = sc.cliente_id
         JOIN reservas r ON r.id = sc.reserva_id
        WHERE sc.estado = 'en_progreso' AND sc.total = 0 AND r.estado <> 'cancelada'
        ORDER BY sc.fecha_inicio`
    )
    // Each run consumes its fixtures, so top up by booking real slots rather
    // than failing. Booking is rate limited to 10 per hour per IP, which is why
    // only the shortfall is created.
    if (candidates.length < 5) {
      const shortfall = 5 - candidates.length
      console.log(`Only ${candidates.length} editable sessions available; creating ${shortfall} booking(s).`)
      for (let index = 0; index < shortfall; index += 1) {
        const created = await createBooking(client, index)
        candidates.push(created)
        console.log(`    booked ${created.id}`)
      }
    }

    const [f1, f2, f3, f4, f5] = candidates
    const ADDRESS = "Calle 93 #11-27, Apartamento 402"
    const CITY = "Bogota"

    // F1 - closed and invoiced, deliberately left unpaid.
    console.log("\nF1  closed + invoiced, unpaid")
    const s1 = await invoice(client, {
      sessionId: f1.id,
      percentage: 65,
      products: [
        { nombre: "Nike Air Max 270", sku: "AM270-BLK-42", precio: 129.99, cantidad: 1 },
        { nombre: "Nike Dri-FIT Training Tee", sku: "DF-TEE-M", precio: 34.5, cantidad: 2 },
      ],
    })
    console.log(`    ${f1.id}  total $${s1.total}  -> unblocks POST /api/payments/checkout (inicial)`)

    // F2 - paid up front, shipment created, not yet boxed.
    console.log("\nF2  initial paid, shipment 'preparacion'")
    const s2 = await invoice(client, {
      sessionId: f2.id,
      percentage: 65,
      products: [{ nombre: "Nike Tech Fleece Hoodie", sku: "TF-HOOD-L", precio: 189.0, cantidad: 1 }],
    })
    const p2 = await payInitial(client, f2.id, ADDRESS, CITY)
    await sessionAction("updateDeliveryStatus", { sessionId: f2.id, status: "preparacion" })
    console.log(`    ${f2.id}  total $${s2.total}  paid $${p2.amount}  -> unblocks POST /api/shipping (createBox)`)

    // F3 - dispatched and in transit, waiting for Colombia to receive it.
    console.log("\nF3  box 'enviada', shipment 'en_transito'")
    const s3 = await invoice(client, {
      sessionId: f3.id,
      percentage: 65,
      products: [{ nombre: "Nike Pegasus 41", sku: "PEG41-WHT-41", precio: 145.0, cantidad: 1 }],
    })
    const p3 = await payInitial(client, f3.id, ADDRESS, CITY)
    await sessionAction("updateDeliveryStatus", { sessionId: f3.id, status: "preparacion" })
    const shipment3 = await shipmentIdFor(client, f3.id)
    const { box: boxA } = await api("/api/shipping", {
      method: "POST",
      body: { action: "createBox", shipmentIds: [shipment3], courier: "DHL Express", tracking: `DHL${Date.now()}` },
    })
    await api("/api/shipping", { method: "POST", body: { action: "dispatchBox", boxId: boxA.id } })
    console.log(`    ${f3.id}  total $${s3.total}  paid $${p3.amount}  box ${boxA.number}  -> unblocks POST /api/local-team (receiveBox)`)

    // F4 and F5 travel in one box that Colombia then receives, leaving both
    // shipments awaiting collection of the balance.
    console.log("\nF4  received in Colombia, 65% paid, balance outstanding")
    const s4 = await invoice(client, {
      sessionId: f4.id,
      percentage: 65,
      products: [{ nombre: "Nike Sportswear Club Joggers", sku: "CLB-JOG-M", precio: 64.99, cantidad: 2 }],
    })
    const p4 = await payInitial(client, f4.id, ADDRESS, CITY)
    await sessionAction("updateDeliveryStatus", { sessionId: f4.id, status: "preparacion" })

    console.log("F5  received in Colombia, paid 100% up front")
    const s5 = await invoice(client, {
      sessionId: f5.id,
      percentage: 100,
      products: [{ nombre: "Nike Everyday Cushioned Socks", sku: "SOCK-6PK", precio: 22.0, cantidad: 3 }],
    })
    const p5 = await payInitial(client, f5.id, ADDRESS, CITY)
    await sessionAction("updateDeliveryStatus", { sessionId: f5.id, status: "preparacion" })

    const shipment4 = await shipmentIdFor(client, f4.id)
    const shipment5 = await shipmentIdFor(client, f5.id)
    const { box: boxB } = await api("/api/shipping", {
      method: "POST",
      body: { action: "createBox", shipmentIds: [shipment4, shipment5], courier: "FedEx International", tracking: `FDX${Date.now()}` },
    })
    await api("/api/shipping", { method: "POST", body: { action: "dispatchBox", boxId: boxB.id } })
    await api("/api/local-team", { method: "POST", body: { action: "receiveBox", boxId: boxB.id } })
    console.log(`    ${f4.id}  total $${s4.total}  paid $${p4.amount}  -> unblocks recordOfflinePayment + final checkout`)
    console.log(`    ${f5.id}  total $${s5.total}  paid $${p5.amount}  -> unblocks confirmDeliveryWithoutBalance`)
    console.log(`    box ${boxB.number} received in Bogota`)

    console.log("\nResulting workflow states:")
    const { rows: summary } = await client.query(
      `SELECT sc.id::text AS session, sc.estado, sc.total::text AS total,
              sc.porcentaje_inicial::text AS pct, sc.monto_pagado_inicial::text AS paid_initial,
              sc.monto_pagado_final::text AS paid_final,
              COALESCE(e.estado::text, '-') AS shipment, COALESCE(cc.estado::text, '-') AS box
         FROM sesiones_compra sc
         LEFT JOIN envios e ON e.sesion_id = sc.id
         LEFT JOIN cajas_consolidadas cc ON cc.id = e.caja_id
        ORDER BY sc.estado, sc.total DESC`
    )
    console.table(summary)
  } finally {
    client.release()
    await pool.end()
  }
}

/**
 * Books a real slot through the public API, then confirms it the way the
 * booking-fee webhook would, so the session is immediately editable.
 */
async function createBooking(client, index) {
  const { slots } = await api("/api/slots")
  const slot = slots.find((candidate) => candidate.available)
  if (!slot) throw new Error("no available slot to book a fixture against")

  const stamp = `${Date.now()}${index}`
  const { session } = await api("/api/bookings", {
    method: "POST",
    body: {
      nombre: `Fixture Customer ${index + 1}`,
      email: `fixture+${stamp}@brash3d.test`,
      telefono: "+57 300 000 0000",
      ciudad: "Bogota",
      slotId: slot.id,
    },
  })
  await confirmBooking(client, session.id)
  return { id: session.id, customer: `Fixture Customer ${index + 1}` }
}

async function shipmentIdFor(client, sessionId) {
  const { rows } = await client.query("SELECT id::text FROM envios WHERE sesion_id = $1::uuid", [sessionId])
  if (!rows[0]) throw new Error(`no shipment for session ${sessionId}`)
  return rows[0].id
}

main().catch(async (error) => {
  console.error("\nSeeding failed:", error.message)
  await pool.end().catch(() => {})
  process.exit(1)
})
