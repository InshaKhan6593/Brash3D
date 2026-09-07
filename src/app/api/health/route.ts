import { NextResponse } from "next/server"
import { query } from "@/lib/db"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

export async function GET() {
  try {
    await query("SELECT 1")
    return NextResponse.json({ status: "ok", database: "connected" })
  } catch {
    return NextResponse.json(
      { status: "error", database: "unavailable" },
      { status: 503 }
    )
  }
}
