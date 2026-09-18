/**
 * How an appointment is written down, in one place.
 *
 * A live session is one instant seen from two countries: the seller is at the
 * outlet in Miami, the customer is at home in Colombia. Until this module
 * existed, three surfaces each answered that question differently — the booking
 * page printed the slot's raw Miami wall clock with no zone at all, the order
 * page called `toLocaleString` with no `timeZone` and so rendered in whatever
 * zone the reader's device happened to be in, and the WhatsApp confirmation
 * pinned itself to `America/New_York`.
 *
 * All three were the same instant, which is why it survived review. What the
 * customer saw was a booking made at 5:00 PM, a WhatsApp message saying 5:00 PM,
 * and an order page saying 4:00 PM. An hour is precisely the size of error that
 * makes somebody miss the call, and it is invisible for half the year: Colombia
 * sits at UTC-5 all year while Miami moves between UTC-4 and UTC-5, so anybody
 * checking this in December would have found the two in perfect agreement.
 *
 * So the zone is never the reader's device. It is the customer's country, which
 * is recorded on their row and does not change when they travel or when a phone
 * guesses wrong, and the outlet's own time is shown beside it because that is
 * where the seller will actually be standing.
 */

/**
 * Where the outlets are. Also the zone the booking insert converts a slot with
 * (`AT TIME ZONE 'America/New_York'` in `createBookingWithSession`), so a slot
 * is stored and displayed against the same clock.
 */
export const OUTLET_TIME_ZONE = "America/New_York"

/** What the outlet's clock is called in front of a customer. */
export const OUTLET_LABEL = "Miami"

export interface AppointmentParts {
  /** The full date and time in the customer's own country, zone named. */
  readonly local: string
  /** The same instant as the outlet's clock — time only; the date is above. */
  readonly outlet: string
}

/**
 * `timeZone` is the customer's country zone, from the country registry. Passing
 * the reader's device zone is the bug this module exists to prevent.
 */
export function appointmentParts(
  when: Date,
  locale: string,
  timeZone: string
): AppointmentParts {
  return {
    local: when.toLocaleString(locale, {
      weekday: "long",
      month: "long",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZone,
      timeZoneName: "short",
    }),
    outlet: when.toLocaleTimeString(locale, {
      hour: "numeric",
      minute: "2-digit",
      timeZone: OUTLET_TIME_ZONE,
    }),
  }
}

/**
 * The one-line form used on the order page and in the WhatsApp confirmation.
 *
 * The outlet time is dropped when both clocks agree — which they do for
 * Colombia every winter, once Miami leaves daylight saving. "4:00 PM · 4:00 PM
 * Miami" reads like a mistake and invites the reader to look for a difference
 * that is not there.
 */
export function formatAppointment(
  when: Date,
  locale: string,
  timeZone: string
): string {
  const parts = appointmentParts(when, locale, timeZone)
  const localTime = when.toLocaleTimeString(locale, {
    hour: "numeric",
    minute: "2-digit",
    timeZone,
  })
  return localTime === parts.outlet
    ? parts.local
    : `${parts.local} · ${parts.outlet} ${OUTLET_LABEL}`
}
