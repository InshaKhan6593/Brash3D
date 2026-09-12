import { NextResponse } from "next/server"
import { withErrorHandling } from "@/lib/api"
import { CUSTOMER_COOKIE, customerAccessCookie, verifyCustomerAccess } from "@/lib/auth"
import { customerSessionPath } from "@/lib/customer-link"

export const runtime = "nodejs"

async function GETHandler(request: Request, context: RouteContext<"/access/session/[id]">) {
  const { id } = await context.params
  const requestUrl = new URL(request.url)
  const token = requestUrl.searchParams.get("token")

  if (!await verifyCustomerAccess(id, token)) {
    // No token to carry forward, so the clean path is all that is left. A
    // customer who still holds the cookie lands on their order anyway.
    return NextResponse.redirect(new URL(customerSessionPath(id), requestUrl))
  }

  // The token stays in the destination URL. It used to be stripped here, which
  // left the customer looking at a `/session/<id>` that carried no credential
  // at all: the authority lived only in the cookie, so the address bar could
  // not be bookmarked, moved to another browser, or reopened after clearing
  // site data. A booking made days ahead had no way back once that one browser
  // profile lost the cookie, and the seller was the only one who could mint a
  // new link. The token is a capability with a 90-day life, so leaving it in
  // the URL is what makes the link portable -- which is what an order-tracking
  // link has to be.
  const response = NextResponse.redirect(new URL(customerSessionPath(id, token), requestUrl))
  response.cookies.set(CUSTOMER_COOKIE, token!, customerAccessCookie())
  return response
}

export const GET = withErrorHandling("GET access/session", GETHandler)
