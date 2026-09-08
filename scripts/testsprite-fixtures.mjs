import nextEnv from "@next/env"
import pg from "pg"
import { createHash } from "node:crypto"

nextEnv.loadEnvConfig(process.cwd())

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL })
const sellerId = "10000000-0000-4000-8000-000000000001"
const localTeamId = "20000000-0000-4000-8000-000000000001"

const customers = [
  ["30000000-0000-4000-8000-000000000001", "Fixture Active Shopper", "testsprite-active@local.test", "+573005550001", "Bogota", "Carrera 7 #72-41"],
  ["30000000-0000-4000-8000-000000000002", "Fixture Waiting Shopper", "testsprite-waiting@local.test", "+573005550002", "Medellin", "Carrera 43A #1-50"],
  ["30000000-0000-4000-8000-000000000003", "Fixture Completed Shopper", "testsprite-completed@local.test", "+573005550003", "Cali", "Calle 10 #4-20"],
  ["30000000-0000-4000-8000-000000000004", "Fixture Shipment One", "testsprite-shipment-one@local.test", "+573005550004", "Bogota", "Calle 93 #11-12"],
  ["30000000-0000-4000-8000-000000000005", "Fixture Shipment Two", "testsprite-shipment-two@local.test", "+573005550005", "Cartagena", "Carrera 2 #34-80"],
  ["30000000-0000-4000-8000-000000000006", "Fixture In Transit", "testsprite-transit@local.test", "+573005550006", "Barranquilla", "Calle 76 #54-10"],
  ["30000000-0000-4000-8000-000000000007", "Fixture Received", "testsprite-received@local.test", "+573005550007", "Bogota", "Calle 116 #15-30"],
  ["30000000-0000-4000-8000-000000000008", "Fixture Delivered", "testsprite-delivered@local.test", "+573005550008", "Pereira", "Carrera 8 #19-45"],
  ["30000000-0000-4000-8000-000000000009", "Fixture Unassigned Shipment", "testsprite-unassigned@local.test", "+573005550009", "Bogota", "Carrera 15 #88-20"],
]

const reservations = [
  "40000000-0000-4000-8000-000000000001",
  "40000000-0000-4000-8000-000000000002",
  "40000000-0000-4000-8000-000000000003",
  "40000000-0000-4000-8000-000000000004",
  "40000000-0000-4000-8000-000000000005",
  "40000000-0000-4000-8000-000000000006",
  "40000000-0000-4000-8000-000000000007",
  "40000000-0000-4000-8000-000000000008",
  "40000000-0000-4000-8000-000000000009",
  "40000000-0000-4000-8000-000000000010",
]

const sessions = [
  { id: "50000000-0000-4000-8000-000000000001", customer: 0, state: "en_progreso", subtotal: 100, started: true },
  { id: "50000000-0000-4000-8000-000000000002", customer: 1, state: "en_progreso", subtotal: 0, started: false },
  { id: "50000000-0000-4000-8000-000000000003", customer: 2, state: "completada", subtotal: 200, started: true },
  { id: "50000000-0000-4000-8000-000000000004", customer: 3, state: "completada", subtotal: 100, started: true, paid65: true },
  { id: "50000000-0000-4000-8000-000000000005", customer: 4, state: "completada", subtotal: 140, started: true, paid65: true },
  { id: "50000000-0000-4000-8000-000000000006", customer: 5, state: "completada", subtotal: 80, started: true, paid65: true },
  { id: "50000000-0000-4000-8000-000000000007", customer: 6, state: "completada", subtotal: 120, started: true, paid65: true },
  { id: "50000000-0000-4000-8000-000000000008", customer: 7, state: "completada", subtotal: 160, started: true, paid65: true },
  { id: "50000000-0000-4000-8000-000000000009", customer: 8, state: "completada", subtotal: 180, started: true, paid65: true, paid35: true },
  { id: "50000000-0000-4000-8000-000000000010", customer: 0, state: "completada", subtotal: 90, started: true, paid65: true, paid35: true },
]

const boxes = [
  { id: "60000000-0000-4000-8000-000000000001", number: "TS-PENDING-001", state: "pendiente", courier: "DHL", tracking: "TS-PENDING-001", age: 3 },
  { id: "60000000-0000-4000-8000-000000000002", number: "TS-TRANSIT-001", state: "enviada", courier: "FedEx", tracking: "TS-TRANSIT-001", age: 2 },
  { id: "60000000-0000-4000-8000-000000000003", number: "TS-RECEIVED-001", state: "recibida", courier: "UPS", tracking: "TS-RECEIVED-001", age: 1 },
  { id: "60000000-0000-4000-8000-000000000004", number: "TS-DELIVERED-001", state: "recibida", courier: "DHL", tracking: "TS-DELIVERED-001", age: 4 },
]

