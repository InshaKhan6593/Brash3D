import "server-only"

import { randomBytes } from "node:crypto"
import type { PoolClient, QueryResult, QueryResultRow } from "pg"
import { generateCustomerToken } from "@/lib/auth"
import { query, transaction } from "@/lib/db"
import { clampPercentage, DEFAULT_INITIAL_PERCENTAGE, finalAmount, initialAmount, type PaymentStage } from "@/lib/payment-split"
import { feeRate, referralRewardMonthlyCap, taxRate } from "@/lib/rates"
import type { Cliente, CustomerPurchaseHistory, EnvioEstado, PagoFinalMetodo, Producto, Reserva, SesionCompra, TimeSlot, Vendedor } from "@/lib/types"

export interface BookingCustomerInput extends Omit<Cliente, "id"> {
  referralCode?: string
  requiresLocalInvoice?: boolean
}

interface SessionRow extends QueryResultRow {
  id: string
  reserva_id: string
  vendedor_id: string
  vendedor_nombre: string
  vendedor_email: string
  tienda_asignada: string | null
  cliente_id: string
  cliente_nombre: string
  cliente_email: string
  cliente_telefono: string
  cliente_ciudad: string | null
  cliente_pais: string
  fecha_inicio: Date
  started_at: Date | null
  fecha_fin: Date | null
  fecha_hora_programada: Date
  booking_estado: Reserva["estado"]
  booking_fee: string
  requiere_factura_local: boolean
  fecha_programada: string | null
  hora_programada: string | null
  estado: SesionCompra["estado"]
  subtotal: string
  impuesto: string
  comision: string
  total: string
  tasa_impuesto: string
  tasa_comision: string
  porcentaje_inicial: string
  payment_intent_inicial_id: string | null
  payment_intent_final_id: string | null
  checkout_session_inicial_id: string | null
  checkout_session_final_id: string | null
  monto_pagado_inicial: string
  monto_pagado_final: string
  direccion_entrega_sesion: string | null
  ciudad_entrega_sesion: string | null
  direccion_confirmada_at: Date | null
  envio_id: string | null
  caja_id: string | null
  envio_estado: EnvioEstado | null
  etiqueta_codigo: string | null
  direccion_entrega: string | null
  ciudad_entrega: string | null
  tracking_number: string | null
  transportadora: string | null
  metodo_pago_recibido: PagoFinalMetodo | null
  fecha_envio: Date | null
  fecha_entrega_estimada: Date | null
  fecha_entrega_real: Date | null
  costo_envio: string | null
}

interface ProductRow extends QueryResultRow {
  id: string
  sesion_id: string
  nombre_producto: string
  sku: string | null
  precio_unitario: string
  cantidad: number
  notas_vendedor: string | null
  url_imagen: string | null
  added_at: Date
}

type QueryExecutor = <T extends QueryResultRow>(
  text: string,
  values?: unknown[]
) => Promise<QueryResult<T>>

function clientQuery(client: PoolClient): QueryExecutor {
  return <T extends QueryResultRow>(text: string, values: unknown[] = []) =>
    client.query<T>(text, values)
}

const SESSION_SELECT = `
  SELECT sc.id::text, sc.reserva_id::text, sc.vendedor_id::text,
    v.nombre AS vendedor_nombre, v.email AS vendedor_email, v.tienda_asignada,
    sc.cliente_id::text, c.nombre AS cliente_nombre, c.email AS cliente_email,
    c.telefono AS cliente_telefono, c.ciudad AS cliente_ciudad, c.pais AS cliente_pais,
    sc.fecha_inicio, sc.started_at, sc.fecha_fin, r.fecha_hora AS fecha_hora_programada,
    r.estado AS booking_estado, r.monto_reserva::text AS booking_fee,
    r.requiere_factura_local,
    r.fecha_hora::date::text AS fecha_programada,
    to_char(d.hora_inicio, 'HH24:MI') AS hora_programada, sc.estado,
    sc.subtotal::text, sc.impuesto::text, sc.comision::text, sc.total::text,
    sc.tasa_impuesto::text, sc.tasa_comision::text, sc.porcentaje_inicial::text,
    sc.payment_intent_inicial_id, sc.payment_intent_final_id,
    sc.checkout_session_inicial_id, sc.checkout_session_final_id,
    sc.monto_pagado_inicial::text, sc.monto_pagado_final::text,
    sc.direccion_entrega AS direccion_entrega_sesion,
    sc.ciudad_entrega AS ciudad_entrega_sesion, sc.direccion_confirmada_at,
    e.id::text AS envio_id, e.caja_id::text, e.estado AS envio_estado, e.etiqueta_codigo,
    e.direccion_entrega, e.ciudad_entrega, e.tracking_number,
    e.transportadora, e.metodo_pago_recibido, e.fecha_envio, e.fecha_entrega_estimada,
    e.fecha_entrega_real, e.costo_envio::text
  FROM sesiones_compra sc
  JOIN reservas r ON r.id = sc.reserva_id
  JOIN disponibilidad d ON d.id = r.disponibilidad_id
  JOIN clientes c ON c.id = sc.cliente_id
  JOIN vendedores v ON v.id = sc.vendedor_id
  LEFT JOIN envios e ON e.sesion_id = sc.id`

function displayTime(value: string): string {
  const hours = Number(value.split(":")[0])
  return `${hours === 0 ? 12 : hours > 12 ? hours - 12 : hours}:00 ${hours >= 12 ? "PM" : "AM"}`
}

function mapProduct(row: ProductRow): Producto {
  return {
    id: row.id,
    nombre: row.nombre_producto,
    sku: row.sku || undefined,
    precio: Number(row.precio_unitario),
    cantidad: row.cantidad,
    notas: row.notas_vendedor || undefined,
    urlImagen: row.url_imagen || undefined,
    addedAt: new Date(row.added_at),
  }
}

