import type { SesionCompra } from "@/lib/types"

/**
 * An order that bought no products but owes for extra call time.
 *
 * The customer extended the call and then bought nothing. The extra time is a
 * service like the booking fee, which is kept whether or not anything is
 * bought, so it is still charged: the session closes as an invoice for the
 * extension alone, paid in full up front. There is nothing to ship, so it
 * skips the delivery address, the shipment and the Colombia team entirely, and
 * it does not count as a purchase for referral rewards.
 */
export function isExtraTimeOnly(session: Pick<SesionCompra, "estado" | "subtotal" | "cargoExtension">): boolean {
  return session.estado === "completada" && session.subtotal <= 0 && session.cargoExtension > 0
}
