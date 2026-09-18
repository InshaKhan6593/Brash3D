import { NextResponse } from "next/server"
import { withErrorHandling } from "@/lib/api"
import { logger } from "@/lib/logger"
import { recordInboundMessage } from "@/lib/store/whatsappStore"
import { appSecret, verifyToken } from "@/lib/whatsapp/config"
import { inboundMessages, signatureMatches } from "@/lib/whatsapp/signature"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

/**
 * Meta's subscription handshake.
 *
 * Called once when the callback URL is saved in the Meta dashboard, and again
 * whenever the subscription is edited. Meta sends the token configured there
 * and expects the challenge echoed back verbatim as plain text -- a JSON body
 * fails verification, which is a confusing way to spend an afternoon.
 */
async function GETHandler(request: Request) {
  const params = new URL(request.url).searchParams
  const mode = params.get("hub.mode")
  const token = params.get("hub.verify_token")
  const challenge = params.get("hub.challenge")

  const expected = verifyToken()
  if (!expected) {
    logger.warn("WhatsApp webhook verification attempted with no WHATSAPP_VERIFY_TOKEN set")
    return new NextResponse("Not configured", { status: 503 })
  }

  if (mode !== "subscribe" || token !== expected || !challenge) {
    logger.warn("WhatsApp webhook verification rejected", { mode, hasChallenge: Boolean(challenge) })
    return new NextResponse("Forbidden", { status: 403 })
  }

  logger.info("WhatsApp webhook verified")
  return new NextResponse(challenge, {
    status: 200,
    headers: { "content-type": "text/plain" },
  })
}

/**
 * Inbound events: customer messages, and the delivery receipts for our own.
 *
 * What this is *for* is narrow. The seller cannot send free text to a customer
 * who has not messaged the business in the last 24 hours, and until one arrives
 * here there is no way to know whether that has happened -- so the seller finds
 * out only when a send is rejected, mid-call. An inbound message is the signal
 * that the window is open.
 *
 * Always answers 200 once the signature is good. Meta retries anything else,
 * and a retry storm over a message we have already read helps nobody; a failure
 * on our side belongs in the log, not in the response.
 */
async function POSTHandler(request: Request) {
  // Read the body as text, not JSON: the signature is over the exact bytes Meta
  // sent, and re-serialising a parsed object will not reproduce them.
  const rawBody = await request.text()

  if (!signatureMatches(rawBody, request.headers.get("x-hub-signature-256"), appSecret())) {
    logger.warn("WhatsApp webhook signature verification failed", {
      configured: Boolean(appSecret()),
    })
    return NextResponse.json({ error: "Invalid signature" }, { status: 403 })
  }

  let payload: unknown
  try {
    payload = JSON.parse(rawBody)
  } catch {
    // Signed by Meta but unparseable. Nothing to do with it, and no point
    // asking them to send it again.
    logger.warn("WhatsApp webhook received a signed body that is not JSON")
    return NextResponse.json({ received: true })
  }

  const messages = inboundMessages(payload)
  for (const message of messages) {
    // Every inbound message opens or extends the window, whatever it contains --
    // a sticker counts the same as a sentence. So the recording is
    // unconditional, and only the logging distinguishes types.
    await recordInboundMessage(message.from, message.sentAt, message.id)

    // The message body is a customer's own words and may contain anything at
    // all, so it is logged by length rather than content.
    logger.info("WhatsApp inbound message", {
      messageId: message.id,
      from: message.from,
      type: message.type,
      sentAt: message.sentAt.toISOString(),
      textLength: message.text?.length ?? 0,
    })
  }

  return NextResponse.json({ received: true, messages: messages.length })
}

export const GET = withErrorHandling("GET whatsapp/webhook", GETHandler)
export const POST = withErrorHandling("POST whatsapp/webhook", POSTHandler)
