import { NextResponse } from "next/server"
import type { EnvioEstado } from "@/lib/types"
import { invalidBody, readJsonBody, withErrorHandling } from "@/lib/api"
import { requestHasSameOrigin, requireStaff, verifyCustomerAccess } from "@/lib/auth"
import {
  isValidCommissionPercentage,
  isValidPercentage,
  MINIMUM_INITIAL_PERCENTAGE,
} from "@/lib/payment-split"
import {
  getSession,
  listSessions,
  addProductToSession,
  updateProductQuantity,
  removeProductFromSession,
  closeSession,
  reopenSessionForCorrection,
  rotateCustomerAccess,
  setCommissionRate,
  startSession,
  updateDeliveryStatus,
} from "@/lib/store/sessionStore"
import { windowState } from "@/lib/store/whatsappStore"
import { businessNumber } from "@/lib/whatsapp/config"
import { sendProductUpdate, type SendOutcome } from "@/lib/whatsapp/send"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

/**
 * What the seller is told about the echo, as a short code the panel translates.
 *
 * `window_closed` is the only one with a remedy they can apply mid-call: the
 * customer has not messaged the business, so they should be asked to tap the
 * WhatsApp button on their order page. The rest are informational — the product
 * is on the invoice regardless, which is what section 7.1 requires.
 */
function echoStatus(outcome: SendOutcome): "sent" | "window_closed" | "failed" | "disabled" {
  if (outcome.status === "sent") return "sent"
  if (outcome.status === "disabled") return "disabled"
  return outcome.windowClosed ? "window_closed" : "failed"
}

async function POSTHandler(request: Request) {
  if (!requestHasSameOrigin(request)) {
    return NextResponse.json({ error: "Invalid request origin" }, { status: 403 })
  }
  const body = await readJsonBody(request)
  if (!body) return invalidBody()
  const { action, ...data } = body
  // Narrowed once, because the body is now `unknown`-valued rather than `any`.
  // Previously these flowed unvalidated into typed parameters: a JSON object
  // or array where a string was expected type-checked fine and failed deeper in.
  const sessionId = typeof data.sessionId === "string" ? data.sessionId : ""
  const nombre = typeof data.nombre === "string" ? data.nombre : ""

  const staff = await requireStaff(["admin", "seller"])
  if (!staff) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  if (action === "createCustomerAccess") {
    const session = await getSession(sessionId)
    if (!session || (staff.role === "seller" && session.vendedorId !== staff.sellerId)) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 })
    }
    const accessToken = await rotateCustomerAccess(sessionId)
    return NextResponse.json({ accessToken })
  }

  const targetSession = await getSession(sessionId)
  if (!targetSession || (staff.role === "seller" && targetSession.vendedorId !== staff.sellerId)) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 })
  }

  // The cart store gates every edit on `estado = 'en_progreso' AND started_at
  // IS NOT NULL` and answers `null` when the row does not match. Existence and
  // ownership were settled above, so from here a `null` means the session is in
  // the wrong state, not that it is missing — reporting that as "Session not
  // found" told a seller who had not pressed Start that their session did not
  // exist, which is false and offers no way out. `start` already answers 409
  // for the same class of mismatch; these three now agree with it.
  const sessionAcceptsEdits = targetSession.estado === "en_progreso" && Boolean(targetSession.startedAt)
  const notStarted = () => NextResponse.json(
    { error: targetSession.estado === "en_progreso"
      ? "Start the session before changing the cart"
      : "This session is closed and its cart can no longer be changed" },
    { status: 409 }
  )

  if (action === "addProduct") {
    if (!sessionId || !nombre?.trim() || !Number.isFinite(Number(data.precio)) || Number(data.precio) <= 0) {
      return NextResponse.json({ error: "A valid session, product name, and price are required" }, { status: 400 })
    }

    if (!sessionAcceptsEdits) return notStarted()

    const session = await addProductToSession(sessionId, {
      nombre: nombre.trim(),
      sku: typeof data.sku === "string" ? data.sku.replace(/^sku[\s:#-]*/i, "").trim() : undefined,
      precio: Number(data.precio),
      cantidad: Math.max(1, Number(data.cantidad) || 1),
      notas: typeof data.notas === "string" ? data.notas : undefined,
      urlImagen: typeof data.urlImagen === "string" ? data.urlImagen : undefined,
    })

    if (!session) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 })
    }

    // Specification 7.1: echo the item into the customer's WhatsApp chat so it
    // appears beside the video call without them switching screens. Awaited but
    // never allowed to fail the request -- the send returns an outcome rather
    // than throwing, precisely because the cart insert above has already
    // committed and the item belongs on the invoice either way.
    //
    // Only for a customer who asked for it. Consent is theirs to give from
    // their own order page; an unasked-for message costs the business number
    // its quality rating, and costs the customer a notification they did not
    // want in the middle of their evening.
    const added = session.productos[session.productos.length - 1]
    const echo = added && session.whatsappUpdates
      ? await sendProductUpdate(session.cliente.telefono, added.nombre, added.precio, added.cantidad)
      : { status: "disabled" as const }

    return NextResponse.json({ session, whatsapp: echoStatus(echo) })
  }

  if (action === "start") {
    const session = await startSession(sessionId)
    if (!session) {
      return NextResponse.json(
        { error: "Only a confirmed session that has not started can be started" },
        { status: 409 }
      )
    }
    return NextResponse.json({ session })
  }

  if (action === "updateQuantity") {
    const delta = Number(data.delta)
    if (!Number.isInteger(delta) || Math.abs(delta) !== 1) {
      return NextResponse.json({ error: "Quantity change must be 1 or -1" }, { status: 400 })
    }
    if (!sessionAcceptsEdits) return notStarted()

    const session = await updateProductQuantity(sessionId, typeof data.productId === "string" ? data.productId : "", delta)

    // The session is editable, so the only remaining cause is the product id.
    if (!session) {
      return NextResponse.json({ error: "Product not found in this session" }, { status: 404 })
    }

    return NextResponse.json({ session })
  }

  if (action === "removeProduct") {
    if (!sessionAcceptsEdits) return notStarted()

    const session = await removeProductFromSession(sessionId, typeof data.productId === "string" ? data.productId : "")

    if (!session) {
      return NextResponse.json({ error: "Product not found in this session" }, { status: 404 })
    }

    return NextResponse.json({ session })
  }

  if (action === "setCommissionRate") {
    const commissionPercentage = Number(data.commissionPercentage)
    if (!isValidCommissionPercentage(commissionPercentage)) {
      return NextResponse.json(
        { error: "The commission must be at least 0% and below 100%" },
        { status: 400 }
      )
    }
    const session = await setCommissionRate(sessionId, commissionPercentage)
    // Existence and ownership were settled above, so the only refusal left is
    // the state: a closed session prices no further. The cart guard is not
    // reused here on purpose — the rate is agreed before the call, so it has to
    // be settable on a session that has not been started yet.
    if (!session) {
      return NextResponse.json(
        { error: "The invoice is closed and its commission can no longer be changed" },
        { status: 409 }
      )
    }
    return NextResponse.json({ session })
  }

  if (action === "close") {
    const initialPercentage = Number(data.initialPercentage)
    if (!isValidPercentage(initialPercentage)) {
      return NextResponse.json(
        { error: `The up-front percentage must be at least ${MINIMUM_INITIAL_PERCENTAGE}% and at most 100%` },
        { status: 400 }
      )
    }
    const session = await closeSession(sessionId, initialPercentage)

    if (!session) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 })
    }

    return NextResponse.json({ session })
  }

  if (action === "reopenForCorrection") {
    if (staff.role !== "admin") {
      return NextResponse.json({ error: "Only an admin can reopen a closed session" }, { status: 403 })
    }
    const session = await reopenSessionForCorrection(sessionId, staff.id)
    if (!session) {
      return NextResponse.json({ error: "Only a closed, unpaid session without a shipment or active checkout can be reopened" }, { status: 409 })
    }
    return NextResponse.json({ session })
  }

  if (action === "updateDeliveryStatus") {
    // Per the client workflow, seller/admin creates the individual shipment.
    // USA operations handles consolidation; receipt, delivery, and final payment
    // belong to the Colombia local-team API.
    const allowed = ["preparacion"] as const
    const status = typeof data.status === "string" ? data.status : ""
    if (!allowed.includes(status as (typeof allowed)[number])) {
      return NextResponse.json({ error: "Invalid delivery status" }, { status: 400 })
    }
    const session = await updateDeliveryStatus(sessionId, status as EnvioEstado)
    if (!session) {
      // `updateDeliveryStatus` answers null for every refusal — no payment, no
      // confirmed address, a shipment that already exists — and this used to
      // collapse all of them into one message that named a "65%" payment the
      // split stopped being fixed at. The seller can now create the shipment
      // straight from the listing, so the reason has to be the actual one:
      // there is no panel to open and inspect.
      return NextResponse.json(
        { error: targetSession.envio
          ? "This order already has a shipment"
          : targetSession.montoPagadoInicial <= 0
            ? "The customer's up-front payment has not been confirmed yet"
            : !targetSession.deliveryAddress || !targetSession.deliveryCity
              ? "The customer has not confirmed their delivery address yet"
              : "This order is not ready for the next delivery step" },
        { status: 409 }
      )
    }
    return NextResponse.json({ session })
  }

  return NextResponse.json({ error: "Invalid action" }, { status: 400 })
}

