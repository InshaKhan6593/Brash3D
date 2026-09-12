import { NextResponse } from "next/server"
import { invalidBody, readJsonBody, withErrorHandling } from "@/lib/api"
import { allowRequest, CUSTOMER_COOKIE, customerAccessCookie, requestHasSameOrigin, requireStaff } from "@/lib/auth"
import { customerSessionPath, customerSessionUrl } from "@/lib/customer-link"
import {
  attachBookingCheckout,
  cancelBookingHold,
  createBookingWithSession,
  getBooking,
} from "@/lib/store/sessionStore"
import { getStripe } from "@/lib/stripe"
import { DEFAULT_COUNTRY } from "@/lib/countries"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

async function POSTHandler(request: Request) {
  if (!requestHasSameOrigin(request)) {
    return NextResponse.json({ error: "Invalid request origin" }, { status: 403 })
  }
  const body = await readJsonBody(request)
  if (!body) return invalidBody()

  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    || request.headers.get("x-real-ip")
    || "local"
  if (!await allowRequest(`booking:${ip}`, 10, 60 * 60)) {
    return NextResponse.json({ error: "Too many booking attempts. Please try again later." }, { status: 429 })
  }

  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : ""
  const phone = typeof body.telefono === "string" ? body.telefono.trim() : ""
  const name = typeof body.nombre === "string" ? body.nombre.trim() : ""
  const city = typeof body.ciudad === "string" ? body.ciudad.trim() : ""
  const referralCode = typeof body.referralCode === "string" ? body.referralCode.trim() : ""
  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
  if (!name || name.length > 255 || !emailValid || email.length > 255 || phone.length < 7 || phone.length > 50 || city.length > 100 || !body.slotId) {
    return NextResponse.json(
      { error: "Name, email, phone, and time slot are required" },
      { status: 400 }
    )
  }

  const customer = {
    nombre: name,
    email,
    telefono: phone,
    ciudad: city,
    pais: typeof body.pais === "string" && body.pais ? body.pais : DEFAULT_COUNTRY.name,
    referralCode,
    requiresLocalInvoice: body.requiresLocalInvoice === true,
  }

  try {
    const { booking, session, accessToken, rewardApplied } = await createBookingWithSession(customer, typeof body.slotId === "string" ? body.slotId : "")
    const customerCookie = customerAccessCookie()
    if (rewardApplied) {
      const response = NextResponse.json({
        booking,
        session: { id: session.id },
        // The durable link, so the page the customer is sent to carries its own
        // credential rather than depending on the cookie set below.
        sessionUrl: customerSessionPath(session.id, accessToken),
        rewardApplied: true,
      }, { status: 201 })
      response.cookies.set(CUSTOMER_COOKIE, accessToken, customerCookie)
      return response
    }
    try {
      const origin = new URL(request.url).origin
      const checkout = await getStripe().checkout.sessions.create({
        mode: "payment",
        customer_email: email,
        line_items: [{
          price_data: {
            currency: "usd",
            unit_amount: 2_000,
            product_data: { name: "Brash3D live shopping booking fee" },
          },
          quantity: 1,
        }],
        metadata: { booking_id: booking.id, session_id: session.id, payment_stage: "booking_fee" },
        payment_intent_data: {
          metadata: { booking_id: booking.id, session_id: session.id, payment_stage: "booking_fee" },
        },
        success_url: customerSessionUrl(origin, session.id, accessToken, { payment: "processing" }),
        cancel_url: `${origin}/?checkout=cancelled`,
        expires_at: Math.floor(Date.now() / 1000) + 30 * 60,
      }, { idempotencyKey: `booking-checkout-${booking.id}` })

      if (!checkout.url || !await attachBookingCheckout(booking.id, checkout.id)) {
        if (checkout.status === "open") await getStripe().checkout.sessions.expire(checkout.id)
        await cancelBookingHold(booking.id, "checkout_setup_failed")
        return NextResponse.json({ error: "Unable to start payment. The slot has been released." }, { status: 503 })
      }

      const response = NextResponse.json({
        booking,
        session: { id: session.id },
        sessionUrl: customerSessionPath(session.id, accessToken),
        checkoutUrl: checkout.url,
        holdExpiresAt: booking.holdExpiresAt,
      }, { status: 201 })
      response.cookies.set(CUSTOMER_COOKIE, accessToken, customerCookie)
      return response
    } catch (stripeError) {
      await cancelBookingHold(booking.id, "stripe_unavailable")
      if (stripeError instanceof Error && stripeError.message === "STRIPE_TEST_MODE_NOT_CONFIGURED") {
        return NextResponse.json({ error: "Stripe test mode is not configured. The slot has been released." }, { status: 503 })
      }
      return NextResponse.json({ error: "Payment service is unavailable. The slot has been released." }, { status: 503 })
    }
  } catch (error) {
    if (error instanceof Error && error.message === "SLOT_NOT_AVAILABLE") {
      return NextResponse.json(
        { error: "That time slot is no longer available" },
        { status: 409 }
      )
    }
    if (error instanceof Error && error.message === "INVALID_REFERRAL_CODE") {
      return NextResponse.json({ error: "That referral code is not valid." }, { status: 400 })
    }
    if (error instanceof Error && error.message === "REFERRAL_CODE_ONLY_FIRST_BOOKING") {
      return NextResponse.json({ error: "Referral codes can only be added to a customer’s first booking." }, { status: 400 })
    }
    throw error
  }
}

async function GETHandler(request: Request) {
  if (!await requireStaff(["admin", "seller"])) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  const { searchParams } = new URL(request.url)
  const id = searchParams.get("id")

  if (!id) {
    return NextResponse.json({ error: "Missing booking ID" }, { status: 400 })
  }

  const booking = await getBooking(id)

  if (!booking) {
    return NextResponse.json({ error: "Booking not found" }, { status: 404 })
  }

  return NextResponse.json({ booking })
}

export const GET = withErrorHandling("GET bookings", GETHandler)
export const POST = withErrorHandling("POST bookings", POSTHandler)