function mapSession(row: SessionRow, products: Producto[]): SesionCompra {
  const vendedor: Vendedor = {
    id: row.vendedor_id,
    nombre: row.vendedor_nombre,
    email: row.vendedor_email,
    tiendaAsignada: row.tienda_asignada || undefined,
  }
  const cliente: Cliente = {
    id: row.cliente_id,
    nombre: row.cliente_nombre,
    email: row.cliente_email,
    telefono: row.cliente_telefono,
    ciudad: row.cliente_ciudad || undefined,
    pais: row.cliente_pais,
  }

  return {
    id: row.id,
    reservaId: row.reserva_id,
    vendedorId: row.vendedor_id,
    vendedor,
    clienteId: row.cliente_id,
    cliente,
    fechaInicio: new Date(row.fecha_inicio),
    startedAt: row.started_at ? new Date(row.started_at) : undefined,
    fechaProgramada: row.fecha_programada ? new Date(`${row.fecha_programada}T12:00:00`) : undefined,
    fechaHoraProgramada: new Date(row.fecha_hora_programada),
    horaProgramada: row.hora_programada ? displayTime(row.hora_programada) : undefined,
    bookingEstado: row.booking_estado,
    bookingFee: Number(row.booking_fee),
    requiresLocalInvoice: row.requiere_factura_local,
    outlet: row.tienda_asignada || undefined,
    fechaFin: row.fecha_fin ? new Date(row.fecha_fin) : undefined,
    estado: row.estado,
    productos: products,
    subtotal: Number(row.subtotal),
    impuesto: Number(row.impuesto),
    comision: Number(row.comision),
    total: Number(row.total),
    tasaImpuesto: Number(row.tasa_impuesto),
    tasaComision: Number(row.tasa_comision),
    porcentajeInicial: Number(row.porcentaje_inicial),
    paymentIntentInicialId: row.payment_intent_inicial_id || undefined,
    paymentIntentFinalId: row.payment_intent_final_id || undefined,
    checkoutSessionInicialId: row.checkout_session_inicial_id || undefined,
    checkoutSessionFinalId: row.checkout_session_final_id || undefined,
    montoPagadoInicial: Number(row.monto_pagado_inicial),
    montoPagadoFinal: Number(row.monto_pagado_final),
    deliveryAddress: row.direccion_entrega_sesion || undefined,
    deliveryCity: row.ciudad_entrega_sesion || undefined,
    deliveryAddressConfirmedAt: row.direccion_confirmada_at ? new Date(row.direccion_confirmada_at) : undefined,
    envio: row.envio_id && row.envio_estado ? {
      id: row.envio_id,
      sesionId: row.id,
      cajaId: row.caja_id || undefined,
      labelCode: row.etiqueta_codigo || undefined,
      deliveryAddress: row.direccion_entrega || undefined,
      deliveryCity: row.ciudad_entrega || undefined,
      trackingNumber: row.tracking_number || undefined,
      transportadora: row.transportadora || undefined,
      metodoPagoRecibido: row.metodo_pago_recibido || undefined,
      fechaEnvio: row.fecha_envio ? new Date(row.fecha_envio) : undefined,
      fechaEntregaEstimada: row.fecha_entrega_estimada ? new Date(row.fecha_entrega_estimada) : undefined,
      fechaEntregaReal: row.fecha_entrega_real ? new Date(row.fecha_entrega_real) : undefined,
      estado: row.envio_estado,
      costoEnvio: Number(row.costo_envio || 0),
    } : undefined,
  }
}

function formatMoney(amount: number): string {
  return `$${amount.toFixed(2)}`
}

// 65 renders as "65%", 33.5 as "33.5%" — no trailing zeros on whole numbers.
function formatPercentage(value: number): string {
  return `${Number(value.toFixed(2))}%`
}

/**
 * The window availability is generated for: today through the end of the month
 * after next, matching what the hard-coded generator produced.
 */
const HORIZON = `(date_trunc('month', current_date) + interval '2 months - 1 day')::date`

/**
 * Every open hour each active seller should have, derived from the weekly
 * template and any date exception. One row per seller/date/hour.
 *
 * An exception wins over the template for its date: `abierto = false` closes it,
 * and `abierto = true` reopens it with its own hours, falling back to the
 * template's when those are null.
 */
const SCHEDULED_HOURS = `
  SELECT
    v.id AS vendedor_id,
    day::date AS fecha,
    hour
  FROM vendedores v
  CROSS JOIN generate_series(current_date, ${HORIZON}, interval '1 day') day
  JOIN horarios_plantilla t
    ON t.vendedor_id = v.id AND t.dia_semana = EXTRACT(DOW FROM day)
  LEFT JOIN excepciones_calendario e
    ON e.vendedor_id = v.id AND e.fecha = day::date
  CROSS JOIN LATERAL generate_series(
    EXTRACT(HOUR FROM COALESCE(e.hora_apertura, t.hora_apertura))::int,
    EXTRACT(HOUR FROM COALESCE(e.hora_cierre, t.hora_cierre))::int - 1
  ) hour
  WHERE v.activo = true
    AND COALESCE(e.abierto, t.abierto) = true
`

/**
 * Brings `disponibilidad` in line with the admin's schedule, in both directions.
 *
 * Inserting the missing hours is only half the job: when an admin closes Sunday
 * or adds a holiday, the slots generated under the previous schedule are already
 * in the table and would keep appearing on the booking page. The delete removes
 * those, but only where no reserva points at them — a slot someone has already
 * booked or is holding stays, because the customer's appointment is real
 * regardless of what the schedule was changed to afterwards. Those show up for
 * the admin as bookings on a day now marked closed, which is the honest state
 * and something to resolve with the customer rather than silently drop.
 */
/**
 * Removes slots the schedule no longer covers — a day the admin closed, or hours
 * trimmed off one. A slot a reserva points at is kept: that appointment belongs
 * to a customer and needs a human decision, not a silent deletion. The seller
 * panel lists those as stranded bookings.
 *
 * Deliberately not part of `ensureAvailability`. That runs on every read of the
 * slot list, and against a managed database each statement costs a full network
 * round trip — about 160 ms from here to the Tokyo region — so folding this in
 * made the public booking page measurably slower for something that can only
 * change when an admin edits the schedule. It runs there instead, and on the
 * maintenance timer as a backstop.
 */
export async function pruneUnscheduledSlots(): Promise<number> {
  const result = await query(`
    DELETE FROM disponibilidad d
    WHERE d.fecha >= current_date
      AND NOT EXISTS (SELECT 1 FROM reservas r WHERE r.disponibilidad_id = d.id)
      AND NOT EXISTS (
        SELECT 1 FROM (${SCHEDULED_HOURS}) s
        WHERE s.vendedor_id = d.vendedor_id
          AND s.fecha = d.fecha
          AND make_time(s.hour, 0, 0) = d.hora_inicio
      )
  `)
  return result.rowCount ?? 0
}

interface SlotRow extends QueryResultRow {
  id: string
  date: string
  start_time: string
  available: boolean
  seller_id: string
  seller_name: string
  outlet: string | null
}

/**
 * Generate any missing slots, free any expired holds, then read the list — in a
 * single round trip.
 *
 * This is the public booking page's hot path, and it used to issue three
 * separate statements. Server-side each takes under 4 ms, but every one costs a
 * full network round trip to the managed database (~160 ms to the Tokyo
 * region), so the page spent most of a second waiting on the network rather
 * than on work.
 *
 * Semicolon-separated statements go over the simple query protocol: PostgreSQL
 * runs them in order inside one implicit transaction, and — unlike branches of a
 * CTE — each one sees the previous one's effects. The SELECT therefore returns
 * the rows the INSERT just created. The price is that the simple protocol takes
 * no bind parameters, which is only workable here because none of the three
 * needs one; anything interpolated into this string would be an injection, so
 * keep it literal.
 */
