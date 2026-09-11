import { NextResponse } from "next/server"
import { bearerTokenMatches, withErrorHandling } from "@/lib/api"
import { logger } from "@/lib/logger"
import { runMaintenance } from "@/lib/store/maintenance"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

/**
 * Platform-cron entry point for the same work `src/instrumentation.ts` runs on
 * a timer. A serverless deployment freezes its instances between requests, so
 * an interval never fires there and the platform scheduler drives this instead
 * (Vercel Cron sends `Authorization: Bearer $CRON_SECRET`, which is the header
 * shape checked here).
 *
 * Without `MAINTENANCE_SECRET` the route stays closed rather than open: an
 * unauthenticated endpoint that cancels bookings is not something to leave
 * exposed by a missing environment variable.
 */
async function POSTHandler(request: Request) {
  const secret = process.env.MAINTENANCE_SECRET
  if (!secret) {
    return NextResponse.json({ error: "Maintenance endpoint is not configured" }, { status: 503 })
  }

  if (!bearerTokenMatches(request, secret)) {
    logger.warn("Rejected unauthorized maintenance request")
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const result = await runMaintenance()
  return NextResponse.json({ ok: true, ...result })
}

export const POST = withErrorHandling("POST /api/maintenance", POSTHandler)

/**
 * Vercel Cron invokes its target with GET, not POST, so the same work is
 * reachable under both verbs. This is not an unguarded read: the bearer check
 * above runs either way, and Vercel sends `Authorization: Bearer $CRON_SECRET`,
 * so `MAINTENANCE_SECRET` and `CRON_SECRET` must be set to the same value.
 */
export const GET = withErrorHandling("GET /api/maintenance", POSTHandler)
