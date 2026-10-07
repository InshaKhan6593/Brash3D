import type { TimeSlot } from "@/lib/types"

/**
 * How booked time is sold. Shared by the booking page, the booking API and the
 * seller's extension, so the price a customer is shown is the price charged.
 *
 * The client's terms: an hour costs 20 USD and every further 30 minutes 10 USD.
 * Slots are half hours, one customer at a time.
 */

export const SLOT_MINUTES = 30

/** The first hour, which every booking includes. */
export const FIRST_HOUR_PRICE = 20

/** Each half hour after the first hour, booked or added during the call. */
export const EXTRA_HALF_HOUR_PRICE = 10

/** What a customer may choose when booking. Longer calls are extended live. */
export const BOOKING_DURATIONS = [60, 90, 120] as const

export type BookingDuration = (typeof BOOKING_DURATIONS)[number]

export const DEFAULT_BOOKING_DURATION: BookingDuration = 60

/** What the seller adds per press of "Extend", and what it adds to the bill. */
export const EXTENSION_MINUTES = SLOT_MINUTES
export const EXTENSION_PRICE = EXTRA_HALF_HOUR_PRICE

export function isBookingDuration(value: unknown): value is BookingDuration {
  return typeof value === "number" && (BOOKING_DURATIONS as readonly number[]).includes(value)
}

/** 60 → 20, 90 → 30, 120 → 40. */
export function bookingPrice(minutes: BookingDuration): number {
  return FIRST_HOUR_PRICE + ((minutes - 60) / SLOT_MINUTES) * EXTRA_HALF_HOUR_PRICE
}

/** How many consecutive half-hour slots a booking of this length occupies. */
export function slotsFor(minutes: number): number {
  return Math.ceil(minutes / SLOT_MINUTES)
}

/** "1 h", "1 h 30 min", "2 h" -- the same in Spanish and English. */
export function formatDuration(minutes: number): string {
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  if (!hours) return `${rest} min`
  return rest ? `${hours} h ${rest} min` : `${hours} h`
}

/**
 * The start times a booking of this length can take on one day: every half
 * hour from which enough consecutive free half hours follow before closing.
 * `daySlots` is one seller's day in time order. The server checks the same
 * thing under a lock; this only keeps the grid honest.
 */
export function bookableStarts(daySlots: TimeSlot[], minutes: number): Set<string> {
  const needed = slotsFor(minutes)
  const starts = new Set<string>()
  daySlots.forEach((slot, index) => {
    const first = new Date(slot.startsAt).getTime()
    for (let step = 0; step < needed; step += 1) {
      const next = daySlots[index + step]
      if (!next?.available || new Date(next.startsAt).getTime() !== first + step * SLOT_MINUTES * 60_000) return
    }
    starts.add(slot.id)
  })
  return starts
}