export async function getTimeSlots(): Promise<TimeSlot[]> {
  const batch = await query<SlotRow>(`
    INSERT INTO disponibilidad (vendedor_id, fecha, hora_inicio, hora_fin, disponible)
    SELECT s.vendedor_id, s.fecha, make_time(s.hour, 0, 0), make_time(s.hour + 1, 0, 0), TRUE
    FROM (${SCHEDULED_HOURS}) s
    ON CONFLICT (vendedor_id, fecha, hora_inicio) DO NOTHING;

    WITH expired AS (
      UPDATE reservas
      SET estado = 'cancelada', cancellation_reason = 'hold_expired'
      WHERE estado = 'pendiente_pago' AND hold_expires_at <= now()
      RETURNING disponibilidad_id
    )
    UPDATE disponibilidad d
    SET disponible = true
    WHERE d.id IN (SELECT disponibilidad_id FROM expired)
      AND NOT EXISTS (
        SELECT 1 FROM reservas r
        WHERE r.disponibilidad_id = d.id
          AND (r.estado IN ('confirmada', 'completada')
            OR (r.estado = 'pendiente_pago' AND r.hold_expires_at > now()))
      );

    SELECT d.id::text, d.fecha::text AS date, to_char(d.hora_inicio, 'HH24:MI') AS start_time,
      d.disponible AS available, v.id::text AS seller_id, v.nombre AS seller_name,
      v.tienda_asignada AS outlet
    FROM disponibilidad d
    JOIN vendedores v ON v.id = d.vendedor_id AND v.activo = true
    WHERE d.fecha BETWEEN current_date
      AND (date_trunc('month', current_date) + interval '2 months - 1 day')::date
    ORDER BY d.fecha, d.hora_inicio, v.nombre
  `)

  // A multi-statement query resolves to one result per statement; the slots are
  // the last. `pg` types this as a single QueryResult, hence the cast.
  const results = batch as unknown as QueryResult<SlotRow>[]
  const result = Array.isArray(results) ? results[results.length - 1] : batch

  return result.rows.map((row) => ({
    id: row.id,
    date: row.date,
    time: displayTime(row.start_time),
    available: row.available,
    sellerId: row.seller_id,
    sellerName: row.seller_name,
    outlet: row.outlet || undefined,
  }))
}

export async function createBookingWithSession(
  customer: BookingCustomerInput,
  slotId: string
): Promise<{ booking: Reserva; session: SesionCompra; accessToken: string; rewardApplied: boolean }> {
  return transaction(async (client) => {
    const slotResult = await client.query<{
      id: string
      seller_id: string
      date: string
      start_time: string
      available: boolean
    }>(`
      SELECT id::text, vendedor_id::text AS seller_id, fecha::text AS date,
        to_char(hora_inicio, 'HH24:MI') AS start_time, disponible AS available
      FROM disponibilidad
      WHERE id::text = $1 AND fecha >= current_date
      FOR UPDATE
    `, [slotId])
    const slot = slotResult.rows[0]
    if (slot) await releaseExpiredBookingHolds(client, slotId)

    const activeReservation = slot && await client.query(`
      SELECT 1 FROM reservas
      WHERE disponibilidad_id = $1::uuid
        AND (estado IN ('confirmada', 'completada')
          OR (estado = 'pendiente_pago' AND hold_expires_at > now()))
      LIMIT 1
    `, [slotId])
    if (!slot || activeReservation?.rowCount) throw new Error("SLOT_NOT_AVAILABLE")

    const customerId = await upsertCustomer(client, customer)
    await client.query("UPDATE disponibilidad SET disponible = FALSE WHERE id::text = $1", [slotId])

    const bookingResult = await client.query<{
      id: string
      fecha_hora: Date
      estado: Reserva["estado"]
      monto_reserva: string
      hold_expires_at: Date
      created_at: Date
    }>(`
      INSERT INTO reservas (
        cliente_id, disponibilidad_id, fecha_hora, estado, monto_reserva, hold_expires_at,
        requiere_factura_local
      )
      VALUES (
        $1::uuid, $2::uuid,
        ($3::date + $4::time) AT TIME ZONE 'America/New_York',
        'pendiente_pago', 20.00, now() + ($5 * interval '1 minute'), $6
      )
      RETURNING id::text, fecha_hora, estado, monto_reserva::text, hold_expires_at, created_at
    `, [customerId, slotId, slot.date, slot.start_time, bookingHoldMinutes(),
      Boolean(customer.requiresLocalInvoice)])
    const bookingRow = bookingResult.rows[0]

    const sessionResult = await client.query<{ id: string }>(`
      INSERT INTO sesiones_compra (
        reserva_id, vendedor_id, cliente_id, tasa_impuesto, tasa_comision
      )
      VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5)
      RETURNING id::text
    `, [bookingRow.id, slot.seller_id, customerId, taxRate(), feeRate()])

    const rewardApplied = await applyPendingReferralReward(
      client,
      customerId,
      bookingRow.id,
      slot.seller_id,
      customer.nombre
    )

    const customerAccess = generateCustomerToken()
    await client.query(`
      INSERT INTO customer_session_access (session_id, token_hash, expires_at)
      VALUES ($1::uuid, $2, $3)
    `, [sessionResult.rows[0].id, customerAccess.hash, customerAccess.expiresAt])

    const cliente: Cliente = {
      id: customerId,
      nombre: customer.nombre,
      email: customer.email,
      telefono: customer.telefono,
      ciudad: customer.ciudad,
      pais: customer.pais,
    }
    const booking: Reserva = {
      id: bookingRow.id,
      clienteId: customerId,
      cliente,
      fecha: new Date(bookingRow.fecha_hora),
      hora: displayTime(slot.start_time),
      estado: rewardApplied ? "confirmada" : bookingRow.estado,
      montoReserva: rewardApplied ? 0 : Number(bookingRow.monto_reserva),
      holdExpiresAt: new Date(bookingRow.hold_expires_at),
      requiresLocalInvoice: Boolean(customer.requiresLocalInvoice),
      createdAt: new Date(bookingRow.created_at),
    }
    const session = await getSessionWithClient(clientQuery(client), sessionResult.rows[0].id)
    if (!session) throw new Error("SESSION_CREATE_FAILED")
    return { booking, session, accessToken: customerAccess.token, rewardApplied }
  })
}