const shipments = [
  { id: "80000000-0000-4000-8000-000000000001", session: 3, box: 0, state: "preparacion", label: "TS-LABEL-001" },
  { id: "80000000-0000-4000-8000-000000000002", session: 4, box: null, state: "preparacion", label: "TS-LABEL-002" },
  { id: "80000000-0000-4000-8000-000000000003", session: 8, box: null, state: "preparacion", label: "TS-LABEL-003" },
  { id: "80000000-0000-4000-8000-000000000004", session: 5, box: 1, state: "en_transito", label: "TS-LABEL-004" },
  { id: "80000000-0000-4000-8000-000000000005", session: 6, box: 2, state: "recibido_equipo_local", label: "TS-LABEL-005" },
  { id: "80000000-0000-4000-8000-000000000006", session: 7, box: 3, state: "entregado", label: "TS-LABEL-006" },
]

const productSeeds = [
  ["70000000-0000-4000-8000-000000000001", 0, "Fixture Nike Dunk", "FD-001", 100, 1],
  ["70000000-0000-4000-8000-000000000002", 2, "Fixture Air Max", "FD-002", 200, 1],
  ["70000000-0000-4000-8000-000000000003", 3, "Fixture Jordan One", "FD-003", 100, 1],
  ["70000000-0000-4000-8000-000000000004", 4, "Fixture Pegasus", "FD-004", 140, 1],
  ["70000000-0000-4000-8000-000000000005", 5, "Fixture Cortez", "FD-005", 80, 1],
  ["70000000-0000-4000-8000-000000000006", 6, "Fixture Blazer", "FD-006", 120, 1],
  ["70000000-0000-4000-8000-000000000007", 7, "Fixture Vomero", "FD-007", 160, 1],
  ["70000000-0000-4000-8000-000000000008", 8, "Fixture Structure", "FD-008", 180, 1],
  ["70000000-0000-4000-8000-000000000009", 9, "Fixture Active Shopper History Item", "FD-009", 90, 1],
]

const shipmentIds = shipments.map((item) => item.id)
const sessionIds = sessions.map((item) => item.id)
const reservationIds = reservations
const customerIds = customers.map((item) => item[0])
const boxIds = boxes.map((item) => item.id)

function totalFor(subtotal) {
  const tax = Math.round(subtotal * 0.07 * 100) / 100
  const commission = Math.round(subtotal * 0.15 * 100) / 100
  return { tax, commission, total: subtotal + tax + commission }
}

function paid65(total) {
  return Math.round(total * 0.65 * 100) / 100
}

function paid35(total) {
  return Math.round(total * 0.35 * 100) / 100
}

function tokenHash(token) {
  return createHash("sha256").update(token).digest("hex")
}

