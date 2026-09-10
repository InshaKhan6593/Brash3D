import { randomUUID } from "node:crypto"
import { query } from "@/lib/db"

export const SELLER_ID = "10000000-0000-4000-8000-000000000001"
export const LOCAL_TEAM_ID = "20000000-0000-4000-8000-000000000001"

// Every fixture row is registered here so a test can drop exactly what it made
// without touching development data that happens to share the database.
export interface Fixtures {
  customers: string[]
  bookings: string[]
  sessions: string[]
  slots: string[]
  boxes: string[]
  staff: string[]
  webhookEvents: string[]
}

export function newFixtures(): Fixtures {
  return { customers: [], bookings: [], sessions: [], slots: [], boxes: [], staff: [], webhookEvents: [] }
}

let slotOffset = 0

export async function createCustomer(
  fixtures: Fixtures,
  options: { referrerId?: string } = {}
): Promise<string> {
  const tag = randomUUID().slice(0, 12)
  const result = await query<{ id: string }>(`
    INSERT INTO clientes (nombre, email, telefono, ciudad, pais, codigo_referido, referido_por_id)
    VALUES ($1, $2, $3, 'Bogota', 'Colombia', $4, $5::uuid)
    RETURNING id::text
  `, [
    `Test ${tag}`,
    `vitest-${tag}@example.test`,
    `+57900${tag.replace(/\D/g, "0").slice(0, 7)}`,
    `VT-${tag.toUpperCase()}`,
    options.referrerId || null,
  ])
  fixtures.customers.push(result.rows[0].id)
  return result.rows[0].id
}

export interface SessionOptions {
  taxRate?: number
  feeRate?: number
  state?: "en_progreso" | "completada"
  total?: number
  paidInitial?: number
  requiresLocalInvoice?: boolean
  withAddress?: boolean
  initialPercentage?: number
}

export async function createSession(
  fixtures: Fixtures,
  customerId: string,
  options: SessionOptions = {}
): Promise<string> {
  // Each fixture takes its own far-future slot so it can never collide with
  // real availability or with another test.
  slotOffset += 1
  const slot = await query<{ id: string }>(`
    INSERT INTO disponibilidad (vendedor_id, fecha, hora_inicio, hora_fin, disponible)
    VALUES ($1::uuid, current_date + ($2 * interval '1 day'), '02:00'::time, '03:00'::time, false)
    RETURNING id::text
  `, [SELLER_ID, 500 + slotOffset])
  fixtures.slots.push(slot.rows[0].id)

  const booking = await query<{ id: string }>(`
    INSERT INTO reservas (
      cliente_id, disponibilidad_id, fecha_hora, estado, monto_reserva,
      confirmed_at, requiere_factura_local
    )
    VALUES ($1::uuid, $2::uuid, now(), 'confirmada', 20.00, now(), $3)
    RETURNING id::text
  `, [customerId, slot.rows[0].id, Boolean(options.requiresLocalInvoice)])
  fixtures.bookings.push(booking.rows[0].id)

  const session = await query<{ id: string }>(`
    INSERT INTO sesiones_compra (
      reserva_id, vendedor_id, cliente_id, estado, started_at,
      tasa_impuesto, tasa_comision, total, monto_pagado_inicial,
      direccion_entrega, ciudad_entrega, direccion_confirmada_at, porcentaje_inicial
    )
    VALUES ($1::uuid, $2::uuid, $3::uuid, $4, now(), $5, $6, $7, $8, $9, $10, $11, $12)
    RETURNING id::text
  `, [
    booking.rows[0].id, SELLER_ID, customerId,
    options.state || "en_progreso",
    options.taxRate ?? 0.07,
    options.feeRate ?? 0.15,
    options.total ?? 0,
    options.paidInitial ?? 0,
    options.withAddress === false ? null : "Calle 100 #10-20",
    options.withAddress === false ? null : "Bogota",
    options.withAddress === false ? null : new Date(),
    options.initialPercentage ?? 65,
  ])
  fixtures.sessions.push(session.rows[0].id)
  return session.rows[0].id
}

export async function createShipment(
  sessionId: string,
  estado: string,
  boxId?: string
): Promise<string> {
  const result = await query<{ id: string }>(`
    INSERT INTO envios (sesion_id, caja_id, estado, costo_envio, etiqueta_codigo,
      direccion_entrega, ciudad_entrega)
    VALUES ($1::uuid, $2::uuid, $3::envio_estado, 0, $4, 'Calle 100 #10-20', 'Bogota')
    RETURNING id::text
  `, [sessionId, boxId || null, estado, `BR3D-TEST-${randomUUID().slice(0, 8).toUpperCase()}`])
  return result.rows[0].id
}

export async function createBox(fixtures: Fixtures, estado = "recibida"): Promise<string> {
  const result = await query<{ id: string }>(`
    INSERT INTO cajas_consolidadas (
      equipo_local_id, numero_caja, pais, courier, numero_guia, estado, recibida_at
    )
    VALUES ($1::uuid, $2, 'Colombia', 'Servientrega', $3, $4::caja_estado,
      CASE WHEN $4 = 'recibida' THEN now() ELSE NULL END)
    RETURNING id::text
  `, [LOCAL_TEAM_ID, `VT-${randomUUID().slice(0, 8).toUpperCase()}`, `G-${randomUUID().slice(0, 8)}`, estado])
  fixtures.boxes.push(result.rows[0].id)
  return result.rows[0].id
}

export async function cleanup(fixtures: Fixtures): Promise<void> {
  const { sessions, bookings, customers, slots, boxes, staff, webhookEvents } = fixtures
  await query("DELETE FROM stripe_webhook_events WHERE event_id = ANY($1::text[])", [webhookEvents])
  await query("DELETE FROM payment_logs WHERE sesion_id = ANY($1::uuid[])", [sessions])
  await query("DELETE FROM envios WHERE sesion_id = ANY($1::uuid[])", [sessions])
  await query("DELETE FROM envios WHERE caja_id = ANY($1::uuid[])", [boxes])
  await query("DELETE FROM cajas_consolidadas WHERE id = ANY($1::uuid[])", [boxes])
  await query("DELETE FROM productos_carrito WHERE sesion_id = ANY($1::uuid[])", [sessions])
  await query("DELETE FROM customer_session_access WHERE session_id = ANY($1::uuid[])", [sessions])
  await query("DELETE FROM session_audit_events WHERE session_id = ANY($1::uuid[])", [sessions])
  await query(
    "DELETE FROM referidos_recompensas WHERE referidor_id = ANY($1::uuid[]) OR referido_id = ANY($1::uuid[])",
    [customers]
  )
  await query("UPDATE reservas SET recompensa_referido_id = NULL WHERE id = ANY($1::uuid[])", [bookings])
  await query("DELETE FROM sesiones_compra WHERE id = ANY($1::uuid[])", [sessions])
  await query("DELETE FROM staff_notifications WHERE reserva_id = ANY($1::uuid[])", [bookings])
  await query("DELETE FROM reservas WHERE id = ANY($1::uuid[])", [bookings])
  await query("DELETE FROM disponibilidad WHERE id = ANY($1::uuid[])", [slots])
  await query("DELETE FROM clientes WHERE id = ANY($1::uuid[])", [customers])
  await query("DELETE FROM staff_users WHERE id = ANY($1::uuid[])", [staff])
}