async function applyPendingReferralReward(
  client: PoolClient,
  customerId: string,
  bookingId: string,
  sellerId: string,
  customerName: string
): Promise<boolean> {
  const rewardResult = await client.query<{ id: string }>(`
    SELECT id::text
    FROM referidos_recompensas
    WHERE referidor_id = $1::uuid
      AND estado = 'pendiente'
      AND fecha_expiracion > now()
    ORDER BY created_at
    LIMIT 1
    FOR UPDATE
  `, [customerId])
  const reward = rewardResult.rows[0]
  if (!reward) return false

  const claimed = await client.query(`
    UPDATE referidos_recompensas
    SET estado = 'aplicada', reserva_recompensa_usada_id = $2::uuid
    WHERE id = $1::uuid AND estado = 'pendiente'
  `, [reward.id, bookingId])
  if (!claimed.rowCount) return false

  await client.query(`
    UPDATE reservas
    SET estado = 'confirmada', confirmed_at = now(), monto_reserva = 0,
      recompensa_referido_id = $2::uuid
    WHERE id = $1::uuid
  `, [bookingId, reward.id])
  await client.query(`
    INSERT INTO staff_notifications (seller_id, type, title, message, reserva_id)
    VALUES ($1::uuid, 'booking_payment_confirmed', 'Referral reward applied', $2, $3::uuid)
    ON CONFLICT (type, reserva_id) WHERE reserva_id IS NOT NULL DO NOTHING
  `, [sellerId, `${customerName} used a referral reward for a complimentary booking.`, bookingId])
  return true
}

function bookingHoldMinutes(): number {
  const configured = Number(process.env.STRIPE_BOOKING_HOLD_MINUTES || "15")
  return Number.isInteger(configured) && configured >= 5 && configured <= 30 ? configured : 15
}

export async function releaseExpiredBookingHolds(
  client?: PoolClient,
  slotId?: string
): Promise<number> {
  const executor = client ? clientQuery(client) : query
  // One statement rather than two. The second update used to be issued only
  // after the first returned its rows, which cost an extra network round trip -
  // about 160 ms against a managed database - every time the slot list was read.
  // The freeing update reads the cancelled ids straight out of the CTE instead.
  //
  // The NOT EXISTS deliberately does not need to see the cancellation the CTE
  // just made: a hold that expired has hold_expires_at <= now(), so it already
  // fails the `> now()` test whether the snapshot shows it cancelled or not.
  const released = await executor<{ released: number }>(`
    WITH expired AS (
      UPDATE reservas
      SET estado = 'cancelada', cancellation_reason = 'hold_expired'
      WHERE estado = 'pendiente_pago'
        AND hold_expires_at <= now()
        AND ($1::text IS NULL OR disponibilidad_id::text = $1)
      RETURNING disponibilidad_id
    ), freed AS (
      UPDATE disponibilidad d
      SET disponible = true
      WHERE d.id IN (SELECT disponibilidad_id FROM expired)
        AND NOT EXISTS (
          SELECT 1 FROM reservas r
          WHERE r.disponibilidad_id = d.id
            AND (r.estado IN ('confirmada', 'completada')
              OR (r.estado = 'pendiente_pago' AND r.hold_expires_at > now()))
        )
      RETURNING d.id
    )
    SELECT (SELECT count(*) FROM expired)::int AS released
  `, [slotId || null])

  return released.rows[0]?.released ?? 0
}

export async function attachBookingCheckout(
  bookingId: string,
  checkoutSessionId: string,
  paymentIntentId?: string | null
): Promise<boolean> {
  const result = await query(`
    UPDATE reservas
    SET checkout_session_id = $2, payment_intent_id = COALESCE($3, payment_intent_id)
    WHERE id::text = $1 AND estado = 'pendiente_pago' AND hold_expires_at > now()
  `, [bookingId, checkoutSessionId, paymentIntentId || null])
  return Boolean(result.rowCount)
}

export async function cancelBookingHold(bookingId: string, reason: string): Promise<void> {
  await transaction(async (client) => {
    const result = await client.query<{ disponibilidad_id: string }>(`
      UPDATE reservas
      SET estado = 'cancelada', cancellation_reason = $2
      WHERE id::text = $1 AND estado = 'pendiente_pago'
      RETURNING disponibilidad_id::text
    `, [bookingId, reason.slice(0, 100)])
    if (result.rows[0]) {
      await client.query(`
        UPDATE disponibilidad d SET disponible = true
        WHERE d.id = $1::uuid
          AND NOT EXISTS (
            SELECT 1 FROM reservas r
            WHERE r.disponibilidad_id = d.id
              AND (r.estado IN ('confirmada', 'completada')
                OR (r.estado = 'pendiente_pago' AND r.hold_expires_at > now()))
          )
      `, [result.rows[0].disponibilidad_id])
    }
  })
}

