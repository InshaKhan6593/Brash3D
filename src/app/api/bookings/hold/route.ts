import { NextResponse } from "next/server"
import { invalidBody, readJsonBody, withErrorHandling } from "@/lib/api"
import { requestHasSameOrigin, verifyCustomerAccess } from "@/lib/auth"
import { logger } from "@/lib/logger"
import { bookingHoldForSession, cancelBookingHold } from "@/lib/store/sessionStore"
import { getStripe } from "@/lib/stripe"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

/**
 * A customer's unpaid booking hold, for the customer who made it.
 *
 * Booking puts a 15-minute hold on the slot and sends the customer to Stripe.
 * A customer who pressed Back -- the browser's, or the arrow on Stripe's own
 * page -- used to land on a booking page that showed their slot as free (the
 * browser's cached copy from before the hold) and then refused it when they
 * tried to pay again, because their own hold was the thing blocking it. They
 * were locked out until the hold lapsed, with no way back to the payment.
 *
 * `GET` tells the booking page whether the hold is still live and hands back
 * the Stripe link to resume it. `POST` releases it, so the customer can pick
 * the same slot again or another one.
 *
 * Authorised by the customer access token the booking response carried, the
 * same credential as the order page.
 */
type HoldStatus = "pending" | "processing" | "confirmed" | "released"

async function GETHandler(request: Request) {
  const { searchParams } = new URL(request.url)
  const sessionId = searchParams.get("sessionId") || ""
  if (!sessionId || !await verifyCustomerAccess(sessionId, searchParams.get("access"))) {
    return NextResponse.json({ error: "Booking not found" }, { status: 404 })
  }

  const hold = await bookingHoldForSession(sessionId)
  if (!hold) return NextResponse.json({ error: "Booking not found" }, { status: 404 })

  if (hold.estado === "confirmada" || hold.estado === "completada") {
    return NextResponse.json({ status: "confirmed" satisfies HoldStatus })
  }
  if (!hold.active) return NextResponse.json({ status: "released" satisfies HoldStatus })

  // The link lives in Stripe, not in the database or the browser, so it is the
  // one Stripe will still accept.
  let checkoutUrl: string | null = null
  if (hold.checkoutSessionId) {
    const checkout = await getStripe().checkout.sessions.retrieve(hold.checkoutSessionId)
    // Paid, and the webhook has not confirmed the booking yet. Offering to pay
    // again, or to release the slot, would both be wrong.
    if (checkout.status === "complete") return NextResponse.json({ status: "processing" satisfies HoldStatus })
    if (checkout.status === "open") checkoutUrl = checkout.url
  }

  return NextResponse.json({
    status: "pending" satisfies HoldStatus,
    holdExpiresAt: hold.holdExpiresAt,
    startsAt: hold.startsAt,
    checkoutUrl,
  })
}

async function POSTHandler(request: Request) {
  if (!requestHasSameOrigin(request)) {
    return NextResponse.json({ error: "Invalid request origin" }, { status: 403 })
  }
  const body = await readJsonBody(request)
  if (!body) return invalidBody()
  const sessionId = typeof body.sessionId === "string" ? body.sessionId : ""
  const accessToken = typeof body.accessToken === "string" ? body.accessToken : null
  if (!sessionId || !await verifyCustomerAccess(sessionId, accessToken)) {
    return NextResponse.json({ error: "Booking not found" }, { status: 404 })
  }

  const hold = await bookingHoldForSession(sessionId)
  if (!hold) return NextResponse.json({ error: "Booking not found" }, { status: 404 })
  if (hold.estado === "confirmada" || hold.estado === "completada") {
    return NextResponse.json({ status: "confirmed" satisfies HoldStatus })
  }
  if (hold.estado !== "pendiente_pago") return NextResponse.json({ status: "released" satisfies HoldStatus })

  // The Stripe checkout is closed before the slot is released, and the order
  // matters. Released first, a payment already in flight could still land on a
  // slot somebody else has since taken. Expiring first, Stripe either refuses
  // (the customer has just paid, so nothing is released) or guarantees no
  // payment can follow.
  if (hold.checkoutSessionId) {
    const stripe = getStripe()
    const checkout = await stripe.checkout.sessions.retrieve(hold.checkoutSessionId)
    if (checkout.status === "complete") return NextResponse.json({ status: "processing" satisfies HoldStatus })
    if (checkout.status === "open") {
      try {
        await stripe.checkout.sessions.expire(hold.checkoutSessionId)
      } catch (error) {
        // Most likely completed between the retrieve and the expire. Leave the
        // hold alone: the webhook will confirm the booking.
        logger.warn("Could not expire the booking checkout before releasing the hold", { sessionId, error })
        return NextResponse.json({ status: "processing" satisfies HoldStatus })
      }
    }
  }

  await cancelBookingHold(hold.bookingId, "customer_released")
  return NextResponse.json({ status: "released" satisfies HoldStatus })
}

export const GET = withErrorHandling("GET booking hold", GETHandler)
export const POST = withErrorHandling("POST booking hold", POSTHandler)
