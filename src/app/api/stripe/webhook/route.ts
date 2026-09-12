import { NextResponse } from "next/server"
import { withErrorHandling } from "@/lib/api"
import { logger } from "@/lib/logger"
import type Stripe from "stripe"
import { clearSessionCheckout, processBookingCheckoutEvent, processSessionCheckoutEvent } from "@/lib/store/sessionStore"
import { getStripe, getStripeWebhookSecret } from "@/lib/stripe"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

async function POSTHandler(request: Request) {
  const signature = request.headers.get("stripe-signature")
  if (!signature) return NextResponse.json({ error: "Missing Stripe signature" }, { status: 400 })

  let event: Stripe.Event
  try {
    event = getStripe().webhooks.constructEvent(
      await request.text(),
      signature,
      getStripeWebhookSecret()
    )
  } catch (error) {
    logger.error("Stripe webhook signature verification failed", { error })
    return NextResponse.json({ error: "Invalid Stripe webhook signature" }, { status: 400 })
  }

  if (event.type !== "checkout.session.completed" && event.type !== "checkout.session.expired") {
    return NextResponse.json({ received: true })
  }

  const checkout = event.data.object as Stripe.Checkout.Session
  const paymentIntentId = typeof checkout.payment_intent === "string"
    ? checkout.payment_intent
    : checkout.payment_intent?.id
  const paymentStage = checkout.metadata?.payment_stage
  // "session_65"/"session_35" are accepted for checkouts opened before the split
  // became configurable, so a payment already in flight still reconciles.
  const stage = paymentStage === "session_inicial" || paymentStage === "session_65"
    ? "inicial"
    : paymentStage === "session_final" || paymentStage === "session_35"
      ? "final"
      : null
  if (stage) {
    if (event.type === "checkout.session.expired") {
      await clearSessionCheckout(checkout.id, stage)
      return NextResponse.json({ received: true, outcome: "expired" })
    }
    logger.info("Stripe session checkout received", { eventId: event.id, stage, checkoutSessionId: checkout.id })
    // Annotated because hoisting these out of the call widens the narrowed
    // `stage` back to `string`.
    const sessionInput: Parameters<typeof processSessionCheckoutEvent>[0] = {
      eventId: event.id,
      checkoutSessionId: checkout.id,
      paymentIntentId,
      stage,
      paid: checkout.payment_status === "paid",
    }
    let outcome = await processSessionCheckoutEvent(sessionInput)

    // The customer paid a Stripe link for a stage that was already settled --
    // in practice, the Colombia team sent the balance link and then took cash,
    // leaving the link live. Refusing the money silently would leave a real
    // charge on the customer's card with nothing recorded against the order, so
    // it is refunded and then written up against the order.
    if (outcome === "already_settled" && paymentIntentId) {
      logger.warn("Refunding a session payment for a stage that was already settled", {
        eventId: event.id, stage, checkoutSessionId: checkout.id,
      })
      await getStripe().refunds.create(
        { payment_intent: paymentIntentId, reason: "duplicate" },
        { idempotencyKey: `duplicate-session-${checkout.id}` }
      )
      outcome = await processSessionCheckoutEvent({ ...sessionInput, duplicateRefunded: true })
    }

    logger.info("Stripe session checkout processed", { eventId: event.id, stage, outcome })
    return NextResponse.json({ received: true, outcome })
  }
  const input = {
    eventId: event.id,
    eventType: event.type,
    checkoutSessionId: checkout.id,
    paymentIntentId,
    paid: checkout.payment_status === "paid",
  }

  let outcome = await processBookingCheckoutEvent(input)
  if (outcome === "late_payment" && paymentIntentId) {
    logger.warn("Refunding a booking payment that arrived after the hold expired", { eventId: event.id, checkoutSessionId: checkout.id })
    await getStripe().refunds.create(
      { payment_intent: paymentIntentId, reason: "requested_by_customer" },
      { idempotencyKey: `expired-booking-${checkout.id}` }
    )
    outcome = await processBookingCheckoutEvent({ ...input, latePaymentRefunded: true })
  }

  logger.info("Stripe booking checkout processed", { eventId: event.id, type: event.type, outcome })
  return NextResponse.json({ received: true, outcome })
}

export const POST = withErrorHandling("POST stripe/webhook", POSTHandler)