export async function processBookingCheckoutEvent(input: {
  eventId: string
  eventType: string
  checkoutSessionId: string
  paymentIntentId?: string | null
  paid: boolean
  latePaymentRefunded?: boolean
}): Promise<"confirmed" | "released" | "late_payment" | "ignored" | "duplicate"> {
  return transaction(async (client) => {
    const duplicate = await client.query(
      "SELECT 1 FROM stripe_webhook_events WHERE event_id = $1",
      [input.eventId]
    )
    if (duplicate.rowCount) return "duplicate"

    const bookingResult = await client.query<{
      id: string
      estado: Reserva["estado"]
      hold_expires_at: Date | null
      disponibilidad_id: string
      monto_reserva: string
      sesion_id: string
    }>(`
      SELECT r.id::text, r.estado, r.hold_expires_at,
        r.disponibilidad_id::text, r.monto_reserva::text, sc.id::text AS sesion_id
      FROM reservas r
      JOIN sesiones_compra sc ON sc.reserva_id = r.id
      WHERE r.checkout_session_id = $1
      FOR UPDATE OF r
    `, [input.checkoutSessionId])
    const booking = bookingResult.rows[0]
    let outcome: "confirmed" | "released" | "late_payment" | "ignored" = "ignored"

    if (booking && input.eventType === "checkout.session.completed" && input.paid) {
      const holdValid = booking.estado === "pendiente_pago"
        && booking.hold_expires_at
        && booking.hold_expires_at.getTime() > Date.now()
      if (holdValid) {
        await client.query(`
          UPDATE reservas SET estado = 'confirmada', confirmed_at = now(),
            payment_intent_id = COALESCE($2, payment_intent_id)
          WHERE id = $1::uuid
        `, [booking.id, input.paymentIntentId || null])
        await client.query(`
          INSERT INTO payment_logs (
            payment_intent_id, reserva_id, monto, tipo_pago, estado, metadata
          ) VALUES ($1, $2::uuid, $3, 'booking_fee', 'succeeded', $4::jsonb)
          ON CONFLICT DO NOTHING
        `, [input.paymentIntentId || input.checkoutSessionId, booking.id, booking.monto_reserva,
          JSON.stringify({ checkoutSessionId: input.checkoutSessionId, eventId: input.eventId })])
        await client.query(`
          INSERT INTO staff_notifications (
            seller_id, type, title, message, reserva_id
          )
          SELECT sc.vendedor_id, 'booking_payment_confirmed',
            'Booking payment received',
            c.nombre || ' paid the $20 booking fee.', r.id
          FROM reservas r
          JOIN sesiones_compra sc ON sc.reserva_id = r.id
          JOIN clientes c ON c.id = r.cliente_id
          WHERE r.id = $1::uuid
          ON CONFLICT (type, reserva_id) WHERE reserva_id IS NOT NULL DO NOTHING
        `, [booking.id])
        outcome = "confirmed"
      } else if (booking.estado !== "confirmada" && booking.estado !== "completada") {
        outcome = "late_payment"
      }
    } else if (booking && input.eventType === "checkout.session.expired" && booking.estado === "pendiente_pago") {
      await client.query(`
        UPDATE reservas SET estado = 'cancelada', cancellation_reason = 'checkout_expired'
        WHERE id = $1::uuid
      `, [booking.id])
      await client.query("UPDATE disponibilidad SET disponible = true WHERE id = $1::uuid", [booking.disponibilidad_id])
      outcome = "released"
    }

    // The caller refunds a payment that arrived after the hold expired. Record
    // it so the refund is auditable and staff can answer the customer's call.
    if (outcome === "late_payment" && input.latePaymentRefunded && booking) {
      await client.query(`
        INSERT INTO payment_logs (
          payment_intent_id, reserva_id, monto, tipo_pago, estado, metadata
        ) VALUES ($1, $2::uuid, $3, 'booking_fee', 'refunded', $4::jsonb)
        ON CONFLICT DO NOTHING
      `, [input.paymentIntentId || input.checkoutSessionId, booking.id, booking.monto_reserva,
        JSON.stringify({ checkoutSessionId: input.checkoutSessionId, eventId: input.eventId, reason: "hold_expired" })])
      await client.query(`
        INSERT INTO staff_notifications (seller_id, type, title, message, reserva_id)
        SELECT sc.vendedor_id, 'booking_payment_refunded',
          'Booking payment refunded',
          c.nombre || '''s booking fee arrived after the slot hold expired and was refunded automatically.', r.id
        FROM reservas r
        JOIN sesiones_compra sc ON sc.reserva_id = r.id
        JOIN clientes c ON c.id = r.cliente_id
        WHERE r.id = $1::uuid
        ON CONFLICT (type, reserva_id) WHERE reserva_id IS NOT NULL DO NOTHING
      `, [booking.id])
    }

    if (outcome !== "late_payment" || input.latePaymentRefunded) {
      await client.query(`
        INSERT INTO stripe_webhook_events (event_id, event_type) VALUES ($1, $2)
      `, [input.eventId, input.eventType])
    }
    return outcome
  })
}

export async function rotateCustomerAccess(sessionId: string): Promise<string | null> {
  return transaction(async (client) => {
    const exists = await client.query(
      "SELECT 1 FROM sesiones_compra WHERE id::text = $1 FOR UPDATE",
      [sessionId]
    )
    if (!exists.rowCount) return null
    const access = generateCustomerToken()
    await client.query(`
      INSERT INTO customer_session_access (session_id, token_hash, expires_at)
      VALUES ($1::uuid, $2, $3)
    `, [sessionId, access.hash, access.expiresAt])
    return access.token
  })
}

function normalizeReferralCode(value: string | undefined): string | null {
  const code = value?.trim().toUpperCase() || ""
  if (!code) return null
  if (!/^[A-Z0-9-]{3,32}$/.test(code)) throw new Error("INVALID_REFERRAL_CODE")
  return code
}

async function resolveReferrerId(client: PoolClient, referralCode: string, customerId?: string): Promise<string> {
  const referrer = await client.query<{ id: string }>(`
    SELECT id::text FROM clientes
    WHERE upper(codigo_referido) = $1
    LIMIT 1
    FOR UPDATE
  `, [referralCode])
  if (!referrer.rows[0] || referrer.rows[0].id === customerId) {
    throw new Error("INVALID_REFERRAL_CODE")
  }
  return referrer.rows[0].id
}

async function upsertCustomer(client: PoolClient, customer: BookingCustomerInput): Promise<string> {
  const referralCode = normalizeReferralCode(customer.referralCode)
  const existing = await client.query<{ id: string; referido_por_id: string | null }>(`
    SELECT id::text, referido_por_id::text FROM clientes
    WHERE lower(email) = lower($1) OR telefono = $2
    ORDER BY CASE WHEN lower(email) = lower($1) THEN 0 ELSE 1 END
    LIMIT 1 FOR UPDATE
  `, [customer.email, customer.telefono])

  if (existing.rows[0]) {
    let referrerId: string | null = null
    if (referralCode && !existing.rows[0].referido_por_id) {
      const priorBooking = await client.query(
        "SELECT 1 FROM reservas WHERE cliente_id = $1::uuid LIMIT 1",
        [existing.rows[0].id]
      )
      if (priorBooking.rowCount) throw new Error("REFERRAL_CODE_ONLY_FIRST_BOOKING")
      referrerId = await resolveReferrerId(client, referralCode, existing.rows[0].id)
    }
    await client.query(`
      UPDATE clientes SET nombre = $2, email = $3, telefono = $4, ciudad = $5, pais = $6,
        referido_por_id = COALESCE(referido_por_id, $7::uuid)
      WHERE id = $1::uuid
    `, [existing.rows[0].id, customer.nombre, customer.email, customer.telefono, customer.ciudad || null, customer.pais, referrerId])
    return existing.rows[0].id
  }

  const referrerId = referralCode ? await resolveReferrerId(client, referralCode) : null
  const customerReferralCode = `BR3D-${randomBytes(5).toString("hex").toUpperCase()}`
  const inserted = await client.query<{ id: string }>(`
    INSERT INTO clientes (nombre, email, telefono, ciudad, pais, referido_por_id, codigo_referido)
    VALUES ($1, $2, $3, $4, $5, $6::uuid, $7) RETURNING id::text
  `, [customer.nombre, customer.email, customer.telefono, customer.ciudad || null, customer.pais, referrerId, customerReferralCode])
  return inserted.rows[0].id
}

