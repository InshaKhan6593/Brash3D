import type { SesionCompra } from "@/lib/types"

export type BookingFilter = "all" | "today" | "open" | "payment_pending" | "in_progress" | "completed"

/**
 * What each quick filter is called and what it actually selects.
 *
 * The labels were the enum keys with the underscores swapped for spaces, so
 * the row read "upcoming · today · payment pending · in progress · completed".
 * Two of them lied and the rest explained nothing:
 *
 * - "upcoming" never meant "in the future". It means unfinished, which is why
 *   an appointment from last week that nobody closed sat in it -- listed as
 *   upcoming, days after it happened. It is now called "Open".
 * - "today" and "Open" overlap by design: a booking later today is in both.
 *   Nothing said so, so the two counts disagreeing looked like a bug.
 *
 * The hint is shown under the row for whichever filter is active.
 */
export const BOOKING_FILTER_LABELS: Record<BookingFilter, { label: string; hint: string }> = {
  open: { label: "Open", hint: "Every appointment still to deal with — not yet closed and not cancelled, whatever day it falls on." },
  today: { label: "Today", hint: "Everything scheduled for today, including appointments already closed." },
  payment_pending: { label: "Awaiting booking fee", hint: "Booked but the 20 USD has not been confirmed. The slot is held for 15 minutes, then released." },
  in_progress: { label: "Live now", hint: "Sessions open on the seller's panel, whether or not the call has started." },
  completed: { label: "Closed", hint: "Sessions closed with an invoice. Payment and shipping continue from the Sessions tab." },
  all: { label: "All", hint: "Every appointment ever booked, including cancelled ones and those that ended without a purchase." },
}

/** The order the buttons appear in: the seller's own working order. */
export const BOOKING_FILTERS: readonly BookingFilter[] = [
  "open", "today", "in_progress", "payment_pending", "completed", "all",
]

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
 * - "open" (called "upcoming" when this was written) required the appointment
 *   to start in the future. A session running late, or opened a few minutes
 *   after its slot, dropped out of the default view and the Overview while it
 *   was still the seller's active job. It means unfinished — not cancelled,
 *   not closed — and it is now named for that.
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
    case "open":
      return session.estado !== "completada" && session.estado !== "cancelada"
        && session.bookingEstado !== "cancelada"
    case "payment_pending":
      return session.bookingEstado === "pendiente_pago"
    case "in_progress":
      return session.estado === "en_progreso"
    case "completed":
      return session.estado === "completada"
  }
}
