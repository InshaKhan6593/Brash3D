import { NextResponse } from "next/server"
import { withErrorHandling } from "@/lib/api"
import { getTimeSlots } from "@/lib/store/sessionStore"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

async function GETHandler() {
  const slots = await getTimeSlots()
  return NextResponse.json({ slots })
}

export const GET = withErrorHandling("GET slots", GETHandler)