export async function getBooking(id: string): Promise<Reserva | null> {
  const result = await query<{
    id: string
    cliente_id: string
    nombre: string
    email: string
    telefono: string
    ciudad: string | null
    pais: string
    fecha_hora: Date
    hora: string
    estado: Reserva["estado"]
    monto_reserva: string
    requiere_factura_local: boolean
    created_at: Date
  }>(`
    SELECT r.id::text, r.cliente_id::text, c.nombre, c.email, c.telefono, c.ciudad, c.pais,
      r.fecha_hora, to_char(d.hora_inicio, 'HH24:MI') AS hora, r.estado,
      r.monto_reserva::text, r.requiere_factura_local, r.created_at
    FROM reservas r
    JOIN clientes c ON c.id = r.cliente_id
    JOIN disponibilidad d ON d.id = r.disponibilidad_id
    WHERE r.id::text = $1
  `, [id])
  const row = result.rows[0]
  if (!row) return null
  const cliente: Cliente = {
    id: row.cliente_id,
    nombre: row.nombre,
    email: row.email,
    telefono: row.telefono,
    ciudad: row.ciudad || undefined,
    pais: row.pais,
  }
  return {
    id: row.id,
    clienteId: row.cliente_id,
    cliente,
    fecha: new Date(row.fecha_hora),
    hora: displayTime(row.hora),
    estado: row.estado,
    montoReserva: Number(row.monto_reserva),
    requiresLocalInvoice: row.requiere_factura_local,
    createdAt: new Date(row.created_at),
  }
}

async function loadProducts(
  execute: QueryExecutor,
  sessionIds: string[]
): Promise<Map<string, Producto[]>> {
  const grouped = new Map<string, Producto[]>()
  sessionIds.forEach((id) => grouped.set(id, []))
  if (sessionIds.length === 0) return grouped

  const result = await execute<ProductRow>(`
    SELECT id::text, sesion_id::text, nombre_producto, sku, precio_unitario::text,
      cantidad, notas_vendedor, url_imagen, added_at
    FROM productos_carrito
    WHERE sesion_id = ANY($1::uuid[])
    ORDER BY added_at
  `, [sessionIds])
  result.rows.forEach((row) => grouped.get(row.sesion_id)?.push(mapProduct(row)))
  return grouped
}

async function getSessionWithClient(
  execute: QueryExecutor,
  id: string
): Promise<SesionCompra | null> {
  const result = await execute<SessionRow>(`${SESSION_SELECT} WHERE sc.id::text = $1`, [id])
  const row = result.rows[0]
  if (!row) return null
  const products = await loadProducts(execute, [row.id])
  return mapSession(row, products.get(row.id) || [])
}

export async function listSessions(customerId?: string, sellerId?: string): Promise<SesionCompra[]> {
  const filters: string[] = []
  const values: string[] = []
  if (customerId) {
    values.push(customerId)
    filters.push(`sc.cliente_id = $${values.length}::uuid`)
  }
  if (sellerId) {
    values.push(sellerId)
    filters.push(`sc.vendedor_id = $${values.length}::uuid`)
  }
  const where = filters.length ? ` WHERE ${filters.join(" AND ")}` : ""
  const result = await query<SessionRow>(`${SESSION_SELECT}${where} ORDER BY sc.fecha_inicio DESC`, values)
  const products = await loadProducts(query, result.rows.map((row) => row.id))
  return result.rows.map((row) => mapSession(row, products.get(row.id) || []))
}

export async function getSession(id: string): Promise<SesionCompra | null> {
  return getSessionWithClient(query, id)
}

export async function getCustomerIdForSession(sessionId: string): Promise<string | null> {
  const result = await query<{ customer_id: string }>(`
    SELECT cliente_id::text AS customer_id
    FROM sesiones_compra
    WHERE id::text = $1
  `, [sessionId])
  return result.rows[0]?.customer_id || null
}

export async function getCustomerPurchaseHistory(
  customerId: string,
  sellerId?: string
): Promise<CustomerPurchaseHistory | null> {
  const customer = await query<{ id: string; nombre: string; codigo_referido: string }>(`
    SELECT id::text, nombre, codigo_referido
    FROM clientes
    WHERE id::text = $1
  `, [customerId])
  const row = customer.rows[0]
  if (!row) return null

  const sessions = await listSessions(customerId, sellerId)
  if (sellerId && sessions.length === 0) return null

  const rewardSummary = await query<{ count: string; credit: string }>(`
    SELECT count(*)::text AS count, COALESCE(sum(monto_recompensa), 0)::text AS credit
    FROM referidos_recompensas
    WHERE referidor_id = $1::uuid
      AND estado = 'pendiente'
      AND fecha_expiracion > now()
  `, [customerId])

  return {
    customer: { id: row.id, name: row.nombre, referralCode: row.codigo_referido },
    availableReferralRewards: Number(rewardSummary.rows[0]?.count || 0),
    availableReferralCredit: Number(rewardSummary.rows[0]?.credit || 0),
    purchases: sessions
      .filter((session) => session.estado === "completada")
      .map((session) => ({
        sessionId: session.id,
        bookedAt: session.fechaHoraProgramada || session.fechaInicio,
        outlet: session.outlet,
        status: session.estado,
        shipmentStatus: session.envio?.estado,
        paymentStatus: session.montoPagadoInicial + session.montoPagadoFinal >= session.total - 0.01
          ? "paid"
          : session.montoPagadoInicial > 0
            ? "partial"
            : "pending",
        trackingNumber: session.envio?.trackingNumber,
        total: session.total,
        products: session.productos,
      })),
  }
}

export async function startSession(sessionId: string): Promise<SesionCompra | null> {
  const result = await query(`
    UPDATE sesiones_compra sc
    SET started_at = COALESCE(sc.started_at, now()), fecha_inicio = COALESCE(sc.started_at, now())
    FROM reservas r
    WHERE sc.id::text = $1
      AND r.id = sc.reserva_id
      AND r.estado = 'confirmada'
      AND sc.estado = 'en_progreso'
      AND sc.started_at IS NULL
  `, [sessionId])
  if (!result.rowCount) return null
  return getSession(sessionId)
}

async function recalculateTotals(client: PoolClient, sessionId: string): Promise<void> {
  await client.query(`
    UPDATE sesiones_compra sc SET
      subtotal = totals.subtotal,
      impuesto = round(totals.subtotal * sc.tasa_impuesto, 2),
      comision = round(totals.subtotal * sc.tasa_comision, 2),
      total = totals.subtotal
        + round(totals.subtotal * sc.tasa_impuesto, 2)
        + round(totals.subtotal * sc.tasa_comision, 2)
    FROM (
      SELECT $1::uuid AS session_id,
        COALESCE(sum(precio_unitario * cantidad), 0)::numeric(10,2) AS subtotal
      FROM productos_carrito WHERE sesion_id = $1::uuid
    ) totals
    WHERE sc.id = totals.session_id
  `, [sessionId])
}

