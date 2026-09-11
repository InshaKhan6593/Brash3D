import { describe, expect, it } from "vitest"
import { finalAmount, initialAmount, type PaymentStage } from "@/lib/payment-split"

/**
 * Guards the checkout amount against the bug that shipped in
 * `/api/payments/checkout`: the route computed
 * `Number(session.total) * Number(stage) / 100 * 100`, which worked while the
 * stage literal was "65" or "35" and became NaN the moment the configurable
 * split renamed the stages to "inicial" and "final". Stripe was being asked to
 * charge NaN cents.
 */
function checkoutCents(total: number, initialPercentage: number, stage: PaymentStage): number {
  const due = stage === "inicial"
    ? initialAmount(total, initialPercentage)
    : finalAmount(total, initialPercentage)
  return Math.round(due * 100)
}

/** The shape of the arithmetic the route used to do. */
function legacyCents(total: number, stage: string): number {
  return Math.round(total * Number(stage) / 100 * 100)
}

describe("checkout amount", () => {
  it("charges the up-front share at the order's own percentage", () => {
    expect(checkoutCents(198.86, 65, "inicial")).toBe(12926)
    expect(checkoutCents(198.86, 85, "inicial")).toBe(16903)
    expect(checkoutCents(198.86, 100, "inicial")).toBe(19886)
  })

  it("charges the remainder on delivery", () => {
    expect(checkoutCents(198.86, 65, "final")).toBe(6960)
    expect(checkoutCents(198.86, 100, "final")).toBe(0)
  })

  it("never drifts a cent: the two stages sum to the invoice", () => {
    for (const total of [198.86, 16177.2, 0.03, 1234.56, 99.99]) {
      for (const percentage of [65, 85, 100, 33.5, 1]) {
        const sum = checkoutCents(total, percentage, "inicial") + checkoutCents(total, percentage, "final")
        expect(sum).toBe(Math.round(total * 100))
      }
    }
  })

  it("produces a finite, positive amount for a real invoice", () => {
    const cents = checkoutCents(16177.2, 65, "inicial")
    expect(Number.isFinite(cents)).toBe(true)
    expect(cents).toBeGreaterThan(0)
  })

  // The regression itself: the old arithmetic is NaN for the current stage
  // names, which is exactly what reached Stripe.
  it("the old percentage-from-stage arithmetic is NaN for the current stage names", () => {
    expect(Number.isNaN(legacyCents(198.86, "inicial"))).toBe(true)
    expect(Number.isNaN(legacyCents(198.86, "final"))).toBe(true)
    // and worked only for the literals that no longer exist
    expect(legacyCents(198.86, "65")).toBe(12926)
  })
})
