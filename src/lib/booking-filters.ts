import type { SesionCompra } from "@/lib/types"

export type BookingFilter = "all" | "today" | "upcoming" | "payment_pending" | "in_progress" | "completed"

/** The appointment time a booking is listed under. */
export function scheduledAt(session: Pick<SesionCompra, "fechaHoraProgramada" | "fechaInicio">): Date {
  return new Date(session.fechaHoraProgramada || session.fechaInicio)
}

/** Local calendar day, matching how the panel groups "today". */
export function calendarDay(value: Date): string {
  return value.toLocaleDateString("en-CA")
}

/**
 * Whether a booking belongs in the named quick filter.
 *
 * Extracted from the seller panel so the rules are testable. Two of them were
 * wrong in a way that hid live work:
 *
 * - "upcoming" required the appointment to start in the future. A session
 *   running late, or opened a few minutes after its slot, dropped out of the
 *   default view and the Overview while it was still the seller's active job.
 *   It now means unfinished — not cancelled, not closed.
 * - "in progress" additionally required `startedAt`. A session already in
 *   `en_progreso` that nobody had pressed start on matched neither filter, and
 *   was reachable only through "today" or "all".
 */
export function matchesBookingFilter(
  session: Pick<SesionCompra, "estado" | "bookingEstado" | "fechaHoraProgramada" | "fechaInicio">,
  filter: BookingFilter,
  now: Date = new Date()
): boolean {
  switch (filter) {
    case "all":
      return true
    case "today":
      return calendarDay(scheduledAt(session)) === calendarDay(now)
    case "upcoming":
      return session.estado !== "completada" && session.bookingEstado !== "cancelada"
    case "payment_pending":
      return session.bookingEstado === "pendiente_pago"
    case "in_progress":
      return session.estado === "en_progreso"
    case "completed":
      return session.estado === "completada"
  }
}