export async function addProductToSession(
  sessionId: string,
  product: Omit<Producto, "id" | "addedAt">
): Promise<SesionCompra | null> {
  return transaction(async (client) => {
    const active = await client.query(
      "SELECT id FROM sesiones_compra WHERE id::text = $1 AND estado = 'en_progreso' AND started_at IS NOT NULL FOR UPDATE",
      [sessionId]
    )
    if (!active.rowCount) return null
    await client.query(`
      INSERT INTO productos_carrito
        (sesion_id, nombre_producto, sku, precio_unitario, cantidad, precio_total, notas_vendedor, url_imagen)
      VALUES ($1::uuid, $2, $3, $4, $5, round(($4::numeric * $5::integer), 2), $6, $7)
    `, [sessionId, product.nombre, product.sku || null, product.precio, product.cantidad, product.notas || null, product.urlImagen || null])
    await recalculateTotals(client, sessionId)
    return getSessionWithClient(clientQuery(client), sessionId)
  })
}

export async function updateProductQuantity(
  sessionId: string,
  productId: string,
  delta: number
): Promise<SesionCompra | null> {
  return transaction(async (client) => {
    const result = await client.query(`
      UPDATE productos_carrito pc SET
        cantidad = greatest(1, pc.cantidad + $3::integer),
        precio_total = round(pc.precio_unitario * greatest(1, pc.cantidad + $3::integer), 2)
      FROM sesiones_compra sc
      WHERE pc.id::text = $2 AND pc.sesion_id::text = $1
        AND sc.id = pc.sesion_id AND sc.estado = 'en_progreso' AND sc.started_at IS NOT NULL
    `, [sessionId, productId, delta])
    if (!result.rowCount) return null
    await recalculateTotals(client, sessionId)
    return getSessionWithClient(clientQuery(client), sessionId)
  })
}

export async function removeProductFromSession(
  sessionId: string,
  productId: string
): Promise<SesionCompra | null> {
  return transaction(async (client) => {
    const result = await client.query(`
      DELETE FROM productos_carrito pc USING sesiones_compra sc
      WHERE pc.id::text = $2 AND pc.sesion_id::text = $1
        AND sc.id = pc.sesion_id AND sc.estado = 'en_progreso' AND sc.started_at IS NOT NULL
    `, [sessionId, productId])
    if (!result.rowCount) return null
    await recalculateTotals(client, sessionId)
    return getSessionWithClient(clientQuery(client), sessionId)
  })
}

// The share charged up front is chosen per order by the seller: some customers
// pay in full, others 85/15 or 65/35.
export async function closeSession(
  sessionId: string,
  initialPercentage: number = DEFAULT_INITIAL_PERCENTAGE
): Promise<SesionCompra | null> {
  const result = await query(`
    UPDATE sesiones_compra
    SET estado = 'completada', fecha_fin = COALESCE(fecha_fin, NOW()), porcentaje_inicial = $2
    WHERE id::text = $1 AND estado = 'en_progreso' AND started_at IS NOT NULL AND total > 0
  `, [sessionId, clampPercentage(initialPercentage)])
  if (!result.rowCount) return null
  return getSession(sessionId)
}

export async function reopenSessionForCorrection(sessionId: string, staffUserId: string): Promise<SesionCompra | null> {
  return transaction(async (client) => {
    const current = await client.query<{
      estado: SesionCompra["estado"]
      monto_pagado_inicial: string
      payment_intent_inicial_id: string | null
      envio_id: string | null
      checkout_session_inicial_id: string | null
    }>(`
      SELECT sc.estado, sc.monto_pagado_inicial::text, sc.payment_intent_inicial_id,
        e.id::text AS envio_id, sc.checkout_session_inicial_id
      FROM sesiones_compra sc
      LEFT JOIN envios e ON e.sesion_id = sc.id
      WHERE sc.id::text = $1
      FOR UPDATE OF sc
    `, [sessionId])
    const session = current.rows[0]
    if (!session || session.estado !== "completada" || Number(session.monto_pagado_inicial) > 0 || session.payment_intent_inicial_id || session.envio_id || session.checkout_session_inicial_id) return null

    await client.query(`
      UPDATE sesiones_compra
      SET estado = 'en_progreso', fecha_fin = NULL
      WHERE id::text = $1
    `, [sessionId])
    await client.query(`
      INSERT INTO session_audit_events (session_id, staff_user_id, event_type, metadata)
      VALUES ($1::uuid, $2::uuid, 'reopened_for_correction', $3::jsonb)
    `, [sessionId, staffUserId, JSON.stringify({ reason: "admin_correction" })])
    return getSessionWithClient(clientQuery(client), sessionId)
  })
}

const DELIVERY_SEQUENCE: EnvioEstado[] = [
  "preparacion",
  "en_transito",
  "en_aduanas",
  "recibido_equipo_local",
  "entregado",
]

export async function updateDeliveryStatus(
  sessionId: string,
  nextStatus: EnvioEstado
): Promise<SesionCompra | null> {
  if (!DELIVERY_SEQUENCE.includes(nextStatus)) return null
  return transaction(async (client) => {
    const sessionResult = await client.query<{ current_status: EnvioEstado | null; address: string | null; city: string | null; customer_name: string }>(`
      SELECT e.estado AS current_status, sc.direccion_entrega AS address,
        sc.ciudad_entrega AS city, c.nombre AS customer_name
      FROM sesiones_compra sc
      JOIN clientes c ON c.id=sc.cliente_id
      LEFT JOIN envios e ON e.sesion_id = sc.id
      WHERE sc.id::text = $1
        AND sc.estado = 'completada'
        AND sc.monto_pagado_inicial > 0
      FOR UPDATE OF sc
    `, [sessionId])
    if (!sessionResult.rows[0]) return null

    const current = sessionResult.rows[0].current_status
    const expectedIndex = current ? DELIVERY_SEQUENCE.indexOf(current) + 1 : 0
    if (DELIVERY_SEQUENCE[expectedIndex] !== nextStatus) return null

    if (!current) {
      const delivery = sessionResult.rows[0]
      if (!delivery.address || !delivery.city) return null
      const safeName = delivery.customer_name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-zA-Z0-9]/g, "").slice(0, 18).toUpperCase() || "CUSTOMER"
      const labelCode = `BR3D-${safeName}-${sessionId.replaceAll("-", "").slice(0, 8).toUpperCase()}`
      await client.query(`
        INSERT INTO envios (sesion_id, estado, costo_envio, etiqueta_codigo, direccion_entrega, ciudad_entrega)
        VALUES ($1::uuid, 'preparacion', 0, $2, $3, $4)
      `, [sessionId, labelCode, delivery.address, delivery.city])
    } else {
      await client.query(`
        UPDATE envios SET
          estado = $2::envio_estado,
          fecha_envio = CASE WHEN $2 = 'en_transito' THEN COALESCE(fecha_envio, now()) ELSE fecha_envio END,
          fecha_entrega_real = CASE WHEN $2 = 'entregado' THEN COALESCE(fecha_entrega_real, now()) ELSE fecha_entrega_real END
        WHERE sesion_id = $1::uuid
      `, [sessionId, nextStatus])
    }
    return getSessionWithClient(clientQuery(client), sessionId)
  })
}

