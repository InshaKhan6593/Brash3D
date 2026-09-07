import { NextResponse } from "next/server"
import { CUSTOMER_COOKIE, verifyCustomerAccess } from "@/lib/auth"

export const runtime = "nodejs"

export async function GET(request: Request, context: RouteContext<"/access/session/[id]">) {
  const { id } = await context.params
  const requestUrl = new URL(request.url)
  const token = requestUrl.searchParams.get("token")
  const destination = new URL(`/session/${id}`, requestUrl)

  if (!await verifyCustomerAccess(id, token)) {
    return NextResponse.redirect(destination)
  }

  const response = NextResponse.redirect(destination)
  response.cookies.set(CUSTOMER_COOKIE, token!, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    // Keep the token available to both the clean customer page and its API calls.
    path: "/",
    maxAge: 90 * 24 * 60 * 60,
    priority: "high",
  })
  return response
}
