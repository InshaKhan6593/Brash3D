import { NextResponse } from "next/server"
import { getTimeSlots } from "@/lib/store/sessionStore"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

export async function GET() {
  const slots = await getTimeSlots()
  return NextResponse.json({ slots })
}
