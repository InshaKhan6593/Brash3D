import { describe, expect, it } from "vitest"
import {
  clampPercentage,
  finalAmount,
  initialAmount,
  isPaidInFullUpFront,
  isValidPercentage,
  outstandingBalance,
} from "@/lib/payment-split"

describe("payment split", () => {
  it("keeps the default 65/35 behaviour", () => {
    expect(initialAmount(198.86, 65)).toBeCloseTo(129.26, 2)
    expect(finalAmount(198.86, 65)).toBeCloseTo(69.6, 2)
  })

  it("supports every split the client described", () => {
    for (const [percentage, expectedInitial] of [[100, 200], [85, 170], [65, 130], [50, 100]] as const) {
      expect(initialAmount(200, percentage)).toBeCloseTo(expectedInitial, 2)
      expect(finalAmount(200, percentage)).toBeCloseTo(200 - expectedInitial, 2)
    }
  })

  it("always sums exactly to the invoice total", () => {
    // Independent rounding of both shares can drift a cent; subtraction cannot.
    for (const total of [0.01, 0.03, 0.1, 33.33, 99.99, 198.86, 1234.57]) {
      for (const percentage of [1, 33, 50, 65, 85, 99, 100]) {
        const initial = initialAmount(total, percentage)
        const final = finalAmount(total, percentage)
        expect(initial + final).toBeCloseTo(total, 10)
        expect(Number((initial + final).toFixed(2))).toBe(Number(total.toFixed(2)))
      }
    }
  })

  it("leaves nothing to collect when the customer pays in full up front", () => {
    expect(finalAmount(500, 100)).toBe(0)
    expect(outstandingBalance(500, 100, 0)).toBe(0)
    expect(isPaidInFullUpFront(100)).toBe(true)
    expect(isPaidInFullUpFront(85)).toBe(false)
  })

  it("never reports a negative outstanding balance", () => {
    expect(outstandingBalance(200, 65, 999)).toBe(0)
    expect(outstandingBalance(200, 65, 70)).toBe(0)
    expect(outstandingBalance(200, 65, 0)).toBeCloseTo(70, 2)
  })

  it("falls back to the default for nonsense percentages", () => {
    expect(clampPercentage(0)).toBe(65)
    expect(clampPercentage(-5)).toBe(65)
    expect(clampPercentage(Number.NaN)).toBe(65)
    expect(clampPercentage(140)).toBe(100)
  })

  it("validates what a seller may submit", () => {
    expect(isValidPercentage(65)).toBe(true)
    expect(isValidPercentage(100)).toBe(true)
    expect(isValidPercentage(0)).toBe(false)
    expect(isValidPercentage(101)).toBe(false)
    expect(isValidPercentage("65")).toBe(false)
    expect(isValidPercentage(Number.NaN)).toBe(false)
  })
})
