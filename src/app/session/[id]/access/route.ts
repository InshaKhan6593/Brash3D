import { cookies } from "next/headers"
import { NextResponse } from "next/server"
import { withErrorHandling } from "@/lib/api"
import { CUSTOMER_COOKIE, customerAccessCookie, verifyCustomerAccess } from "@/lib/auth"

export const runtime = "nodejs"

// Hands the page its own access token back.
//
// Two callers. A cookie created before the booking cookie-path fix is scoped
// below /session/{id}, so it reaches this endpoint and nothing else; refreshing
// it here widens it to the whole site. And a customer whose URL carries no
// token -- the browser that made the booking, or a link shared before this
// endpoint existed -- needs the token to put back in the address bar, so the
// URL they are left looking at is portable like every other customer link.
async function GETHandler(_request: Request, context: RouteContext<"/session/[id]/access">) {
  const { id } = await context.params
  const token = (await cookies()).get(CUSTOMER_COOKIE)?.value
  if (!token || !await verifyCustomerAccess(id, token)) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 })
  }

  // Returning the token to a caller that already presented it in a cookie for
  // this exact session grants nothing it did not already hold.
  const response = NextResponse.json({ recovered: true, accessToken: token })
  response.cookies.set(CUSTOMER_COOKIE, token, customerAccessCookie())
  return response
}

export const GET = withErrorHandling("GET session/access", GETHandler)
