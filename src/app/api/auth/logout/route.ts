import { NextResponse } from "next/server"
import { requestHasSameOrigin, revokeCurrentStaffSession } from "@/lib/auth"

export const runtime = "nodejs"

export async function POST(request: Request) {
  if (!requestHasSameOrigin(request)) {
    return NextResponse.json({ error: "Invalid request origin" }, { status: 403 })
  }
  await revokeCurrentStaffSession()
  return NextResponse.json({ ok: true })
}