async function GETHandler(request: Request) {
  const { searchParams } = new URL(request.url)
  const id = searchParams.get("id")

  if (!id) {
    const staff = await requireStaff(["admin", "seller"])
    if (!staff) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    const sessions = await listSessions()
    return NextResponse.json({
      sessions: staff.role === "seller"
        ? sessions.filter((session) => session.vendedorId === staff.sellerId)
        : sessions,
    })
  }

  const session = await getSession(id)

  if (!session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 })
  }

  const staff = await requireStaff(["admin", "seller"])
  const staffCanAccess = Boolean(
    staff && (staff.role === "admin" || session.vendedorId === staff.sellerId)
  )
  const customerCanAccess = await verifyCustomerAccess(id, searchParams.get("access"))
  if (!staffCanAccess && !customerCanAccess) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 })
  }

  // The business number, so the customer's page can offer a one-tap chat link.
  // Sent as the bare number rather than a finished wa.me URL on purpose: the
  // prefilled text has to be in the reader's language, and the server does not
  // know it -- the locale lives in a cookie the client owns. Omitted entirely
  // when WhatsApp is not configured, so the card simply does not render.
  //
  // Not a secret. It is the number the business publishes to be messaged on.
  const whatsappNumber = businessNumber()

  // Whether the seller may send free text to this customer right now. Only the
  // staff view needs it: it is the difference between "adding a product will
  // reach them" and "ask them to tap the WhatsApp button first".
  const whatsappWindow = staffCanAccess && whatsappNumber
    ? await windowState(session.cliente.telefono)
    : undefined

  return NextResponse.json({ session, whatsappNumber, whatsappWindow })
}

export const GET = withErrorHandling("GET sessions", GETHandler)
export const POST = withErrorHandling("POST sessions", POSTHandler)
