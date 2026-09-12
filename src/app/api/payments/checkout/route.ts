import { NextResponse } from "next/server"
import { invalidBody, readJsonBody, withErrorHandling } from "@/lib/api"
import { logger } from "@/lib/logger"
import { requestHasSameOrigin, requireStaff, verifyCustomerAccess } from "@/lib/auth"
import { query } from "@/lib/db"
import { attachSessionCheckout, clearSessionCheckout, confirmDeliveryAddress } from "@/lib/store/sessionStore"
import { finalAmount, initialAmount, isPaidInFullUpFront } from "@/lib/payment-split"
import { getStripe } from "@/lib/stripe"
import { DEFAULT_COUNTRY } from "@/lib/countries"
import { customerSessionUrl } from "@/lib/customer-link"
import { CHECKOUT_ERROR } from "@/lib/checkout-errors"

export const runtime = "nodejs"

async function POSTHandler(request: Request) {
  if (!requestHasSameOrigin(request)) return NextResponse.json({ error: "Invalid request origin" }, { status: 403 })
  const body = await readJsonBody(request)
  if (!body) return invalidBody()
  const sessionId = typeof body.sessionId === "string" ? body.sessionId : ""
  const stage = body.stage === "final" ? "final" : body.stage === "inicial" ? "inicial" : null
  const address = typeof body.address === "string" ? body.address.trim() : ""
  const city = typeof body.city === "string" ? body.city.trim() : ""
  // The customer's own access token, when the page was opened from a durable
  // link rather than in the browser that holds the cookie. `verifyCustomerAccess`
  // falls back to the cookie when this is null, so the cookie-only path -- the
  // browser that made the booking -- still works unchanged.
  const accessToken = typeof body.accessToken === "string" ? body.accessToken : null
  if (!sessionId || !stage) return NextResponse.json({ error: "Invalid payment request" }, { status: 400 })

  if (stage === "inicial") {
    if (!await verifyCustomerAccess(sessionId, accessToken)) return NextResponse.json({ error: "Session not found" }, { status: 404 })
    if (address.length < 8 || address.length > 500 || city.length < 2 || city.length > 100) {
      return NextResponse.json({ error: `Escribe una direccion de entrega completa y tu ciudad en ${DEFAULT_COUNTRY.name}.`, code: CHECKOUT_ERROR.INVALID_ADDRESS }, { status: 400 })
    }
  } else {
    const staff = await requireStaff(["admin", "local_team"])
    if (!staff) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const result = await query<{
    total: string; porcentaje_inicial: string; email: string; paid: string; existing_checkout: string | null; shipment_status: string | null
  }>(`
    SELECT sc.total::text, sc.porcentaje_inicial::text, c.email,
      -- The stage is 'inicial' or 'final'. It was '65'/'35' until the split
      -- became configurable, and these three comparisons kept the old literals:
      -- every one was false, so an up-front payment read the final payment's
      -- columns and the WHERE clause demanded a shipment the local team had
      -- already received. The row never matched and no customer could pay.
      CASE WHEN $2 = 'inicial' THEN sc.monto_pagado_inicial::text ELSE sc.monto_pagado_final::text END AS paid,
      CASE WHEN $2 = 'inicial' THEN sc.checkout_session_inicial_id ELSE sc.checkout_session_final_id END AS existing_checkout,
      e.estado::text AS shipment_status
    FROM sesiones_compra sc JOIN clientes c ON c.id=sc.cliente_id
    LEFT JOIN envios e ON e.sesion_id=sc.id
    WHERE sc.id::text=$1 AND sc.estado='completada' AND sc.total > 0
      AND ($2 = 'inicial' OR (sc.monto_pagado_inicial > 0 AND e.estado='recibido_equipo_local'))
  `, [sessionId, stage])
  const session = result.rows[0]
  if (!session) return NextResponse.json({
    error: stage === "inicial" ? "Tu factura todavia no esta lista. El vendedor debe cerrar la sesion primero." : "El equipo local debe registrar la recepcion del envio antes del pago final.",
    code: stage === "inicial" ? CHECKOUT_ERROR.INVOICE_NOT_READY : CHECKOUT_ERROR.SHIPMENT_NOT_RECEIVED,
  }, { status: 409 })
  if (Number(session.paid) > 0) return NextResponse.json({ error: "Este pago ya fue completado.", code: CHECKOUT_ERROR.ALREADY_PAID }, { status: 409 })
  if (stage === "inicial" && !await confirmDeliveryAddress(sessionId, address, city)) {
    return NextResponse.json({ error: "La direccion de entrega ya no se puede cambiar.", code: CHECKOUT_ERROR.ADDRESS_LOCKED }, { status: 409 })
  }

  let stripe
  try {
    stripe = getStripe()
  } catch (error) {
    logger.error("Stripe is not configured", { error, sessionId, stage })
    return NextResponse.json({ error: "Los pagos no estan disponibles en este momento. Intentalo de nuevo en unos minutos.", code: CHECKOUT_ERROR.UNAVAILABLE }, { status: 503 })
  }
  let retryMarker = "initial"
  if (session.existing_checkout) {
    const existing = await stripe.checkout.sessions.retrieve(session.existing_checkout)
    if (existing.status === "open" && existing.url) return NextResponse.json({ checkoutUrl: existing.url })
    if (existing.status === "complete") return NextResponse.json({ error: "Payment confirmation is processing", code: CHECKOUT_ERROR.CONFIRMING }, { status: 409 })
    retryMarker = `after-${existing.id}`
    await clearSessionCheckout(existing.id, stage)
  }

  // Number(stage) was Number('65') or Number('35') before the split became
  // configurable. With 'inicial'/'final' it is NaN, so Stripe was being asked to
  // charge NaN cents. The amount now comes from the order's own percentage, via
  // the same helpers the invoice and the seller panel use, so the two charges
  // still add up to the total exactly.
  const total = Number(session.total)
  const percentage = Number(session.porcentaje_inicial)

  // An order paid 100% up front has no balance, so `finalAmount` is legitimately
  // 0 and the guard below would refuse it as an arithmetic failure — telling the
  // Colombia team to contact Brash3D about a supported configuration, and
  // logging an error for a routine business state. The panel already routes
  // these orders to `confirmDeliveryWithoutBalance`; this says the same thing to
  // anyone calling the API directly.
  if (stage === "final" && isPaidInFullUpFront(percentage)) {
    return NextResponse.json(
      // The sentence is pinned by scripts/session-contract-smoke-test.mjs.
      { error: "Este pedido ya fue pagado en su totalidad. Confirma la entrega sin cobro pendiente.", code: CHECKOUT_ERROR.SETTLED_IN_FULL },
      { status: 409 }
    )
  }

  const dueNow = stage === "inicial" ? initialAmount(total, percentage) : finalAmount(total, percentage)
  const amount = Math.round(dueNow * 100)
  // Still a genuine arithmetic safety net: anything else that computes a
  // non-positive charge is a fault worth logging at error level.
  if (!Number.isFinite(amount) || amount <= 0) {
    logger.error("Refusing to open a checkout for a non-positive amount", { sessionId, stage, total, percentage })
    return NextResponse.json({ error: "No pudimos calcular el monto a pagar. Contacta al equipo de Brash3D.", code: CHECKOUT_ERROR.AMOUNT_UNAVAILABLE }, { status: 409 })
  }
  const origin = new URL(request.url).origin
  const checkout = await stripe.checkout.sessions.create({
    mode: "payment",
    customer_email: session.email,
    line_items: [{ price_data: { currency: "usd", unit_amount: amount, product_data: { name: `Brash3D ${stage === "inicial" ? "initial" : "final"} payment` } }, quantity: 1 }],
    metadata: { session_id: sessionId, payment_stage: `session_${stage}` },
    payment_intent_data: { metadata: { session_id: sessionId, payment_stage: `session_${stage}` } },
    // The final charge is opened by the Colombia team, so that request carries
    // no customer token and the return URL falls back to the cookie.
    success_url: customerSessionUrl(origin, sessionId, accessToken, { payment: "processing" }),
    cancel_url: stage === "inicial"
      ? customerSessionUrl(origin, sessionId, accessToken, { payment: "cancelled" })
      : `${origin}/local-team?payment=cancelled`,
  }, { idempotencyKey: `session-${stage}-${sessionId}-${retryMarker}` })
  if (!checkout.url || !await attachSessionCheckout(sessionId, stage, checkout.id)) {
    if (checkout.status === "open") await stripe.checkout.sessions.expire(checkout.id)
    return NextResponse.json({ error: "Unable to attach payment checkout" }, { status: 409 })
  }
  return NextResponse.json({ checkoutUrl: checkout.url })
}

export const POST = withErrorHandling("POST payments/checkout", POSTHandler)
