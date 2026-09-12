import "server-only"

import { SignJWT } from "jose"
import { REALTIME_TOKEN_TTL_SECONDS, SESSION_CLAIM } from "@/lib/realtime/config"

/**
 * Mints the token a browser presents to Supabase Realtime.
 *
 * Signed with the project's JWT secret, so PostgreSQL sees the claims through
 * `auth.jwt()` and the policies in migration 018 can scope every read to one
 * session. The browser never chooses this scope: it asks for a session it
 * already holds a customer access token for, the route verifies that, and the
 * session id is baked into a signature the browser cannot alter.
 *
 * `role: authenticated` is what Supabase maps onto the PostgreSQL role of the
 * same name -- the one holding SELECT on exactly three tables, each behind a
 * policy. A token is therefore useless for anything but watching one order.
 *
 * Returns null when `SUPABASE_JWT_SECRET` is unset, which is how the app runs
 * before the credentials are configured: the caller falls back to polling
 * rather than failing.
 */
export async function mintRealtimeToken(sessionId: string): Promise<{ token: string; expiresIn: number } | null> {
  const secret = process.env.SUPABASE_JWT_SECRET
  if (!secret) return null

  const now = Math.floor(Date.now() / 1000)
  const token = await new SignJWT({
    role: "authenticated",
    [SESSION_CLAIM]: sessionId,
  })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setSubject(sessionId)
    .setAudience("authenticated")
    .setIssuedAt(now)
    .setExpirationTime(now + REALTIME_TOKEN_TTL_SECONDS)
    .sign(new TextEncoder().encode(secret))

  return { token, expiresIn: REALTIME_TOKEN_TTL_SECONDS }
}
