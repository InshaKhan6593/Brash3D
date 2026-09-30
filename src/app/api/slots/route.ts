import { NextResponse } from "next/server"
import { withErrorHandling } from "@/lib/api"
import { getTimeSlots } from "@/lib/store/sessionStore"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

/**
 * Held at the CDN for a few seconds, so a crowd opening the booking page at
 * once -- a promotion, a post going round -- costs one database query every
 * five seconds rather than one per visitor. The browser itself never keeps a
 * copy (`max-age=0`), so each visit still asks the edge.
 *
 * Five seconds is safe because the slot list only guides the choice; it never
 * decides it. `createBookingWithSession` locks the slot row, so a customer who
 * picks a slot booked in the last few seconds is told it is taken rather than
 * double-booked -- the stress test raced ten bookings at one slot and got one.
 *
 * The booking page asks for `?fresh=<time>` when it has just changed a slot
 * itself -- released a hold, or been refused one -- so the customer sees that
 * change at once. A new query string is a new cache entry.
 */
const CACHE_CONTROL = "public, max-age=0, s-maxage=5, stale-while-revalidate=5"

async function GETHandler() {
  const slots = await getTimeSlots()
  return NextResponse.json({ slots }, { headers: { "Cache-Control": CACHE_CONTROL } })
}

export const GET = withErrorHandling("GET slots", GETHandler)
