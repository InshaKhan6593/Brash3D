export const DEFAULT_INITIAL_PERCENTAGE = 65

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
  return typeof value === "number" && Number.isFinite(value) && value > 0 && value <= 100
}

function round2(value: number): number {
  // Shift-and-round avoids the float artefacts that make 1.005 round down.
  return Math.round((value + Number.EPSILON) * 100) / 100
}

export type PaymentStage = "inicial" | "final"
