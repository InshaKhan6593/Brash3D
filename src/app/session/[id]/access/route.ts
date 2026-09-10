import { cookies } from "next/headers"
import { NextResponse } from "next/server"
import { withErrorHandling } from "@/lib/api"
import { CUSTOMER_COOKIE, verifyCustomerAccess } from "@/lib/auth"

export const runtime = "nodejs"

// Migrates customer cookies created before the booking cookie-path fix. The old
// cookie is sent here because this endpoint is below /session/{id}.
async function GETHandler(_request: Request, context: RouteContext<"/session/[id]/access">) {
  const { id } = await context.params
  const token = (await cookies()).get(CUSTOMER_COOKIE)?.value
  if (!token || !await verifyCustomerAccess(id, token)) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 })
  }

  const response = NextResponse.json({ recovered: true })
  response.cookies.set(CUSTOMER_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    maxAge: 90 * 24 * 60 * 60,
    priority: "high",
  })
  return response
}

export const GET = withErrorHandling("GET session/access", GETHandler)