async function seed() {
  const client = await pool.connect()
  try {
    await client.query("BEGIN")

    await client.query("DELETE FROM staff_notifications WHERE reserva_id = ANY($1::uuid[])", [reservationIds])
    await client.query("DELETE FROM payment_logs WHERE sesion_id = ANY($1::uuid[]) OR reserva_id = ANY($2::uuid[])", [sessionIds, reservationIds])
    await client.query("DELETE FROM customer_session_access WHERE session_id = ANY($1::uuid[])", [sessionIds])
    await client.query("DELETE FROM referidos_recompensas WHERE referidor_id = ANY($1::uuid[]) OR referido_id = ANY($1::uuid[])", [customerIds])
    await client.query("DELETE FROM productos_carrito WHERE sesion_id = ANY($1::uuid[])", [sessionIds])
    await client.query("DELETE FROM envios WHERE id = ANY($1::uuid[]) OR sesion_id = ANY($2::uuid[])", [shipmentIds, sessionIds])
    await client.query("DELETE FROM cajas_consolidadas WHERE id = ANY($1::uuid[])", [boxIds])
    await client.query("DELETE FROM sesiones_compra WHERE id = ANY($1::uuid[])", [sessionIds])
    await client.query("DELETE FROM reservas WHERE id = ANY($1::uuid[])", [reservationIds])
    await client.query("DELETE FROM clientes WHERE id = ANY($1::uuid[])", [customerIds])

    await client.query("DELETE FROM request_rate_limits")
    await client.query("UPDATE staff_users SET failed_attempts = 0, locked_until = NULL")

    await client.query(`
      INSERT INTO equipos_locales (id, nombre, ciudad, pais, responsable, email)
      VALUES ($1, 'Brash3D SAS Colombia', 'Bogota', 'Colombia', 'Local delivery team', 'colombia@brash3d.com')
      ON CONFLICT (id) DO UPDATE SET nombre = EXCLUDED.nombre, ciudad = EXCLUDED.ciudad, pais = EXCLUDED.pais
    `, [localTeamId])

    await client.query(`
      INSERT INTO vendedores (id, nombre, email, telefono, tienda_asignada, activo)
      VALUES ($1, 'Maria Garcia', 'maria@brash3d.com', '+1-555-0101', 'Nike Sawgrass', true)
      ON CONFLICT (id) DO UPDATE SET nombre = EXCLUDED.nombre, email = EXCLUDED.email, activo = true
    `, [sellerId])

    const slots = []
    for (let index = 0; index < sessions.length; index += 1) {
      const hour = 9 + index
      const result = await client.query(`
        INSERT INTO disponibilidad (vendedor_id, fecha, hora_inicio, hora_fin, disponible)
        VALUES ($1, current_date + 21, make_time($2, 0, 0), make_time($2 + 1, 0, 0), true)
        ON CONFLICT (vendedor_id, fecha, hora_inicio)
        DO UPDATE SET disponible = true
        RETURNING id::text, fecha::text, hora_inicio::text
      `, [sellerId, hour])
      slots.push(result.rows[0])
    }

    for (const [id, name, email, phone, city, address] of customers) {
      await client.query(`
        INSERT INTO clientes (id, nombre, email, telefono, pais, ciudad, direccion, codigo_referido)
        VALUES ($1, $2, $3, $4, 'Colombia', $5, $6, $7)
        ON CONFLICT (id) DO UPDATE SET nombre = EXCLUDED.nombre, email = EXCLUDED.email,
          telefono = EXCLUDED.telefono, ciudad = EXCLUDED.ciudad, direccion = EXCLUDED.direccion,
          codigo_referido = EXCLUDED.codigo_referido
      `, [id, name, email, phone, city, address, `BR3D-${id.slice(-6).toUpperCase()}`])
    }

    for (let index = 0; index < sessions.length; index += 1) {
      const reservationId = reservations[index]
      const customerId = customers[sessions[index].customer][0]
      const slot = slots[index]
      const scheduledAt = new Date(`${slot.fecha}T${slot.hora_inicio}Z`)
      await client.query(`
        INSERT INTO reservas (id, cliente_id, disponibilidad_id, fecha_hora, estado, payment_intent_id, monto_reserva, confirmed_at)
        VALUES ($1, $2, $3, $4, 'confirmada', $5, 20, now())
        ON CONFLICT (id) DO UPDATE SET cliente_id = EXCLUDED.cliente_id, disponibilidad_id = EXCLUDED.disponibilidad_id,
          fecha_hora = EXCLUDED.fecha_hora, estado = 'confirmada', payment_intent_id = EXCLUDED.payment_intent_id,
          monto_reserva = 20, confirmed_at = now(), hold_expires_at = NULL, cancellation_reason = NULL
      `, [reservationId, customerId, slot.id, scheduledAt, `pi_testsprite_booking_${index + 1}`])
    }
    await client.query("UPDATE disponibilidad SET disponible = false WHERE id = ANY($1::uuid[])", [slots.map((slot) => slot.id)])

    for (const [index, fixture] of sessions.entries()) {
      const { tax, commission, total } = totalFor(fixture.subtotal)
      const paidInitial = fixture.paid65 ? paid65(total) : 0
      const paidFinal = fixture.paid35 ? paid35(total) : 0
      const address = customers[fixture.customer][5]
      const city = customers[fixture.customer][4]
      await client.query(`
        INSERT INTO sesiones_compra (
          id, reserva_id, vendedor_id, cliente_id, fecha_inicio, fecha_fin, started_at, estado,
          subtotal, impuesto, comision, total, payment_intent_65_id, payment_intent_35_id,
          monto_pagado_65, monto_pagado_35, direccion_entrega, ciudad_entrega, direccion_confirmada_at
        ) VALUES ($1, $2, $3, $4, now() - ($5 || ' hours')::interval, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, now())
        ON CONFLICT (id) DO UPDATE SET reserva_id = EXCLUDED.reserva_id, vendedor_id = EXCLUDED.vendedor_id,
          cliente_id = EXCLUDED.cliente_id, fecha_inicio = EXCLUDED.fecha_inicio, fecha_fin = EXCLUDED.fecha_fin,
          started_at = EXCLUDED.started_at, estado = EXCLUDED.estado, subtotal = EXCLUDED.subtotal,
          impuesto = EXCLUDED.impuesto, comision = EXCLUDED.comision, total = EXCLUDED.total,
          payment_intent_65_id = EXCLUDED.payment_intent_65_id, payment_intent_35_id = EXCLUDED.payment_intent_35_id,
          monto_pagado_65 = EXCLUDED.monto_pagado_65, monto_pagado_35 = EXCLUDED.monto_pagado_35,
          direccion_entrega = EXCLUDED.direccion_entrega, ciudad_entrega = EXCLUDED.ciudad_entrega,
          direccion_confirmada_at = EXCLUDED.direccion_confirmada_at
      `, [
        fixture.id, reservations[index], sellerId, customers[fixture.customer][0], index + 1,
        fixture.state === "completada" ? new Date() : null,
        fixture.started ? new Date() : null,
        fixture.state, fixture.subtotal, tax, commission, total,
        fixture.paid65 ? `pi_testsprite_65_${index + 1}` : null,
        fixture.paid35 ? `pi_testsprite_35_${index + 1}` : null,
        paidInitial, paidFinal, address, city,
      ])
    }

    for (const [id, sessionIndex, name, sku, price, quantity] of productSeeds) {
      await client.query(`
        INSERT INTO productos_carrito (id, sesion_id, nombre_producto, sku, precio_unitario, cantidad, precio_total, notas_vendedor)
        VALUES ($1, $2, $3, $4, $5, $6, $5::numeric * $6::integer, 'TestSprite fixture product')
        ON CONFLICT (id) DO UPDATE SET sesion_id = EXCLUDED.sesion_id, nombre_producto = EXCLUDED.nombre_producto,
          sku = EXCLUDED.sku, precio_unitario = EXCLUDED.precio_unitario, cantidad = EXCLUDED.cantidad,
          precio_total = EXCLUDED.precio_total, notas_vendedor = EXCLUDED.notas_vendedor
      `, [id, sessions[sessionIndex].id, name, sku, price, quantity])
    }

    for (const box of boxes) {
      await client.query(`
        INSERT INTO cajas_consolidadas (id, sesiones_ids, equipo_local_id, numero_caja, pais, courier, numero_guia, fecha_empaquetado, estado, created_at, recibida_at)
        VALUES ($1, '{}', $2, $3, 'Colombia', $4, $5, CASE WHEN $6 = 'pendiente' THEN NULL ELSE now() - ($7 || ' hours')::interval END, $6::caja_estado, now() - ($7 || ' hours')::interval, CASE WHEN $6 = 'recibida' THEN now() - interval '30 minutes' ELSE NULL END)
        ON CONFLICT (id) DO UPDATE SET equipo_local_id = EXCLUDED.equipo_local_id, numero_caja = EXCLUDED.numero_caja,
          pais = EXCLUDED.pais, courier = EXCLUDED.courier, numero_guia = EXCLUDED.numero_guia,
          fecha_empaquetado = EXCLUDED.fecha_empaquetado, estado = EXCLUDED.estado,
          created_at = EXCLUDED.created_at, recibida_at = EXCLUDED.recibida_at
      `, [box.id, localTeamId, box.number, box.courier, box.tracking, box.state, box.age])
    }

    for (const shipment of shipments) {
      const fixture = sessions[shipment.session]
      const customer = customers[fixture.customer]
      const total = totalFor(fixture.subtotal).total
      await client.query(`
        INSERT INTO envios (id, caja_id, sesion_id, tracking_number, transportadora, fecha_envio, fecha_entrega_estimada, fecha_entrega_real, estado, costo_envio, etiqueta_codigo, direccion_entrega, ciudad_entrega, metodo_pago_recibido, asignacion_pago_final, monto_fondo_local)
        VALUES ($1, $2, $3, $4, $5, CASE WHEN $6 IN ('en_transito', 'recibido_equipo_local', 'entregado') THEN now() - interval '1 day' ELSE NULL END, now() + interval '5 days', CASE WHEN $6 = 'entregado' THEN now() - interval '2 hours' ELSE NULL END, $6::envio_estado, 12.50, $7, $8, $9, $10, $11, $12)
        ON CONFLICT (id) DO UPDATE SET caja_id = EXCLUDED.caja_id, sesion_id = EXCLUDED.sesion_id,
          tracking_number = EXCLUDED.tracking_number, transportadora = EXCLUDED.transportadora,
          fecha_envio = EXCLUDED.fecha_envio, fecha_entrega_estimada = EXCLUDED.fecha_entrega_estimada,
          fecha_entrega_real = EXCLUDED.fecha_entrega_real, estado = EXCLUDED.estado,
          etiqueta_codigo = EXCLUDED.etiqueta_codigo, direccion_entrega = EXCLUDED.direccion_entrega,
          ciudad_entrega = EXCLUDED.ciudad_entrega, metodo_pago_recibido = EXCLUDED.metodo_pago_recibido,
          asignacion_pago_final = EXCLUDED.asignacion_pago_final, monto_fondo_local = EXCLUDED.monto_fondo_local
      `, [
        shipment.id, shipment.box === null ? null : boxes[shipment.box].id, fixture.id,
        `TS-TRACK-${shipment.session + 1}`, shipment.box === null ? null : boxes[shipment.box].courier,
        shipment.state, shipment.label, customer[5], customer[4],
        shipment.state === "entregado" ? "efectivo" : null,
        shipment.state === "entregado" ? "fondo_local_colombia" : null,
        shipment.state === "entregado" ? paid35(total) : 0,
      ])
    }

    await client.query(`
      UPDATE cajas_consolidadas SET sesiones_ids = $2::uuid[]
      WHERE id = $1::uuid
    `, [boxes[0].id, [sessions[3].id]])
    await client.query(`UPDATE cajas_consolidadas SET sesiones_ids = $2::uuid[] WHERE id = $1::uuid`, [boxes[1].id, [sessions[5].id]])
    await client.query(`UPDATE cajas_consolidadas SET sesiones_ids = $2::uuid[] WHERE id = $1::uuid`, [boxes[2].id, [sessions[6].id]])
    await client.query(`UPDATE cajas_consolidadas SET sesiones_ids = $2::uuid[] WHERE id = $1::uuid`, [boxes[3].id, [sessions[7].id]])

    await client.query(`
      INSERT INTO referidos_recompensas (id, referidor_id, referido_id, monto_recompensa, estado, fecha_expiracion)
      VALUES ('a0000000-0000-4000-8000-000000000001', $1, $2, 20, 'pendiente', now() + interval '90 days')
      ON CONFLICT (id) DO UPDATE SET referidor_id = EXCLUDED.referidor_id, referido_id = EXCLUDED.referido_id,
        monto_recompensa = EXCLUDED.monto_recompensa, estado = EXCLUDED.estado, fecha_expiracion = EXCLUDED.fecha_expiracion
    `, [customerIds[0], customerIds[1]])

    await client.query(`
      INSERT INTO staff_notifications (id, seller_id, type, title, message, reserva_id)
      VALUES
        ('b0000000-0000-4000-8000-000000000001', $1, 'initial_payment_confirmed', 'Initial payment confirmed', 'Fixture initial payment is ready for shipping.', $2),
        ('b0000000-0000-4000-8000-000000000002', $1, 'final_payment_confirmed', 'Final payment received', 'Fixture delivery was paid offline.', $3)
      ON CONFLICT (id) DO UPDATE SET seller_id = EXCLUDED.seller_id, type = EXCLUDED.type,
        title = EXCLUDED.title, message = EXCLUDED.message, reserva_id = EXCLUDED.reserva_id, read_at = NULL
    `, [sellerId, reservations[3], reservations[8]])

    for (const fixture of sessions) {
      const token = `testsprite-${fixture.id}`
      await client.query(`
        INSERT INTO customer_session_access (session_id, token_hash, expires_at)
        VALUES ($1, $2, now() + interval '90 days')
        ON CONFLICT (token_hash) DO UPDATE SET session_id = EXCLUDED.session_id, expires_at = EXCLUDED.expires_at, revoked_at = NULL
      `, [fixture.id, tokenHash(token)])
    }

    await client.query("COMMIT")
    console.log(JSON.stringify({
      status: "seeded",
      staff: ["testsprite-admin@local.test", "maria@brash3d.com", "colombia@brash3d.com"],
      sessions: sessions.length,
      shipments: shipments.length,
      boxes: boxes.length,
      pendingBoxAppendFixture: boxes[0].number,
      unassignedShipmentFixture: shipments[1].label,
      dispatchedBoxFixture: boxes[1].number,
      receivedBoxFixture: boxes[2].number,
    }, null, 2))
  } catch (error) {
    await client.query("ROLLBACK")
    throw error
  } finally {
    client.release()
  }
}

try {
  await seed()
} finally {
  await pool.end()
}
