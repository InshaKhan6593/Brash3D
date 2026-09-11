import "server-only"

import type { QueryResultRow } from "pg"
import { query, transaction } from "@/lib/db"
import type { ScheduleException, SellerSchedule, WeekdaySchedule } from "@/lib/types"

/**
 * Reads and writes the opening hours that drive slot generation
 * (`ensureAvailability` in sessionStore). The weekly template is the recurring
 * pattern; exceptions override one date each.
 */

interface TemplateRow extends QueryResultRow {
  vendedor_id: string
  dia_semana: number
  abierto: boolean
  hora_apertura: string
  hora_cierre: string
}

interface ExceptionRow extends QueryResultRow {
  id: string
  vendedor_id: string
  fecha: string
  abierto: boolean
  hora_apertura: string | null
  hora_cierre: string | null
  motivo: string | null
}

interface SellerRow extends QueryResultRow {
  id: string
  nombre: string
  tienda_asignada: string | null
}

/** "09:00:00" from Postgres becomes the "09:00" the inputs use. */
function toHourMinute(value: string | null): string | null {
  return value ? value.slice(0, 5) : null
}

/** Postgres DATE comes back as a Date in local time; keep the calendar day. */
function toIsoDate(value: string | Date): string {
  if (typeof value === "string") return value.slice(0, 10)
  const offset = value.getTimezoneOffset() * 60_000
  return new Date(value.getTime() - offset).toISOString().slice(0, 10)
}

/**
 * An hour string is valid only on the hour, because a slot is a whole hour and
 * the database enforces the same rule. Rejecting "09:30" here gives the admin a
 * readable message instead of a constraint violation.
 */
export function parseHour(value: unknown, field: string): string {
  if (typeof value !== "string" || !/^([01]\d|2[0-4]):00$/.test(value)) {
    throw new Error(`${field} must be a whole hour between 00:00 and 24:00, for example 09:00`)
  }
  return value
}

export function assertRange(open: string, close: string): void {
  if (close <= open) throw new Error("Closing time must be later than opening time")
}

export async function listSellersForSchedule(): Promise<{ id: string; nombre: string; tienda: string | null }[]> {
  const result = await query<SellerRow>(
    "SELECT id::text, nombre, tienda_asignada FROM vendedores WHERE activo = true ORDER BY nombre"
  )
  return result.rows.map((row) => ({ id: row.id, nombre: row.nombre, tienda: row.tienda_asignada }))
}

export async function getSellerSchedule(vendedorId: string): Promise<SellerSchedule> {
  const template = await query<TemplateRow>(`
    SELECT vendedor_id::text, dia_semana, abierto, hora_apertura::text, hora_cierre::text
    FROM horarios_plantilla WHERE vendedor_id = $1::uuid ORDER BY dia_semana
  `, [vendedorId])

  // Only dates from today forward matter; past exceptions are history the admin
  // cannot act on and would only clutter the list.
  const exceptions = await query<ExceptionRow>(`
    SELECT id::text, vendedor_id::text, fecha, abierto,
           hora_apertura::text, hora_cierre::text, motivo
    FROM excepciones_calendario
    WHERE vendedor_id = $1::uuid AND fecha >= current_date
    ORDER BY fecha
  `, [vendedorId])

  return {
    vendedorId,
    semana: template.rows.map<WeekdaySchedule>((row) => ({
      diaSemana: row.dia_semana,
      abierto: row.abierto,
      horaApertura: toHourMinute(row.hora_apertura) || "09:00",
      horaCierre: toHourMinute(row.hora_cierre) || "19:00",
    })),
    excepciones: exceptions.rows.map<ScheduleException>((row) => ({
      id: row.id,
      fecha: toIsoDate(row.fecha),
      abierto: row.abierto,
      horaApertura: toHourMinute(row.hora_apertura),
      horaCierre: toHourMinute(row.hora_cierre),
      motivo: row.motivo,
    })),
  }
}

/**
 * Replaces the whole week in one transaction. Saving day by day would let a
 * half-applied week reach slot generation if a later day failed validation.
 */
