import { NextResponse } from "next/server"
import { getTimeSlots } from "@/lib/store/sessionStore"

export const dynamic = "force-dynamic"

export async function GET() {
  const slots = getTimeSlots()
  return NextResponse.json({ slots })
}
