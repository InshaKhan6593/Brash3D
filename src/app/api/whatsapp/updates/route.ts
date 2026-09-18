import { NextResponse } from "next/server"
import { invalidBody, readJsonBody, withErrorHandling } from "@/lib/api"
import { requestHasSameOrigin, verifyCustomerAccess } from "@/lib/auth"
import { logger } from "@/lib/logger"
import { setWhatsAppUpdates } from "@/lib/store/sessionStore"

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

  // Records the preference and sends nothing. The confirmation is answered by
  // the inbound webhook when the customer's own message arrives, because that
  // message -- not this tap -- is what opens Meta's window.
  //
  // Tapping only opens WhatsApp with text prefilled; WhatsApp never sends on a
  // customer's behalf. Confirming here told anyone who opened the chat and
  // closed it again that every product would reach them, when nothing could.
  logger.info("WhatsApp updates preference saved", { sessionId, enabled: body.enabled })

  return NextResponse.json({ session })
}

export const POST = withErrorHandling("POST whatsapp/updates", POSTHandler)
