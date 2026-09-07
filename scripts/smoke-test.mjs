import assert from "node:assert/strict"
import { randomBytes, scrypt as scryptCallback } from "node:crypto"
import process from "node:process"
import { promisify } from "node:util"
import nextEnv from "@next/env"
import pg from "pg"

const { loadEnvConfig } = nextEnv
loadEnvConfig(process.cwd())

const baseUrl = process.env.SMOKE_BASE_URL || "http://localhost:3000"
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL })
const scrypt = promisify(scryptCallback)
const stamp = Date.now()
const email = `smoke-${stamp}@example.com`
const staffEmail = `staff-smoke-${stamp}@example.com`
const localStaffEmail = `local-smoke-${stamp}@example.com`
const staffPassword = "Smoke-Test-Password-42!"
const smokeIp = "127.0.0.254"
let bookingId
let sessionId
let slotId
let staffId
let staffCookie
let localStaffId
let localStaffCookie
let boxId

async function jsonRequest(path, options) {
  const response = await fetch(`${baseUrl}${path}`, options)
  const body = await response.json()
  return { response, body }
}

try {
  const health = await jsonRequest("/api/health")
  assert.equal(health.response.status, 200)
  assert.equal(health.body.database, "connected")

  const slots = await jsonRequest("/api/slots")
  const slot = slots.body.slots.find((candidate) => candidate.available)
  assert.ok(slot, "Expected an available appointment slot")
  assert.ok(slots.body.slots.every((candidate) => candidate.outlet === "Nike Sawgrass"))
  slotId = slot.id

  const unauthorizedDashboard = await jsonRequest("/api/sessions")
  assert.equal(unauthorizedDashboard.response.status, 401)

  const salt = randomBytes(16).toString("base64url")
  const passwordHash = await scrypt(staffPassword, salt, 64, { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 })
  const staffInsert = await pool.query(`
    INSERT INTO staff_users (name, email, password_hash, password_salt, role)
    VALUES ('Smoke Test Admin', $1, $2, $3, 'admin') RETURNING id::text
  `, [staffEmail, Buffer.from(passwordHash).toString("base64url"), salt])
  staffId = staffInsert.rows[0].id
  const localStaffInsert = await pool.query(`
    INSERT INTO staff_users (name, email, password_hash, password_salt, role, local_team_id)
    VALUES ('Smoke Test Colombia', $1, $2, $3, 'local_team', '20000000-0000-4000-8000-000000000001') RETURNING id::text
  `, [localStaffEmail, Buffer.from(passwordHash).toString("base64url"), salt])
  localStaffId = localStaffInsert.rows[0].id

  const invalidLogin = await jsonRequest("/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json", origin: baseUrl, "x-forwarded-for": smokeIp },
    body: JSON.stringify({ email: staffEmail, password: "incorrect" }),
  })
  assert.equal(invalidLogin.response.status, 401)

  const login = await jsonRequest("/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json", origin: baseUrl, "x-forwarded-for": smokeIp },
    body: JSON.stringify({ email: staffEmail, password: staffPassword }),
  })
  assert.equal(login.response.status, 200)
  staffCookie = login.response.headers.get("set-cookie")?.split(";", 1)[0]
  assert.ok(staffCookie?.startsWith("brash3d_staff_session="))

  const localLogin = await jsonRequest("/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json", origin: baseUrl, "x-forwarded-for": "127.0.0.253" },
    body: JSON.stringify({ email: localStaffEmail, password: staffPassword }),
  })
  assert.equal(localLogin.response.status, 200)
  localStaffCookie = localLogin.response.headers.get("set-cookie")?.split(";", 1)[0]
  assert.ok(localStaffCookie?.startsWith("brash3d_staff_session="))

  const bookingPayload = {
    nombre: "Automated Smoke Test",
    email,
    telefono: `+1555${String(stamp).slice(-7)}`,
    ciudad: "Bogota",
    slotId,
  }
  const create = await jsonRequest("/api/bookings", {
    method: "POST",
    headers: { "content-type": "application/json", origin: baseUrl, "x-forwarded-for": smokeIp },
    body: JSON.stringify(bookingPayload),
  })
  assert.equal(create.response.status, 201)
  bookingId = create.body.booking.id
  sessionId = create.body.session.id
  const customerCookie = create.response.headers.get("set-cookie")?.split(";", 1)[0]
  assert.ok(customerCookie?.startsWith("brash3d_customer_access="))

  const hiddenSession = await jsonRequest(`/api/sessions?id=${encodeURIComponent(sessionId)}`)
  assert.equal(hiddenSession.response.status, 404)
  const cleanUrlSession = await jsonRequest(`/api/sessions?id=${encodeURIComponent(sessionId)}`, {
    headers: { cookie: customerCookie },
  })
  assert.equal(cleanUrlSession.response.status, 200)

  const duplicate = await jsonRequest("/api/bookings", {
    method: "POST",
    headers: { "content-type": "application/json", origin: baseUrl, "x-forwarded-for": smokeIp },
    body: JSON.stringify(bookingPayload),
  })
  assert.equal(duplicate.response.status, 409)

  // Stripe itself is outside this smoke test. Confirm the booking fixture as if
  // the signature-verified webhook had completed, then exercise the real lifecycle.
  await pool.query("UPDATE reservas SET estado='confirmada', confirmed_at=now(), payment_intent_id=$2 WHERE id::text=$1", [bookingId, `pi_smoke_${stamp}`])
  const start = await jsonRequest("/api/sessions", {
    method: "POST",
    headers: { "content-type": "application/json", origin: baseUrl, cookie: staffCookie },
    body: JSON.stringify({ action: "start", sessionId }),
  })
  assert.equal(start.response.status, 200)

  const product = await jsonRequest("/api/sessions", {
    method: "POST",
    headers: { "content-type": "application/json", origin: baseUrl, cookie: staffCookie },
    body: JSON.stringify({
      action: "addProduct",
      sessionId,
      nombre: "Smoke Test Product",
      sku: "SMOKE-001",
      precio: 100,
      cantidad: 2,
    }),
  })
  assert.equal(product.response.status, 200)
  assert.equal(product.body.session.total, 244)

  const close = await jsonRequest("/api/sessions", {
    method: "POST",
    headers: { "content-type": "application/json", origin: baseUrl, cookie: staffCookie },
    body: JSON.stringify({ action: "close", sessionId }),
  })
  assert.equal(close.response.status, 200)

  // Stripe is outside this smoke test. Seed the verified 65% outcome so the
  // documented shipping and consolidated-manifest lifecycle can be exercised.
  await pool.query(`
    UPDATE sesiones_compra SET monto_pagado_65=round(total*0.65,2),
      direccion_entrega='Carrera 7 # 72-41, Apt 4', ciudad_entrega='Bogota',
      direccion_confirmada_at=now(), payment_intent_65_id=$2
    WHERE id::text=$1
  `, [sessionId, `pi_65_smoke_${stamp}`])
  const shipment = await jsonRequest("/api/sessions", {
    method: "POST",
    headers: { "content-type": "application/json", origin: baseUrl, cookie: staffCookie },
    body: JSON.stringify({ action: "updateDeliveryStatus", sessionId, status: "preparacion" }),
  })
  assert.equal(shipment.response.status, 200)
  assert.ok(shipment.body.session.envio.labelCode.startsWith("BR3D-"))

  const createBox = await jsonRequest("/api/shipping", {
    method: "POST",
    headers: { "content-type": "application/json", origin: baseUrl, cookie: staffCookie },
    body: JSON.stringify({ shipmentIds: [shipment.body.session.envio.id], courier: "Smoke Courier", tracking: `SMOKE-${stamp}` }),
  })
  assert.equal(createBox.response.status, 200)
  boxId = createBox.body.box.id

  const sellerManifest = await jsonRequest("/api/shipping", { headers: { cookie: staffCookie } })
  const manifestBox = sellerManifest.body.boxes.find((box) => box.id === boxId)
  assert.equal(manifestBox.customerCount, 1)
  assert.equal(manifestBox.totalUnits, 2)
  assert.equal(manifestBox.packages[0].products[0].name, "Smoke Test Product")

  const colombiaManifest = await jsonRequest("/api/local-team", { headers: { cookie: localStaffCookie } })
  assert.ok(colombiaManifest.body.boxes.some((box) => box.id === boxId && box.packages.length === 1))

  const localCannotCreateBox = await jsonRequest("/api/shipping", {
    method: "POST",
    headers: { "content-type": "application/json", origin: baseUrl, cookie: localStaffCookie },
    body: JSON.stringify({ shipmentIds: [shipment.body.session.envio.id], courier: "Wrong owner", tracking: "DENIED" }),
  })
  assert.equal(localCannotCreateBox.response.status, 401)

  const receiveBox = await jsonRequest("/api/local-team", {
    method: "POST",
    headers: { "content-type": "application/json", origin: baseUrl, cookie: localStaffCookie },
    body: JSON.stringify({ action: "receiveBox", boxId }),
  })
  assert.equal(receiveBox.response.status, 200)
  const customerAfterReceipt = await jsonRequest(`/api/sessions?id=${encodeURIComponent(sessionId)}`, { headers: { cookie: customerCookie } })
  assert.equal(customerAfterReceipt.body.session.envio.estado, "recibido_equipo_local")

  const finalCash = await jsonRequest("/api/local-team", {
    method: "POST",
    headers: { "content-type": "application/json", origin: baseUrl, cookie: localStaffCookie },
    body: JSON.stringify({ action: "recordOfflinePayment", sessionId, method: "efectivo" }),
  })
  assert.equal(finalCash.response.status, 200)

  const simulatedPayment = await jsonRequest("/api/sessions", {
    method: "POST",
    headers: { "content-type": "application/json", origin: baseUrl },
    body: JSON.stringify({ action: "simulatePayment", sessionId, amount: "65" }),
  })
  assert.equal(simulatedPayment.response.status, 401)

  const persisted = await jsonRequest(`/api/sessions?id=${encodeURIComponent(sessionId)}`, {
    headers: { cookie: staffCookie },
  })
  assert.equal(persisted.body.session.montoPagado65, 158.6)
  assert.equal(persisted.body.session.montoPagado35, 85.4)
  assert.equal(persisted.body.session.envio.estado, "entregado")
  const customerCompleted = await jsonRequest(`/api/sessions?id=${encodeURIComponent(sessionId)}`, { headers: { cookie: customerCookie } })
  assert.equal(customerCompleted.body.session.montoPagado35, 85.4)
  assert.equal(customerCompleted.body.session.envio.estado, "entregado")
  const logout = await jsonRequest("/api/auth/logout", {
    method: "POST",
    headers: { origin: baseUrl, cookie: staffCookie },
  })
  assert.equal(logout.response.status, 200)
  const afterLogout = await jsonRequest("/api/sessions", { headers: { cookie: staffCookie } })
  assert.equal(afterLogout.response.status, 401)

  console.log("Smoke test passed: seller/customer/local-team sync, auth, booking, cart, payments, shipping, manifest, persistence")
} finally {
  const client = await pool.connect()
  try {
    await client.query("BEGIN")
    if (sessionId) {
      await client.query("DELETE FROM payment_logs WHERE sesion_id::text = $1", [sessionId])
      await client.query("DELETE FROM productos_carrito WHERE sesion_id::text = $1", [sessionId])
      await client.query("DELETE FROM envios WHERE sesion_id::text = $1", [sessionId])
      await client.query("DELETE FROM sesiones_compra WHERE id::text = $1", [sessionId])
    }
    if (boxId) await client.query("DELETE FROM cajas_consolidadas WHERE id::text = $1", [boxId])
    if (bookingId) await client.query("DELETE FROM reservas WHERE id::text = $1", [bookingId])
    await client.query("DELETE FROM clientes WHERE email = $1", [email])
    if (slotId) await client.query("UPDATE disponibilidad SET disponible = TRUE WHERE id::text = $1", [slotId])
    if (staffId) await client.query("DELETE FROM staff_users WHERE id::text = $1", [staffId])
    if (localStaffId) await client.query("DELETE FROM staff_users WHERE id::text = $1", [localStaffId])
    await client.query("DELETE FROM request_rate_limits WHERE key IN ($1, $2, $3)", [`login:${smokeIp}`, `booking:${smokeIp}`, "login:127.0.0.253"])
    await client.query("COMMIT")
  } catch (error) {
    await client.query("ROLLBACK")
    throw error
  } finally {
    client.release()
    await pool.end()
  }
}
