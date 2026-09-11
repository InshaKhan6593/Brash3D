import { NextResponse } from "next/server"
import { invalidBody, readJsonBody, withErrorHandling } from "@/lib/api"
import { allowRequest, authenticateStaff, requestHasSameOrigin, setStaffCookie } from "@/lib/auth"

export const runtime = "nodejs"

async function POSTHandler(request: Request) {
  if (!requestHasSameOrigin(request)) {
    return NextResponse.json({ error: "Invalid request origin" }, { status: 403 })
  }
  const body = await readJsonBody(request)
  if (!body) return invalidBody()
  const email = typeof body.email === "string" ? body.email : ""
  const password = typeof body.password === "string" ? body.password : ""
  if (!email || !password || email.length > 255 || password.length > 256) {
    return NextResponse.json({ error: "Invalid email or password" }, { status: 400 })
  }

  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    || request.headers.get("x-real-ip")
    || "local"
  if (!await allowRequest(`login:${ip}`, 20, 15 * 60)) {
    return NextResponse.json({ error: "Too many sign-in attempts. Try again later." }, { status: 429 })
  }
  const result = await authenticateStaff(email, password, {
    ip: ip === "local" ? undefined : ip,
    userAgent: request.headers.get("user-agent") || undefined,
  })
  if (!result) {
    return NextResponse.json({ error: "Invalid email or password" }, { status: 401 })
  }

  await setStaffCookie(result.token, result.expiresAt)
  return NextResponse.json({ user: result.user })
}

export const POST = withErrorHandling("POST auth/login", POSTHandler)
