/**
 * Stable codes for the checkout failures a customer can actually see.
 *
 * `POST /api/payments/checkout` answers with a Spanish sentence in `error`.
 * That was fine while the customer screens were Spanish only; now that they
 * follow the reader's chosen language, a Spanish sentence rendered inside an
 * English page is a gap the toggle cannot close -- the string is composed on
 * the server, which has no idea which language the reader picked.
 *
 * The route therefore sends a `code` alongside the existing `error`, and the
 * page translates the code. The sentence is left byte-identical on purpose:
 * `scripts/session-contract-smoke-test.mjs` pins one of them, non-browser
 * callers have nothing to translate with, and it stays the fallback for any
 * code a client does not recognise.
 */
export const CHECKOUT_ERROR = {
  /** The delivery address or city failed validation. */
  INVALID_ADDRESS: "CHECKOUT_INVALID_ADDRESS",
  /** The seller has not closed the session, so there is no invoice yet. */
  INVOICE_NOT_READY: "CHECKOUT_INVOICE_NOT_READY",
  /** The local team has not recorded receipt of the shipment. */
  SHIPMENT_NOT_RECEIVED: "CHECKOUT_SHIPMENT_NOT_RECEIVED",
  /** This stage is already paid. */
  ALREADY_PAID: "CHECKOUT_ALREADY_PAID",
  /** A webhook is still confirming an completed checkout. */
  CONFIRMING: "CHECKOUT_CONFIRMING",
  /** The address is frozen once the up-front payment lands. */
  ADDRESS_LOCKED: "CHECKOUT_ADDRESS_LOCKED",
  /** Stripe is not configured or unreachable. */
  UNAVAILABLE: "CHECKOUT_UNAVAILABLE",
  /** The order was paid 100% up front, so there is no balance. */
  SETTLED_IN_FULL: "CHECKOUT_SETTLED_IN_FULL",
  /** An arithmetic fault: a non-positive charge that is not a prepaid order. */
  AMOUNT_UNAVAILABLE: "CHECKOUT_AMOUNT_UNAVAILABLE",
} as const

export type CheckoutErrorCode = (typeof CHECKOUT_ERROR)[keyof typeof CHECKOUT_ERROR]