export async function saveWeeklyTemplate(vendedorId: string, days: WeekdaySchedule[]): Promise<void> {
  if (days.length !== 7) throw new Error("A weekly schedule needs all seven days")
  const seen = new Set(days.map((day) => day.diaSemana))
  if (seen.size !== 7) throw new Error("Each weekday may appear only once")

  for (const day of days) {
    if (!Number.isInteger(day.diaSemana) || day.diaSemana < 0 || day.diaSemana > 6) {
      throw new Error("Weekday must be 0 (Sunday) through 6 (Saturday)")
    }
    parseHour(day.horaApertura, "Opening time")
    parseHour(day.horaCierre, "Closing time")
    // A closed day keeps whatever hours it had, so reopening it restores them
    // instead of resetting to a default the admin never chose.
    if (day.abierto) assertRange(day.horaApertura, day.horaCierre)
  }

  await transaction(async (client) => {
    for (const day of days) {
      await client.query(`
        INSERT INTO horarios_plantilla (vendedor_id, dia_semana, abierto, hora_apertura, hora_cierre)
        VALUES ($1::uuid, $2, $3, $4::time, $5::time)
        ON CONFLICT (vendedor_id, dia_semana) DO UPDATE SET
          abierto = EXCLUDED.abierto,
          hora_apertura = EXCLUDED.hora_apertura,
          hora_cierre = EXCLUDED.hora_cierre,
          updated_at = now()
      `, [vendedorId, day.diaSemana, day.abierto, day.horaApertura, day.horaCierre])
    }
  })
}

export async function saveException(input: {
  vendedorId: string
  fecha: string
  abierto: boolean
  horaApertura: string | null
  horaCierre: string | null
  motivo: string | null
}): Promise<void> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.fecha)) throw new Error("Date must be in YYYY-MM-DD form")

  let open: string | null = null
  let close: string | null = null
  if (input.abierto && input.horaApertura && input.horaCierre) {
    open = parseHour(input.horaApertura, "Opening time")
    close = parseHour(input.horaCierre, "Closing time")
    assertRange(open, close)
  }

  await query(`
    INSERT INTO excepciones_calendario (vendedor_id, fecha, abierto, hora_apertura, hora_cierre, motivo)
    VALUES ($1::uuid, $2::date, $3, $4::time, $5::time, $6)
    ON CONFLICT (vendedor_id, fecha) DO UPDATE SET
      abierto = EXCLUDED.abierto,
      hora_apertura = EXCLUDED.hora_apertura,
      hora_cierre = EXCLUDED.hora_cierre,
      motivo = EXCLUDED.motivo
  `, [input.vendedorId, input.fecha, input.abierto, open, close, input.motivo?.trim() || null])
}

export async function deleteException(vendedorId: string, id: string): Promise<void> {
  await query(
    "DELETE FROM excepciones_calendario WHERE id = $1::uuid AND vendedor_id = $2::uuid",
    [id, vendedorId]
  )
}

/**
 * Bookings that survive a schedule change, so the admin can see what closing a
 * day left stranded. Slot generation deliberately keeps a booked slot alive; the
 * appointment is real and belongs to a customer, so it needs a human decision
 * rather than a silent deletion.
 */
export async function bookingsOutsideSchedule(vendedorId: string): Promise<
  { fecha: string; hora: string; cliente: string; estado: string }[]
> {
  const result = await query<{ fecha: string; hora: string; cliente: string; estado: string }>(`
    SELECT d.fecha, d.hora_inicio::text AS hora, c.nombre AS cliente, r.estado::text AS estado
    FROM reservas r
    JOIN disponibilidad d ON d.id = r.disponibilidad_id
    JOIN clientes c ON c.id = r.cliente_id
    LEFT JOIN horarios_plantilla t
      ON t.vendedor_id = d.vendedor_id AND t.dia_semana = EXTRACT(DOW FROM d.fecha)
    LEFT JOIN excepciones_calendario e
      ON e.vendedor_id = d.vendedor_id AND e.fecha = d.fecha
    WHERE d.vendedor_id = $1::uuid
      AND d.fecha >= current_date
      AND r.estado IN ('pendiente_pago', 'confirmada')
      AND (
        COALESCE(e.abierto, t.abierto, false) = false
        OR d.hora_inicio < COALESCE(e.hora_apertura, t.hora_apertura)
        OR d.hora_inicio >= COALESCE(e.hora_cierre, t.hora_cierre)
      )
    ORDER BY d.fecha, d.hora_inicio
  `, [vendedorId])

  return result.rows.map((row) => ({
    fecha: toIsoDate(row.fecha),
    hora: toHourMinute(row.hora) || row.hora,
    cliente: row.cliente,
    estado: row.estado,
  }))
}
