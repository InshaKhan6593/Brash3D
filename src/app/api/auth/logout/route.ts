import { NextResponse } from "next/server"
import { withErrorHandling } from "@/lib/api"
import { requestHasSameOrigin, revokeCurrentStaffSession } from "@/lib/auth"

export const runtime = "nodejs"

async function POSTHandler(request: Request) {
  if (!requestHasSameOrigin(request)) {
    return NextResponse.json({ error: "Invalid request origin" }, { status: 403 })
  }
  await revokeCurrentStaffSession()
  return NextResponse.json({ ok: true })
}

export const POST = withErrorHandling("POST auth/logout", POSTHandler)
