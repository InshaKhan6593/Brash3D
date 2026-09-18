import { describe, expect, it } from "vitest"
import { settlementFor } from "@/lib/store/shippingStore"
import type { EnvioEstado, PagoFinalMetodo, SesionCompra } from "@/lib/types"

// Section 13 of the specification: Stripe collections become US LLC revenue,
// cash and transfers stay in Colombia as the local team's operating fund.
//
// `estado` mirrors production, where every path that records a final payment
// marks the shipment delivered in the same statement — so a recorded method
// implies a delivered package unless a case says otherwise.
function session(
  total: number,
  paidFinal: number,
  method?: PagoFinalMetodo,
  estado: EnvioEstado | undefined = method ? "entregado" : undefined
): SesionCompra {
  return {
    total,
    montoPagadoFinal: paidFinal,
    porcentajeInicial: 65,
    envio: method || estado ? { metodoPagoRecibido: method, estado } : undefined,
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
    const result = settlementFor([session(100, 35, undefined, "entregado")])
    expect(result.collected).toBe(35)
    expect(result.viaStripe).toBe(0)
    expect(result.localFund).toBe(0)
    expect(result.deliveredCount).toBe(1)
  })

  // The regression that made a box impossible to reconcile. An order paid 100%
  // up front is closed by `confirmDeliveryWithoutBalance`, which records no
  // amount and no method, so counting "collected > 0" as delivered left it in
  // the pending column permanently: a box of three holding one prepaid order
  // read "2 of 3" after all three had been handed over, with nothing left to do.
  it("counts a delivered prepaid order as delivered, collecting nothing", () => {
    const prepaid = { total: 200, montoPagadoFinal: 0, porcentajeInicial: 100, envio: { estado: "entregado" } } as SesionCompra
    const result = settlementFor([session(100, 35, "efectivo"), prepaid])
    expect(result.deliveredCount).toBe(2)
    expect(result.pendingCount).toBe(0)
    expect(result.collected).toBe(35)
    expect(result.pending).toBe(0)
  })

  it("counts a package still awaiting its balance as pending", () => {
    const awaiting = { total: 200, montoPagadoFinal: 0, porcentajeInicial: 65, envio: { estado: "recibido_equipo_local" } } as SesionCompra
    const result = settlementFor([awaiting])
    expect(result.deliveredCount).toBe(0)
    expect(result.pendingCount).toBe(1)
    expect(result.pending).toBeCloseTo(70, 2)
  })
})
