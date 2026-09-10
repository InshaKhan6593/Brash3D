import { describe, expect, it } from "vitest"
import { settlementFor } from "@/lib/store/shippingStore"
import type { PagoFinalMetodo, SesionCompra } from "@/lib/types"

// Section 13 of the specification: Stripe collections become US LLC revenue,
// cash and transfers stay in Colombia as the local team's operating fund.
function session(total: number, paidFinal: number, method?: PagoFinalMetodo): SesionCompra {
  return {
    total,
    montoPagadoFinal: paidFinal,
    envio: method ? { metodoPagoRecibido: method } : undefined,
  } as SesionCompra
}

describe("settlementFor", () => {
  it("reports an empty box as all zeroes", () => {
    const result = settlementFor([])
    expect(result).toEqual({
      collected: 0, viaStripe: 0, localFund: 0, cash: 0, transfer: 0,
      pending: 0, deliveredCount: 0, pendingCount: 0,
    })
  })

  it("splits Stripe from the Colombia local fund", () => {
    const result = settlementFor([
      session(100, 35, "stripe"),
      session(200, 70, "efectivo"),
      session(300, 105, "transferencia"),
    ])
    expect(result.viaStripe).toBe(35)
    expect(result.cash).toBe(70)
    expect(result.transfer).toBe(105)
    expect(result.localFund).toBe(175)
    expect(result.collected).toBe(210)
  })

  it("always reconciles: Stripe plus local fund equals total collected", () => {
    const result = settlementFor([
      session(198.86, 69.6, "stripe"),
      session(122.0, 42.7, "efectivo"),
      session(97.6, 34.16, "transferencia"),
      session(146.4, 0),
    ])
    expect(result.viaStripe + result.localFund).toBeCloseTo(result.collected, 2)
    expect(result.cash + result.transfer).toBeCloseTo(result.localFund, 2)
  })

  it("counts an uncollected delivery as pending, not collected", () => {
    const result = settlementFor([session(100, 35, "stripe"), session(200, 0)])
    expect(result.collected).toBe(35)
    expect(result.pending).toBeCloseTo(70, 2)
    expect(result.deliveredCount).toBe(1)
    expect(result.pendingCount).toBe(1)
  })

  it("never reports a negative balance when more was collected than expected", () => {
    const result = settlementFor([session(100, 40, "efectivo")])
    expect(result.pending).toBe(0)
    expect(result.localFund).toBe(40)
  })

  it("counts a collection with no recorded method toward neither side", () => {
    // Defensive: a row mid-write should not silently inflate either entity.
    const result = settlementFor([session(100, 35)])
    expect(result.collected).toBe(35)
    expect(result.viaStripe).toBe(0)
    expect(result.localFund).toBe(0)
    expect(result.deliveredCount).toBe(1)
  })
})
