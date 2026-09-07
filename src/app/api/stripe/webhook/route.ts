import { NextResponse } from "next/server"
import type Stripe from "stripe"
import { clearSessionCheckout, processBookingCheckoutEvent, processSessionCheckoutEvent } from "@/lib/store/sessionStore"
import { getStripe, getStripeWebhookSecret } from "@/lib/stripe"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

export async function POST(request: Request) {
  const signature = request.headers.get("stripe-signature")
  if (!signature) return NextResponse.json({ error: "Missing Stripe signature" }, { status: 400 })

  let event: Stripe.Event
  try {
    event = getStripe().webhooks.constructEvent(
      await request.text(),
      signature,
      getStripeWebhookSecret()
    )
  } catch {
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
  if (paymentStage === "session_65" || paymentStage === "session_35") {
    const stage = paymentStage === "session_65" ? "65" : "35"
    if (event.type === "checkout.session.expired") {
      await clearSessionCheckout(checkout.id, stage)
      return NextResponse.json({ received: true, outcome: "expired" })
    }
    const outcome = await processSessionCheckoutEvent({
      eventId: event.id,
      checkoutSessionId: checkout.id,
      paymentIntentId,
      stage,
      paid: checkout.payment_status === "paid",
    })
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
    await getStripe().refunds.create(
      { payment_intent: paymentIntentId, reason: "requested_by_customer" },
      { idempotencyKey: `expired-booking-${checkout.id}` }
    )
    outcome = await processBookingCheckoutEvent({ ...input, latePaymentRefunded: true })
  }

  return NextResponse.json({ received: true, outcome })
}
