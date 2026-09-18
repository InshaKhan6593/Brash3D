export const DEFAULT_INITIAL_PERCENTAGE = 65

/**
 * The least a customer may pay before the goods are bought.
 *
 * The client stated it as a rule rather than a preference -- "but for sure they
 * have to pay 50%.....in advanced" (14 September 2026) -- across every pricing
 * model he described. It is the money that funds the purchase at the outlet, so
 * an order below it has Brash3D fronting stock against a promise.
 *
 * It constrains what a seller may choose, not what the system can price. Orders
 * closed before this rule existed keep their own percentage and settle exactly
 * as quoted; `clampPercentage` is deliberately left alone for that reason.
 */
export const MINIMUM_INITIAL_PERCENTAGE = 50

// The client sets the split per order: some customers pay 100% up front, others
// 85/15 or 65/35. The final share is derived by subtraction rather than rounded
// independently, so the two charges always add up to the invoice exactly.
export function initialAmount(total: number, initialPercentage: number): number {
  return round2(total * clampPercentage(initialPercentage) / 100)
}

export function finalAmount(total: number, initialPercentage: number): number {
  return round2(total - initialAmount(total, initialPercentage))
}

export function outstandingBalance(
  total: number,
  initialPercentage: number,
  paidFinal: number
): number {
  return Math.max(0, round2(finalAmount(total, initialPercentage) - paidFinal))
}

export function isPaidInFullUpFront(initialPercentage: number): boolean {
  return clampPercentage(initialPercentage) >= 100
}

export function clampPercentage(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return DEFAULT_INITIAL_PERCENTAGE
  return Math.min(100, value)
}

export function isValidPercentage(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value)
    && value >= MINIMUM_INITIAL_PERCENTAGE && value <= 100
}

/**
 * The commission Brash3D charges on the subtotal, as a percentage.
 *
 * The specification fixed this at 15% for the whole business (§3, `FEE_RATE`).
 * The client charges differently per deal -- 10% when the customer names a
 * budget, 15% on a normal split, 20-30% when Brash3D fronts the whole purchase
 * -- so the rate belongs to the order, not the environment.
 *
 * The bound is the database's, not a policy: `sesiones_rate_range_check` stores
 * the rate as a fraction and requires `>= 0 AND < 1`. Anything the seller can
 * type here has to survive that constraint, and nothing narrower is ours to
 * impose -- the client named four rates and did not describe a ceiling.
 */
export function isValidCommissionPercentage(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value < 100
}

function round2(value: number): number {
  // Shift-and-round avoids the float artefacts that make 1.005 round down.
  return Math.round((value + Number.EPSILON) * 100) / 100
}

export type PaymentStage = "inicial" | "final"
