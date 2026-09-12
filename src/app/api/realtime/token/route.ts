import { NextResponse } from "next/server"
import { withErrorHandling } from "@/lib/api"
import { verifyCustomerAccess } from "@/lib/auth"
import { isRealtimeConfigured, SUPABASE_ANON_KEY, SUPABASE_URL } from "@/lib/realtime/config"
import { mintRealtimeToken } from "@/lib/realtime/token"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

/**
 * Issues a browser the credentials to watch one order over Supabase Realtime.
 *
 * Authorisation is the same check every other customer route makes: the access
 * token from the URL, or the cookie. Holding it is what earns a subscription
 * scoped to that session and nothing else.
 *
 * A 404 rather than a 403 for an unauthorised session, matching
 * `GET /api/sessions` -- an unknown session and someone else's are deliberately
 * indistinguishable.
 */
async function GETHandler(request: Request) {
  const { searchParams } = new URL(request.url)
  const sessionId = searchParams.get("sessionId")
  if (!sessionId) return NextResponse.json({ error: "Missing session ID" }, { status: 400 })

  if (!await verifyCustomerAccess(sessionId, searchParams.get("access"))) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 })
  }

  const minted = isRealtimeConfigured() ? await mintRealtimeToken(sessionId) : null
  if (!minted) {
    // Not an error: Realtime is optional, and the page polls without it. Said
    // explicitly so the client stops asking rather than retrying every render.
    return NextResponse.json({ enabled: false })
  }

  return NextResponse.json({
    enabled: true,
    url: SUPABASE_URL,
    anonKey: SUPABASE_ANON_KEY,
    token: minted.token,
    expiresIn: minted.expiresIn,
  })
}

export const GET = withErrorHandling("GET realtime/token", GETHandler)