export async function attachSessionCheckout(
  sessionId: string,
  stage: PaymentStage,
  checkoutSessionId: string
): Promise<boolean> {
  const column = stage === "inicial" ? "checkout_session_inicial_id" : "checkout_session_final_id"
  const eligibility = stage === "inicial"
    ? "estado = 'completada' AND total > 0 AND monto_pagado_inicial = 0"
    : "estado = 'completada' AND monto_pagado_inicial > 0 AND monto_pagado_final = 0 AND porcentaje_inicial < 100"
  const result = await query(`UPDATE sesiones_compra SET ${column} = $2 WHERE id::text = $1 AND ${eligibility}`, [sessionId, checkoutSessionId])
  return Boolean(result.rowCount)
}

export async function clearSessionCheckout(
  checkoutSessionId: string,
  stage: PaymentStage
): Promise<void> {
  const column = stage === "inicial" ? "checkout_session_inicial_id" : "checkout_session_final_id"
  await query(`UPDATE sesiones_compra SET ${column} = NULL WHERE ${column} = $1`, [checkoutSessionId])
}

export async function processSessionCheckoutEvent(input: {
  eventId: string
  checkoutSessionId: string
  paymentIntentId?: string | null
  stage: PaymentStage
  paid: boolean
}): Promise<"confirmed" | "ignored" | "duplicate"> {
  return transaction(async (client) => {
    const duplicate = await client.query("SELECT 1 FROM stripe_webhook_events WHERE event_id = $1", [input.eventId])
    if (duplicate.rowCount) return "duplicate"
    const column = input.stage === "inicial" ? "checkout_session_inicial_id" : "checkout_session_final_id"
    const result = await client.query<{
      id: string
      total: string
      porcentaje_inicial: string
      seller_id: string
      customer_id: string
      reserva_id: string
      customer_name: string
      referrer_id: string | null
    }>(`
      SELECT sc.id::text, sc.total::text, sc.porcentaje_inicial::text,
        sc.vendedor_id::text AS seller_id,
        sc.cliente_id::text AS customer_id, sc.reserva_id::text AS reserva_id,
        c.nombre AS customer_name, c.referido_por_id::text AS referrer_id
      FROM sesiones_compra sc JOIN clientes c ON c.id = sc.cliente_id
      WHERE sc.${column} = $1 FOR UPDATE OF sc
    `, [input.checkoutSessionId])
    const session = result.rows[0]
    let outcome: "confirmed" | "ignored" = "ignored"
    if (session && input.paid) {
      const percentage = Number(session.porcentaje_inicial)
      const amount = input.stage === "inicial"
        ? initialAmount(Number(session.total), percentage)
        : finalAmount(Number(session.total), percentage)
      const updated = await client.query(`
        UPDATE sesiones_compra SET
          ${input.stage === "inicial" ? "monto_pagado_inicial" : "monto_pagado_final"} = $3,
          ${input.stage === "inicial" ? "payment_intent_inicial_id" : "payment_intent_final_id"} = $2
        WHERE id = $1::uuid AND ${input.stage === "inicial" ? "monto_pagado_inicial" : "monto_pagado_final"} = 0
      `, [session.id, input.paymentIntentId || input.checkoutSessionId, amount.toFixed(2)])
      if (updated.rowCount) {
        if (input.stage === "final") {
          await client.query(`UPDATE envios SET estado='entregado', metodo_pago_recibido='stripe', asignacion_pago_final='ingreso_llc_usa', fecha_entrega_real=COALESCE(fecha_entrega_real,now()) WHERE sesion_id=$1::uuid`, [session.id])
        }
        if (input.stage === "inicial") {
          await grantReferralRewardForInitialPayment(client, session)
        }
        await client.query(`INSERT INTO payment_logs(payment_intent_id,sesion_id,monto,tipo_pago,estado,metadata) VALUES($1,$2::uuid,$3,$4,'succeeded',$5::jsonb)`, [input.paymentIntentId || input.checkoutSessionId, session.id, amount.toFixed(2), input.stage === "inicial" ? "session_inicial" : "session_final", JSON.stringify({ checkoutSessionId: input.checkoutSessionId, eventId: input.eventId })])
        // The split is per order, so the notification states the amount and the
        // order's own percentage rather than a hard-coded 65/35.
        const share = input.stage === "inicial"
          ? `${formatPercentage(percentage)} up-front`
          : `${formatPercentage(100 - percentage)} final`
        await client.query(
          `INSERT INTO staff_notifications(seller_id,type,title,message) VALUES($1::uuid,$2,$3,$4)`,
          [
            session.seller_id,
            input.stage === "inicial" ? "initial_payment_confirmed" : "final_payment_confirmed",
            input.stage === "inicial" ? "Initial payment received" : "Final payment received",
            `${session.customer_name} paid ${formatMoney(amount)} (${share}), confirmed by Stripe.`,
          ]
        )
        outcome = "confirmed"
      }
    }
    await client.query("INSERT INTO stripe_webhook_events(event_id,event_type) VALUES($1,'checkout.session.completed')", [input.eventId])
    return outcome
  })
}

async function grantReferralRewardForInitialPayment(
  client: PoolClient,
  session: {
    id: string
    customer_id: string
    reserva_id: string
    referrer_id: string | null
  }
): Promise<void> {
  if (!session.referrer_id) return

  const priorPaidSession = await client.query(`
    SELECT 1
    FROM sesiones_compra
    WHERE cliente_id = $1::uuid
      AND id <> $2::uuid
      AND monto_pagado_inicial > 0
    LIMIT 1
  `, [session.customer_id, session.id])
  if (priorPaidSession.rowCount) return

  // One referrer may only earn a limited number of complimentary bookings per
  // calendar month, otherwise the program is trivially farmed with fake accounts.
  const cap = referralRewardMonthlyCap()
  const grantedThisMonth = await client.query<{ count: string }>(`
    SELECT count(*)::text AS count
    FROM referidos_recompensas
    WHERE referidor_id = $1::uuid
      AND created_at >= date_trunc('month', now())
  `, [session.referrer_id])
  if (Number(grantedThisMonth.rows[0]?.count || 0) >= cap) return

  await client.query(`
    INSERT INTO referidos_recompensas (
      referidor_id, referido_id, reserva_aplicada_id, monto_recompensa, estado, fecha_expiracion
    )
    VALUES ($1::uuid, $2::uuid, $3::uuid, 20.00, 'pendiente', now() + interval '1 year')
    ON CONFLICT (referido_id) DO NOTHING
  `, [session.referrer_id, session.customer_id, session.reserva_id])
}
