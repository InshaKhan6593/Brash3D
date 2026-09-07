import { NextResponse } from "next/server"
import { requestHasSameOrigin, requireStaff, verifyCustomerAccess } from "@/lib/auth"
import { query } from "@/lib/db"
import { attachSessionCheckout, clearSessionCheckout } from "@/lib/store/sessionStore"
import { getStripe } from "@/lib/stripe"

export const runtime = "nodejs"

export async function POST(request: Request) {
  if (!requestHasSameOrigin(request)) return NextResponse.json({ error: "Invalid request origin" }, { status: 403 })
  const body = await request.json()
  const sessionId = typeof body.sessionId === "string" ? body.sessionId : ""
  const stage = body.stage === "35" ? "35" : body.stage === "65" ? "65" : null
  const address = typeof body.address === "string" ? body.address.trim() : ""
  const city = typeof body.city === "string" ? body.city.trim() : ""
  if (!sessionId || !stage) return NextResponse.json({ error: "Invalid payment request" }, { status: 400 })

  if (stage === "65") {
    if (!await verifyCustomerAccess(sessionId, null)) return NextResponse.json({ error: "Session not found" }, { status: 404 })
    if (address.length < 8 || address.length > 500 || city.length < 2 || city.length > 100) {
      return NextResponse.json({ error: "Enter a complete delivery address and city in Colombia" }, { status: 400 })
    }
  } else {
    const staff = await requireStaff(["admin", "local_team"])
    if (!staff) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const result = await query<{
    total: string; email: string; paid: string; existing_checkout: string | null; shipment_status: string | null
  }>(`
    SELECT sc.total::text, c.email,
      CASE WHEN $2 = '65' THEN sc.monto_pagado_65::text ELSE sc.monto_pagado_35::text END AS paid,
      CASE WHEN $2 = '65' THEN sc.checkout_session_65_id ELSE sc.checkout_session_35_id END AS existing_checkout,
      e.estado::text AS shipment_status
    FROM sesiones_compra sc JOIN clientes c ON c.id=sc.cliente_id
    LEFT JOIN envios e ON e.sesion_id=sc.id
    WHERE sc.id::text=$1 AND sc.estado='completada' AND sc.total > 0
      AND ($2 = '65' OR (sc.monto_pagado_65 > 0 AND e.estado='recibido_equipo_local'))
  `, [sessionId, stage])
  const session = result.rows[0]
  if (!session) return NextResponse.json({ error: stage === "65" ? "Invoice is not ready" : "Shipment must be received by the local team first" }, { status: 409 })
  if (Number(session.paid) > 0) return NextResponse.json({ error: "This payment is already complete" }, { status: 409 })
  if (stage === "65") {
    const saved = await query(`
      UPDATE sesiones_compra SET direccion_entrega=$2, ciudad_entrega=$3, direccion_confirmada_at=now()
      WHERE id::text=$1 AND estado='completada' AND monto_pagado_65=0
    `, [sessionId, address, city])
    if (!saved.rowCount) return NextResponse.json({ error: "The delivery address can no longer be changed" }, { status: 409 })
  }

  let stripe
  try {
    stripe = getStripe()
  } catch {
    return NextResponse.json({ error: "Payments are temporarily unavailable" }, { status: 503 })
  }
  let retryMarker = "initial"
  if (session.existing_checkout) {
    const existing = await stripe.checkout.sessions.retrieve(session.existing_checkout)
    if (existing.status === "open" && existing.url) return NextResponse.json({ checkoutUrl: existing.url })
    if (existing.status === "complete") return NextResponse.json({ error: "Payment confirmation is processing" }, { status: 409 })
    retryMarker = `after-${existing.id}`
    await clearSessionCheckout(existing.id, stage)
  }

  const amount = Math.round(Number(session.total) * Number(stage) / 100 * 100)
  const origin = new URL(request.url).origin
  const checkout = await stripe.checkout.sessions.create({
    mode: "payment",
    customer_email: session.email,
    line_items: [{ price_data: { currency: "usd", unit_amount: amount, product_data: { name: `Brash3D ${stage}% ${stage === "65" ? "initial" : "final"} payment` } }, quantity: 1 }],
    metadata: { session_id: sessionId, payment_stage: `session_${stage}` },
    payment_intent_data: { metadata: { session_id: sessionId, payment_stage: `session_${stage}` } },
    success_url: `${origin}/session/${sessionId}?payment=processing`,
    cancel_url: stage === "65" ? `${origin}/session/${sessionId}?payment=cancelled` : `${origin}/local-team?payment=cancelled`,
  }, { idempotencyKey: `session-${stage}-${sessionId}-${retryMarker}` })
  if (!checkout.url || !await attachSessionCheckout(sessionId, stage, checkout.id)) {
    if (checkout.status === "open") await stripe.checkout.sessions.expire(checkout.id)
    return NextResponse.json({ error: "Unable to attach payment checkout" }, { status: 409 })
  }
  return NextResponse.json({ checkoutUrl: checkout.url })
}
