import { NextResponse } from "next/server"
import { invalidBody, readJsonBody, withErrorHandling } from "@/lib/api"
import { requestHasSameOrigin, verifyCustomerAccess } from "@/lib/auth"
import { logger } from "@/lib/logger"
import { setWhatsAppUpdates } from "@/lib/store/sessionStore"
import { businessNumber } from "@/lib/whatsapp/config"
import { copy } from "@/lib/whatsapp/messages"
import { sendText } from "@/lib/whatsapp/send"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

/**
 * The customer turning WhatsApp updates on or off for their own order.
 *
 * A separate route from `/api/sessions` because that one is staff-only: it
 * calls `requireStaff` before anything else, and this is the customer's
 * decision to make about their own phone. Authorized by the access token their
 * order link carries, the same credential the payment route accepts.
 */
async function POSTHandler(request: Request) {
  if (!requestHasSameOrigin(request)) {
    return NextResponse.json({ error: "Invalid request origin" }, { status: 403 })
  }

  const body = await readJsonBody(request)
  if (!body) return invalidBody()

  const sessionId = typeof body.sessionId === "string" ? body.sessionId : ""
  const accessToken = typeof body.accessToken === "string" ? body.accessToken : null
  if (typeof body.enabled !== "boolean") {
    return NextResponse.json({ error: "enabled must be true or false" }, { status: 400 })
  }

  if (!await verifyCustomerAccess(sessionId, accessToken)) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 })
  }

  const session = await setWhatsAppUpdates(sessionId, body.enabled)
  if (!session) return NextResponse.json({ error: "Session not found" }, { status: 404 })

  // A confirmation the customer can see, sent on the way in rather than left
  // for the first product: it proves the number we hold is the one they are
  // holding, at a moment they are looking at the screen and can fix a typo --
  // rather than at 8pm on session night when the seller is already on the call.
  //
  // Only when a window is already open, which is the case when they arrived
  // here by tapping the chat link. Outside one this would need a template, and
  // spending a template on "you are subscribed" is not worth it.
  if (body.enabled && businessNumber()) {
    const outcome = await sendText(session.cliente.telefono, copy().updatesEnabled)
    logger.info("WhatsApp updates enabled", { sessionId, confirmation: outcome.status })
  }

  return NextResponse.json({ session })
}

export const POST = withErrorHandling("POST whatsapp/updates", POSTHandler)
